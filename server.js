const express = require('express');
const path = require('path');
const compression = require('compression');

const app = express();
app.use(compression()); // gzip all responses — ~70% smaller over the wire
const PORT = process.env.PORT || 3000;

// ── CORS — allow browser, Capacitor iOS, Capacitor Android ───────────────────
const ALLOWED_ORIGINS = new Set([
  'https://quizmania-pap3.onrender.com',
  'capacitor://localhost',   // Capacitor iOS
  'http://localhost',        // Capacitor Android / dev
  'http://localhost:3000',
  'ionic://localhost',       // Ionic compatibility
]);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || ALLOWED_ORIGINS.has(origin)) {
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '5mb' }));

// ── Static files (sw.js needs no-cache; CSS/JS get 1hr) ──────────────────────
app.use(express.static(path.join(__dirname), {
  index: false,
  setHeaders: (res, fp) => {
    if (fp.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache, no-store');
    else if (fp.endsWith('.css') || (fp.endsWith('.js') && !fp.includes('index')))
      res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}));

// ── Serve index.html with AdSense IDs injected from env vars ─────────────────
const fs = require('fs');
let _indexHtmlCache = null;
app.get('/', (req, res) => {
  try {
    // Read fresh in dev, cache in prod for performance
    if (!_indexHtmlCache || process.env.NODE_ENV !== 'production') {
      _indexHtmlCache = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    }
    const publisherId = process.env.ADSENSE_PUBLISHER_ID || 'YOUR_ADSENSE_PUBLISHER_ID';
    const slotId     = process.env.ADSENSE_SLOT_ID       || 'YOUR_AD_SLOT_ID';
    const html = _indexHtmlCache
      .replace(/YOUR_ADSENSE_PUBLISHER_ID/g, publisherId)
      .replace(/YOUR_AD_SLOT_ID/g, slotId);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (e) {
    res.status(500).send('Server error loading page');
  }
});

// ── Utility ───────────────────────────────────────────────────────────────────
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(36);
}
function qHash(q) { return simpleHash((q.question||'').slice(0,60)); }

// ── In-memory question cache ──────────────────────────────────────────────────
// Key: "topic|diff|age|mode"  Value: { pool:[...], createdAt:ms }
const questionCache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000;   // 6 hours
const CACHE_MAX  = 200;                   // max questions per bucket

function getCached(key, count, askedSet) {
  const entry = questionCache.get(key);
  if (!entry || Date.now() - entry.createdAt > CACHE_TTL) return null;
  const available = entry.pool.filter(q => !askedSet.has(qHash(q)));
  if (available.length < count) return null;
  // Shuffle and return count
  const shuffled = [...available].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function addToCache(key, newQuestions) {
  const entry = questionCache.get(key) || { pool: [], createdAt: Date.now() };
  const existing = new Set(entry.pool.map(q => qHash(q)));
  for (const q of newQuestions) {
    if (!existing.has(qHash(q))) { entry.pool.push(q); existing.add(qHash(q)); }
  }
  if (entry.pool.length > CACHE_MAX) entry.pool = entry.pool.slice(-CACHE_MAX);
  entry.createdAt = Date.now();
  questionCache.set(key, entry);
}

// ── Rate limiter (per IP) ─────────────────────────────────────────────────────
const rateLimits = new Map();
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour
const RATE_MAX    = 40;              // max /api/questions calls per IP per hour

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimits.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_WINDOW) { entry.count = 0; entry.windowStart = now; }
  if (entry.count >= RATE_MAX) return false;
  entry.count++;
  rateLimits.set(ip, entry);
  return true;
}

// Clean rate limit map every hour
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of rateLimits) {
    if (now - e.windowStart > RATE_WINDOW) rateLimits.delete(ip);
  }
}, RATE_WINDOW);

// ── Prompt builder ────────────────────────────────────────────────────────────
function buildPrompt(topic, difficulty, count, age, mode, askedList) {
  const diffLabel = difficulty === 'adaptive' ? 'medium' : difficulty;
  const ageDesc = {
    kids:   'children aged 8–11 (simple words, fun, short sentences, easy concepts)',
    tweens: 'tweens aged 12–14 (moderate complexity, pop culture OK)',
    teens:  'teenagers aged 15–18 (advanced vocabulary, deeper concepts, current events)',
    adults: 'adults (pub quiz style, challenging, sophisticated — no simplification needed)'
  }[age] || 'players of all ages';
  const avoid = (askedList || []).slice(-50).join(' | ') || 'none';

  if (mode === 'truefalse') return `Generate exactly ${count} true-or-false quiz questions about "${topic}" for ${ageDesc}. Difficulty: ${diffLabel}.
Previously asked — AVOID repeating: ${avoid}.
Return ONLY a JSON array, no markdown:
[{"question":"...statement...","options":["True","False"],"answer":"True","hint":"...","explanation":"..."}]
Each question must be a factual statement. "answer" must be exactly "True" or "False".`;

  if (topic === 'Flag Quiz') return `Generate exactly ${count} flag quiz questions for ${ageDesc}. Difficulty: ${diffLabel}.
Easy = iconic flags (USA, UK, France, Japan, Brazil, Canada, Australia).
Medium = well-known (India, Germany, Italy, Mexico, South Africa, Argentina, China).
Hard = tricky/similar-looking (Chad, Romania, Monaco, Indonesia, Poland, etc.).
Previously asked — AVOID repeating: ${avoid}.
Return ONLY a JSON array, no markdown:
[{"question":"Which country does this flag belong to?","flag":"🇫🇷","options":["France","Germany","Italy","Spain"],"answer":"France","hint":"Known for the Eiffel Tower","explanation":"France's tricolour has blue, white, and red vertical stripes."}]
"flag" must be a single country flag emoji. "answer" must match one option exactly.`;

  if (topic === 'World Atlas') return `Generate exactly ${count} world geography multiple-choice questions for ${ageDesc}. Difficulty: ${diffLabel}.
Ask about capitals, rivers, mountains, continents, oceans, countries, landmarks, and borders. Do NOT ask "identify this flag".
Each question must include a countryCode (ISO 2-letter) for the country most relevant to the question — used to show a map reference.
Previously asked — AVOID repeating: ${avoid}.
Return ONLY a JSON array, no markdown:
[{"question":"...","options":["A","B","C","D"],"answer":"B","hint":"...","explanation":"...","countryCode":"HU"}]
countryCode is required for every question.`;

  return `Generate exactly ${count} multiple-choice quiz questions about "${topic}" for ${ageDesc}. Difficulty: ${diffLabel}.
Make questions educational, engaging, accurate, and age-appropriate.
Previously asked — AVOID repeating: ${avoid}.
Return ONLY a JSON array, no markdown:
[{"question":"...","options":["A","B","C","D"],"answer":"B","hint":"...","explanation":"..."}]
"answer" must exactly match one of the options.`;
}

// ── /api/health — lightweight ping to wake the server (avoids cold-start lag) ──
app.get('/api/health', (req, res) => res.json({ ok: true, t: Date.now() }));

// ── /api/questions — cached question generation ───────────────────────────────
app.post('/api/questions', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });

  const { topic, difficulty, count = 10, age = 'tweens', mode = 'questions', askedList = [] } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic required' });

  // Rate limit
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });

  const cacheKey = `${topic}|${difficulty}|${age}|${mode}`;
  const askedSet = new Set(askedList);

  // Try cache first
  const cached = getCached(cacheKey, count, askedSet);
  if (cached) return res.json({ questions: cached, fromCache: true });

  // Generate fresh
  try {
    // Small "quick start" batches (the first 1–4 questions) generate EXACTLY what's
    // asked for, so the first question appears fast. Larger batches add +10 to warm the cache.
    const genCount = count <= 4 ? count : count + 10;
    const prompt = buildPrompt(topic, difficulty, genCount, age, mode, askedList);
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: genCount > 20 ? 8000 : genCount > 10 ? 4000 : genCount <= 4 ? 1200 : 3000,
        system: 'You are a quiz question generator. Return ONLY valid JSON arrays. No markdown, no explanation.',
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || 'API error' });
    }

    const data = await response.json();
    const text = data.content[0].text.trim();
    const jsonStr = text.startsWith('[') ? text : text.match(/\[[\s\S]*\]/)?.[0];
    if (!jsonStr) return res.status(500).json({ error: 'Invalid response format from AI' });

    const allQuestions = JSON.parse(jsonStr);
    // Cache all returned questions (including extras)
    addToCache(cacheKey, allQuestions);
    // Filter asked and return exactly count
    const fresh = allQuestions.filter(q => !askedSet.has(qHash(q))).slice(0, count);
    res.json({ questions: fresh.length >= count ? fresh : allQuestions.slice(0, count) });
  } catch (err) {
    console.error('Questions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── FIFA 2026 match data ──────────────────────────────────────────────────────
const FIFA_MATCHES = [
  // GROUP A
  {id:'A1',group:'A',matchday:1,date:'Jun 11',homeTeam:{name:'Mexico',code:'mx'},awayTeam:{name:'South Africa',code:'za'},venue:'Mexico City'},
  {id:'A2',group:'A',matchday:1,date:'Jun 11',homeTeam:{name:'South Korea',code:'kr'},awayTeam:{name:'Czechia',code:'cz'},venue:'Guadalajara'},
  // GROUP B
  {id:'B1',group:'B',matchday:1,date:'Jun 12',homeTeam:{name:'Canada',code:'ca'},awayTeam:{name:'Bosnia & Herz.',code:'ba'},venue:'Toronto'},
  {id:'B2',group:'B',matchday:1,date:'Jun 12',homeTeam:{name:'Switzerland',code:'ch'},awayTeam:{name:'Qatar',code:'qa'},venue:'Los Angeles'},
  // GROUP C
  {id:'C1',group:'C',matchday:1,date:'Jun 13',homeTeam:{name:'Brazil',code:'br'},awayTeam:{name:'Morocco',code:'ma'},venue:'New York/NJ'},
  {id:'C2',group:'C',matchday:1,date:'Jun 14',homeTeam:{name:'Haiti',code:'ht'},awayTeam:{name:'Scotland',code:'gb-sct'},venue:'Boston'},
  // GROUP D
  {id:'D1',group:'D',matchday:1,date:'Jun 13',homeTeam:{name:'USA',code:'us'},awayTeam:{name:'Paraguay',code:'py'},venue:'Los Angeles'},
  {id:'D2',group:'D',matchday:1,date:'Jun 14',homeTeam:{name:'Australia',code:'au'},awayTeam:{name:'Turkey',code:'tr'},venue:'Los Angeles'},
  // GROUP E
  {id:'E1',group:'E',matchday:1,date:'Jun 15',homeTeam:{name:'Germany',code:'de'},awayTeam:{name:'Ecuador',code:'ec'},venue:'Toronto'},
  {id:'E2',group:'E',matchday:1,date:'Jun 15',homeTeam:{name:'Ivory Coast',code:'ci'},awayTeam:{name:'Curacao',code:'cw'},venue:'Dallas'},
  // GROUP F
  {id:'F1',group:'F',matchday:1,date:'Jun 14',homeTeam:{name:'Netherlands',code:'nl'},awayTeam:{name:'Japan',code:'jp'},venue:'Dallas'},
  {id:'F2',group:'F',matchday:1,date:'Jun 15',homeTeam:{name:'Sweden',code:'se'},awayTeam:{name:'Tunisia',code:'tn'},venue:'Houston'},
  // GROUP G
  {id:'G1',group:'G',matchday:1,date:'Jun 15',homeTeam:{name:'Belgium',code:'be'},awayTeam:{name:'Egypt',code:'eg'},venue:'Seattle'},
  {id:'G2',group:'G',matchday:1,date:'Jun 16',homeTeam:{name:'Iran',code:'ir'},awayTeam:{name:'New Zealand',code:'nz'},venue:'Vancouver'},
  // GROUP H
  {id:'H1',group:'H',matchday:1,date:'Jun 14',homeTeam:{name:'Spain',code:'es'},awayTeam:{name:'Cape Verde',code:'cv'},venue:'Atlanta'},
  {id:'H2',group:'H',matchday:1,date:'Jun 15',homeTeam:{name:'Saudi Arabia',code:'sa'},awayTeam:{name:'Uruguay',code:'uy'},venue:'Miami'},
  // GROUP I
  {id:'I1',group:'I',matchday:1,date:'Jun 18',homeTeam:{name:'France',code:'fr'},awayTeam:{name:'Senegal',code:'sn'},venue:'New York/NJ'},
  {id:'I2',group:'I',matchday:1,date:'Jun 17',homeTeam:{name:'Iraq',code:'iq'},awayTeam:{name:'Norway',code:'no'},venue:'Philadelphia'},
  // GROUP J
  {id:'J1',group:'J',matchday:1,date:'Jun 21',homeTeam:{name:'Argentina',code:'ar'},awayTeam:{name:'Algeria',code:'dz'},venue:'Dallas'},
  {id:'J2',group:'J',matchday:1,date:'Jun 19',homeTeam:{name:'Austria',code:'at'},awayTeam:{name:'Jordan',code:'jo'},venue:'Los Angeles'},
  // GROUP K
  {id:'K1',group:'K',matchday:1,date:'Jun 20',homeTeam:{name:'Portugal',code:'pt'},awayTeam:{name:'Colombia',code:'co'},venue:'Houston'},
  {id:'K2',group:'K',matchday:1,date:'Jun 19',homeTeam:{name:'DR Congo',code:'cd'},awayTeam:{name:'Uzbekistan',code:'uz'},venue:'Mexico City'},
  // GROUP L
  {id:'L1',group:'L',matchday:1,date:'Jun 17',homeTeam:{name:'England',code:'gb-eng'},awayTeam:{name:'Croatia',code:'hr'},venue:'Dallas'},
  {id:'L2',group:'L',matchday:1,date:'Jun 18',homeTeam:{name:'Ghana',code:'gh'},awayTeam:{name:'Panama',code:'pa'},venue:'Houston'},
  // MATCHDAY 2 — KEY MATCHES
  {id:'C3',group:'C',matchday:2,date:'Jun 20',homeTeam:{name:'Brazil',code:'br'},awayTeam:{name:'Haiti',code:'ht'},venue:'Philadelphia'},
  {id:'I3',group:'I',matchday:2,date:'Jun 23',homeTeam:{name:'France',code:'fr'},awayTeam:{name:'Iraq',code:'iq'},venue:'Dallas'},
  {id:'J3',group:'J',matchday:2,date:'Jun 25',homeTeam:{name:'Argentina',code:'ar'},awayTeam:{name:'Austria',code:'at'},venue:'San Francisco'},
  {id:'L3',group:'L',matchday:2,date:'Jun 23',homeTeam:{name:'England',code:'gb-eng'},awayTeam:{name:'Ghana',code:'gh'},venue:'Houston'},
  {id:'H3',group:'H',matchday:2,date:'Jun 21',homeTeam:{name:'Spain',code:'es'},awayTeam:{name:'Saudi Arabia',code:'sa'},venue:'Miami'},
  {id:'E3',group:'E',matchday:2,date:'Jun 21',homeTeam:{name:'Germany',code:'de'},awayTeam:{name:'Ivory Coast',code:'ci'},venue:'Dallas'},
  {id:'K3',group:'K',matchday:2,date:'Jun 23',homeTeam:{name:'Portugal',code:'pt'},awayTeam:{name:'Uzbekistan',code:'uz'},venue:'Kansas City'},
  {id:'A3',group:'A',matchday:2,date:'Jun 19',homeTeam:{name:'Mexico',code:'mx'},awayTeam:{name:'South Korea',code:'kr'},venue:'Atlanta'},
  // MATCHDAY 3 — DECIDERS
  {id:'L5',group:'L',matchday:3,date:'Jun 27',homeTeam:{name:'England',code:'gb-eng'},awayTeam:{name:'Panama',code:'pa'},venue:'Toronto'},
  {id:'C5',group:'C',matchday:3,date:'Jun 27',homeTeam:{name:'Brazil',code:'br'},awayTeam:{name:'Scotland',code:'gb-sct'},venue:'Seattle'},
  {id:'I5',group:'I',matchday:3,date:'Jun 27',homeTeam:{name:'France',code:'fr'},awayTeam:{name:'Norway',code:'no'},venue:'Philadelphia'},
  {id:'J5',group:'J',matchday:3,date:'Jun 29',homeTeam:{name:'Argentina',code:'ar'},awayTeam:{name:'Jordan',code:'jo'},venue:'Los Angeles'},
  {id:'K5',group:'K',matchday:3,date:'Jun 26',homeTeam:{name:'Portugal',code:'pt'},awayTeam:{name:'DR Congo',code:'cd'},venue:'Houston'},
];

const predictionCache = new Map();

app.get('/api/fifa/matches', (req, res) => res.json(FIFA_MATCHES));

// ── FIFA 2026 Predicted Knockout Bracket ──────────────────────────────────────
const FIFA_KNOCKOUT = [
  // ── ROUND OF 16 ──
  {id:'R16-1',round:'Round of 16',roundShort:'R16',match:1,date:'Jun 29',homeTeam:{name:'Brazil',code:'br'},awayTeam:{name:'USA',code:'us'},venue:'MetLife Stadium, New Jersey'},
  {id:'R16-2',round:'Round of 16',roundShort:'R16',match:2,date:'Jun 29',homeTeam:{name:'France',code:'fr'},awayTeam:{name:'England',code:'gb-eng'},venue:'AT&T Stadium, Dallas'},
  {id:'R16-3',round:'Round of 16',roundShort:'R16',match:3,date:'Jun 30',homeTeam:{name:'Argentina',code:'ar'},awayTeam:{name:'Portugal',code:'pt'},venue:'SoFi Stadium, Los Angeles'},
  {id:'R16-4',round:'Round of 16',roundShort:'R16',match:4,date:'Jun 30',homeTeam:{name:'Germany',code:'de'},awayTeam:{name:'Spain',code:'es'},venue:'Mercedes-Benz Stadium, Atlanta'},
  {id:'R16-5',round:'Round of 16',roundShort:'R16',match:5,date:'Jul 1',homeTeam:{name:'Netherlands',code:'nl'},awayTeam:{name:'Mexico',code:'mx'},venue:'NRG Stadium, Houston'},
  {id:'R16-6',round:'Round of 16',roundShort:'R16',match:6,date:'Jul 1',homeTeam:{name:'Belgium',code:'be'},awayTeam:{name:'Morocco',code:'ma'},venue:'Lumen Field, Seattle'},
  {id:'R16-7',round:'Round of 16',roundShort:'R16',match:7,date:'Jul 2',homeTeam:{name:'Switzerland',code:'ch'},awayTeam:{name:'South Korea',code:'kr'},venue:'BC Place, Vancouver'},
  {id:'R16-8',round:'Round of 16',roundShort:'R16',match:8,date:'Jul 2',homeTeam:{name:'Japan',code:'jp'},awayTeam:{name:'Uruguay',code:'uy'},venue:'Levi\'s Stadium, San Francisco'},
  // ── QUARTER-FINALS ──
  {id:'QF-1',round:'Quarter-Final',roundShort:'QF',match:1,date:'Jul 9',homeTeam:{name:'Brazil',code:'br'},awayTeam:{name:'France',code:'fr'},venue:'Gillette Stadium, Boston'},
  {id:'QF-2',round:'Quarter-Final',roundShort:'QF',match:2,date:'Jul 9',homeTeam:{name:'Argentina',code:'ar'},awayTeam:{name:'Germany',code:'de'},venue:'SoFi Stadium, Los Angeles'},
  {id:'QF-3',round:'Quarter-Final',roundShort:'QF',match:3,date:'Jul 10',homeTeam:{name:'Netherlands',code:'nl'},awayTeam:{name:'Belgium',code:'be'},venue:'Hard Rock Stadium, Miami'},
  {id:'QF-4',round:'Quarter-Final',roundShort:'QF',match:4,date:'Jul 11',homeTeam:{name:'Spain',code:'es'},awayTeam:{name:'Japan',code:'jp'},venue:'Arrowhead Stadium, Kansas City'},
  // ── SEMI-FINALS ──
  {id:'SF-1',round:'Semi-Final',roundShort:'SF',match:1,date:'Jul 14',homeTeam:{name:'Brazil',code:'br'},awayTeam:{name:'Argentina',code:'ar'},venue:'AT&T Stadium, Dallas'},
  {id:'SF-2',round:'Semi-Final',roundShort:'SF',match:2,date:'Jul 15',homeTeam:{name:'France',code:'fr'},awayTeam:{name:'Netherlands',code:'nl'},venue:'Mercedes-Benz Stadium, Atlanta'},
  // ── THIRD PLACE ──
  {id:'3P-1',round:'3rd Place',roundShort:'3rd',match:1,date:'Jul 18',homeTeam:{name:'Argentina',code:'ar'},awayTeam:{name:'Netherlands',code:'nl'},venue:'Hard Rock Stadium, Miami'},
  // ── FINAL ──
  {id:'F-1',round:'THE FINAL 🏆',roundShort:'Final',match:1,date:'Jul 19',homeTeam:{name:'Brazil',code:'br'},awayTeam:{name:'France',code:'fr'},venue:'MetLife Stadium, New Jersey'},
];

app.get('/api/fifa/knockout', (req, res) => res.json(FIFA_KNOCKOUT));

app.post('/api/fifa/predict', async (req, res) => {
  const { matchId, homeTeam, awayTeam, group } = req.body || {};
  if(!matchId || !homeTeam || !awayTeam) return res.status(400).json({error:'Missing fields'});
  if(predictionCache.has(matchId)) return res.json(predictionCache.get(matchId));
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if(!apiKey) return res.json({homeWin:40,draw:25,awayWin:35,insight:'Prediction unavailable — API key not configured.'});
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'x-api-key':apiKey,'anthropic-version':'2023-06-01','content-type':'application/json'},
      body:JSON.stringify({
        model:'claude-haiku-4-5-20251001', max_tokens:120,
        messages:[{role:'user',content:`FIFA World Cup 2026 Group ${group}: ${homeTeam} vs ${awayTeam}. Return ONLY valid JSON, no markdown: {"homeWin":45,"draw":28,"awayWin":27,"insight":"One concise expert sentence about this match."} — percentages must sum to exactly 100.`}]
      })
    });
    const d = await response.json();
    const text = d.content?.[0]?.text?.trim() || '';
    const match = text.match(/\{[\s\S]*\}/);
    if(!match) throw new Error('No JSON');
    const pred = JSON.parse(match[0]);
    const total = (pred.homeWin||0)+(pred.draw||0)+(pred.awayWin||0);
    if(Math.abs(total-100)>5) throw new Error('Bad %');
    predictionCache.set(matchId, pred);
    res.json(pred);
  } catch(e) {
    const fallback = {homeWin:40,draw:28,awayWin:32,insight:'A competitive Group '+group+' encounter expected between these two nations.'};
    res.json(fallback);
  }
});

// ── /api/report — log bad question reports ───────────────────────────────────
app.post('/api/report', (req, res) => {
  const { question, answer, topic, difficulty, age } = req.body || {};
  if(!question) return res.status(400).json({ error: 'No question provided' });
  console.log('[REPORT]', JSON.stringify({ question, answer, topic, difficulty, age, ts: new Date().toISOString() }));
  res.json({ ok: true });
});

// ── /api/claude — proxy for hints and other direct calls ─────────────────────
app.post('/api/claude', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set on server.' });
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(500).json({ error: 'Proxy failed', detail: err.message });
  }
});

// ── Gist helpers ──────────────────────────────────────────────────────────────
function gistHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not set on server.');
  return {
    'Authorization': `token ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'QuizMania-App',
  };
}

// ── Registry Gist ─────────────────────────────────────────────────────────────
let _registryGistId = null;

async function getRegistryGistId() {
  if (_registryGistId) return _registryGistId;
  const res = await fetch('https://api.github.com/gists', { headers: gistHeaders() });
  if (!res.ok) throw new Error('Failed to list gists');
  const gists = await res.json();
  const found = gists.find(g => g.description === 'QuizMania-Registry');
  if (found) { _registryGistId = found.id; return _registryGistId; }
  const create = await fetch('https://api.github.com/gists', {
    method: 'POST', headers: gistHeaders(),
    body: JSON.stringify({ description: 'QuizMania-Registry', public: false, files: { 'registry.json': { content: JSON.stringify({ users: {} }) } } }),
  });
  if (!create.ok) throw new Error('Failed to create registry gist');
  const data = await create.json();
  _registryGistId = data.id;
  return _registryGistId;
}

async function readRegistry() {
  const gistId = await getRegistryGistId();
  const res = await fetch(`https://api.github.com/gists/${gistId}`, { headers: gistHeaders() });
  if (!res.ok) throw new Error('Failed to read registry');
  const data = await res.json();
  const raw = data.files['registry.json']?.content;
  return raw ? JSON.parse(raw) : { users: {} };
}

async function writeRegistry(registry) {
  const gistId = await getRegistryGistId();
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH', headers: gistHeaders(),
    body: JSON.stringify({ files: { 'registry.json': { content: JSON.stringify(registry) } } }),
  });
  if (!res.ok) throw new Error('Failed to write registry');
}

// ── Auth endpoints ────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, profile } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
    const uname = username.toLowerCase().trim();
    if (uname.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters.' });
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });
    const registry = await readRegistry();
    if (registry.users[uname]) return res.status(409).json({ error: 'Username already taken.' });
    const passwordHash = simpleHash(password);
    const gistRes = await fetch('https://api.github.com/gists', {
      method: 'POST', headers: gistHeaders(),
      body: JSON.stringify({
        description: `QuizMania — ${uname}`, public: false,
        files: { 'quizmania.json': { content: JSON.stringify({ profile: profile || {}, history: [], asked: {} }) } },
      }),
    });
    if (!gistRes.ok) throw new Error('Failed to create user Gist');
    const gistData = await gistRes.json();
    registry.users[uname] = { gistId: gistData.id, passwordHash };
    await writeRegistry(registry);
    res.json({ ok: true, username: uname, passwordHash });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password, _hash } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required.' });
    if (!password && !_hash) return res.status(400).json({ error: 'Password required.' });
    const uname = username.toLowerCase().trim();
    const registry = await readRegistry();
    const entry = registry.users[uname];
    if (!entry) return res.status(401).json({ error: 'Account not found.' });
    const passwordHash = _hash || simpleHash(password);
    if (entry.passwordHash !== passwordHash) return res.status(401).json({ error: 'Wrong password.' });
    const gistRes = await fetch(`https://api.github.com/gists/${entry.gistId}`, { headers: gistHeaders() });
    if (!gistRes.ok) return res.status(500).json({ error: 'Failed to load profile.' });
    const gistData = await gistRes.json();
    const raw = gistData.files['quizmania.json']?.content;
    const payload = raw ? JSON.parse(raw) : { profile: {}, history: [], asked: {} };
    res.json({ ok: true, username: uname, passwordHash, profile: payload.profile, history: payload.history || [], asked: payload.asked || {} });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/save', async (req, res) => {
  try {
    const { username, passwordHash, profile, history, asked } = req.body;
    if (!username || !passwordHash) return res.status(400).json({ error: 'Missing credentials.' });
    const uname = username.toLowerCase().trim();
    const registry = await readRegistry();
    const entry = registry.users[uname];
    if (!entry) return res.status(401).json({ error: 'Account not found.' });
    if (entry.passwordHash !== passwordHash) return res.status(401).json({ error: 'Wrong credentials.' });
    const patchRes = await fetch(`https://api.github.com/gists/${entry.gistId}`, {
      method: 'PATCH', headers: gistHeaders(),
      body: JSON.stringify({ files: { 'quizmania.json': { content: JSON.stringify({ profile, history: history || [], asked: asked || {} }) } } }),
    });
    if (!patchRes.ok) return res.status(500).json({ error: 'Save failed.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Global Leaderboard ────────────────────────────────────────────────────────
app.get('/api/leaderboard', async (req, res) => {
  try {
    const registry = await readRegistry();
    const usernames = Object.keys(registry.users);
    if (!usernames.length) return res.json({ players: [] });
    const top = usernames.slice(0, 50);
    const results = await Promise.allSettled(
      top.map(async (uname) => {
        const { gistId } = registry.users[uname];
        const gistRes = await fetch(`https://api.github.com/gists/${gistId}`, { headers: gistHeaders() });
        if (!gistRes.ok) return null;
        const data = await gistRes.json();
        const raw = data.files['quizmania.json']?.content;
        if (!raw) return null;
        const payload = JSON.parse(raw);
        const history = payload.history || [];
        const profile = payload.profile || {};
        if (!history.length) return null;
        const avg = Math.round(history.reduce((a, b) => a + (b.pct || 0), 0) / history.length);
        const best = Math.max(...history.map(h => h.pct || 0));
        const totalPoints = history.reduce((a, b) => a + (b.score || 0), 0);
        const topicsCount = new Set(history.map(h => h.topic).filter(Boolean)).size;
        return { username: uname, name: profile.name || uname, avatar: profile.avatar || '🧠', age: profile.age || '', xp: profile.xp || 0, level: profile.level || 1, quizzes: history.length, avg, best, totalPoints, topicsCount };
      })
    );
    const players = results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value)
      .sort((a, b) => b.avg - a.avg || b.quizzes - a.quizzes || b.totalPoints - a.totalPoints);
    res.json({ players });
  } catch (err) {
    console.error('Leaderboard error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PWA Manifest ──────────────────────────────────────────────────────────────
app.get('/manifest.json', (req, res) => {
  const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%237c3aed'/%3E%3Ctext y='.85em' font-size='75' x='12'%3E%E2%9A%A1%3C/text%3E%3C/svg%3E";
  res.json({
    name: 'QuizMania',
    short_name: 'QuizMania',
    description: 'AI-powered quiz game for the whole family!',
    start_url: '/',
    display: 'standalone',
    background_color: '#0f0c29',
    theme_color: '#7c3aed',
    icons: [
      { src: icon, sizes: '192x192', type: 'image/svg+xml' },
      { src: icon, sizes: '512x512', type: 'image/svg+xml' }
    ]
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`QuizMania running on port ${PORT}`);
    // Keep-alive ping — prevents Render free tier cold starts
    setInterval(() => {
      fetch('https://quizmania-pap3.onrender.com').catch(() => {});
    }, 14 * 60 * 1000);
  });
}

// ── Exports (for testing) ─────────────────────────────────────────────────────
module.exports = { app, simpleHash, buildPrompt, checkRateLimit, getCached, addToCache, questionCache, rateLimits };
