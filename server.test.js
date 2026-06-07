/**
 * QuizMania — Server Test Suite
 * Run: npm test
 * Covers: all endpoints, CORS, rate limiting, caching, prompts, utilities
 */

const request = require('supertest');
const {
  app, simpleHash, buildPrompt,
  checkRateLimit, getCached, addToCache,
  questionCache, rateLimits
} = require('./server');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const MOCK_QUESTIONS = Array.from({ length: 10 }, (_, i) => ({
  question: `Test question number ${i}?`,
  options: ['A', 'B', 'C', 'D'],
  answer: 'A',
  hint: 'hint',
  explanation: 'explanation'
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /', () => {
  it('returns 200 with HTML', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });

  it('HTML contains QuizMania branding', async () => {
    const res = await request(app).get('/');
    expect(res.text).toContain('QuizMania');
  });

  it('injects ADSENSE_PUBLISHER_ID from env', async () => {
    process.env.ADSENSE_PUBLISHER_ID = 'ca-pub-TEST999';
    const res = await request(app).get('/');
    expect(res.text).toContain('ca-pub-TEST999');
    delete process.env.ADSENSE_PUBLISHER_ID;
  });

  it('injects ADSENSE_SLOT_ID from env', async () => {
    process.env.ADSENSE_SLOT_ID = 'SLOT_TEST_123';
    const res = await request(app).get('/');
    expect(res.text).toContain('SLOT_TEST_123');
    delete process.env.ADSENSE_SLOT_ID;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /manifest.json
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /manifest.json', () => {
  it('returns 200', async () => {
    const res = await request(app).get('/manifest.json');
    expect(res.status).toBe(200);
  });

  it('has correct app name', async () => {
    const res = await request(app).get('/manifest.json');
    const body = typeof res.body === 'object' ? res.body : JSON.parse(res.text);
    expect(body.name).toBe('QuizMania');
    expect(body.short_name).toBe('QuizMania');
  });

  it('has standalone display mode', async () => {
    const res = await request(app).get('/manifest.json');
    const body = typeof res.body === 'object' ? res.body : JSON.parse(res.text);
    expect(body.display).toBe('standalone');
  });

  it('has icons array', async () => {
    const res = await request(app).get('/manifest.json');
    const body = typeof res.body === 'object' ? res.body : JSON.parse(res.text);
    expect(Array.isArray(body.icons)).toBe(true);
    expect(body.icons.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /ads.txt
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /ads.txt', () => {
  it('returns 200 with AdSense publisher line', async () => {
    const res = await request(app).get('/ads.txt');
    expect(res.status).toBe(200);
    expect(res.text).toContain('google.com');
    expect(res.text).toContain('DIRECT');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/fifa/matches
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/fifa/matches', () => {
  let matches;

  beforeAll(async () => {
    const res = await request(app).get('/api/fifa/matches');
    matches = res.body;
  });

  it('returns 200', async () => {
    const res = await request(app).get('/api/fifa/matches');
    expect(res.status).toBe(200);
  });

  it('returns an array of at least 35 matches', () => {
    expect(Array.isArray(matches)).toBe(true);
    expect(matches.length).toBeGreaterThanOrEqual(35);
  });

  it('every match has required fields', () => {
    matches.forEach(m => {
      expect(m).toHaveProperty('id');
      expect(m).toHaveProperty('group');
      expect(m).toHaveProperty('matchday');
      expect(m).toHaveProperty('date');
      expect(m).toHaveProperty('venue');
      expect(m).toHaveProperty('homeTeam');
      expect(m).toHaveProperty('awayTeam');
      expect(m.homeTeam).toHaveProperty('name');
      expect(m.homeTeam).toHaveProperty('code');
      expect(m.awayTeam).toHaveProperty('name');
      expect(m.awayTeam).toHaveProperty('code');
    });
  });

  it('covers all 12 groups (A–L)', () => {
    const groups = new Set(matches.map(m => m.group));
    'ABCDEFGHIJKL'.split('').forEach(g => {
      expect(groups.has(g)).toBe(true);
    });
  });

  it('covers matchdays 1, 2 and 3', () => {
    const days = new Set(matches.map(m => m.matchday));
    expect(days.has(1)).toBe(true);
    expect(days.has(2)).toBe(true);
    expect(days.has(3)).toBe(true);
  });

  it('all match IDs are unique', () => {
    const ids = matches.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('flag codes are lowercase', () => {
    matches.forEach(m => {
      expect(m.homeTeam.code).toBe(m.homeTeam.code.toLowerCase());
      expect(m.awayTeam.code).toBe(m.awayTeam.code.toLowerCase());
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/fifa/predict
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/fifa/predict', () => {
  const VALID_PAYLOAD = { matchId: 'TEST_PRED', homeTeam: 'Brazil', awayTeam: 'France', group: 'C' };

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns 400 when body is empty', async () => {
    const res = await request(app).post('/api/fifa/predict').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when matchId is missing', async () => {
    const res = await request(app).post('/api/fifa/predict')
      .send({ homeTeam: 'Brazil', awayTeam: 'France', group: 'C' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when homeTeam is missing', async () => {
    const res = await request(app).post('/api/fifa/predict')
      .send({ matchId: 'X1', awayTeam: 'France', group: 'C' });
    expect(res.status).toBe(400);
  });

  it('returns fallback prediction (no API key)', async () => {
    const res = await request(app).post('/api/fifa/predict').send(VALID_PAYLOAD);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('homeWin');
    expect(res.body).toHaveProperty('draw');
    expect(res.body).toHaveProperty('awayWin');
    expect(res.body).toHaveProperty('insight');
  });

  it('fallback percentages sum to 100', async () => {
    const res = await request(app).post('/api/fifa/predict').send(VALID_PAYLOAD);
    const { homeWin, draw, awayWin } = res.body;
    expect(homeWin + draw + awayWin).toBe(100);
  });

  it('returns same prediction on second call (cache hit)', async () => {
    const payload = { matchId: 'CACHE_HIT_TEST', homeTeam: 'Germany', awayTeam: 'Japan', group: 'F' };
    const res1 = await request(app).post('/api/fifa/predict').send(payload);
    const res2 = await request(app).post('/api/fifa/predict').send(payload);
    expect(res1.body.homeWin).toBe(res2.body.homeWin);
    expect(res1.body.draw).toBe(res2.body.draw);
    expect(res1.body.awayWin).toBe(res2.body.awayWin);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/report
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/report', () => {
  it('returns 400 when question is missing', async () => {
    const res = await request(app).post('/api/report').send({ topic: 'Maths' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns {ok: true} with valid question', async () => {
    const res = await request(app).post('/api/report').send({
      question: 'What is 2+2?',
      answer: '4',
      topic: 'Mathematics',
      difficulty: 'easy',
      age: 'kids'
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('accepts report with only question field', async () => {
    const res = await request(app).post('/api/report').send({ question: 'Minimal report' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/questions
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/questions', () => {
  it('returns 500 when ANTHROPIC_API_KEY not set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await request(app).post('/api/questions').send({ topic: 'Science' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('returns 400 when topic is missing', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const res = await request(app).post('/api/questions').send({ count: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/topic/i);
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('serves from cache when questions are cached', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    // Pre-populate cache for this exact key
    addToCache('Maths|easy|kids|questions', MOCK_QUESTIONS);
    const res = await request(app).post('/api/questions').send({
      topic: 'Maths', difficulty: 'easy', age: 'kids', mode: 'questions', count: 5
    });
    expect(res.status).toBe(200);
    expect(res.body.fromCache).toBe(true);
    expect(Array.isArray(res.body.questions)).toBe(true);
    expect(res.body.questions.length).toBe(5);
    delete process.env.ANTHROPIC_API_KEY;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────────────────────
describe('CORS headers', () => {
  const ALLOWED = [
    'https://quizmania-pap3.onrender.com',
    'capacitor://localhost',
    'http://localhost',
    'http://localhost:3000',
    'ionic://localhost',
  ];

  ALLOWED.forEach(origin => {
    it(`allows origin: ${origin}`, async () => {
      const res = await request(app).get('/api/fifa/matches').set('Origin', origin);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
    });
  });

  it('does not set CORS header for unknown origin', async () => {
    const res = await request(app).get('/api/fifa/matches').set('Origin', 'https://evil.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('responds 200 to OPTIONS preflight from allowed origin', async () => {
    const res = await request(app)
      .options('/api/questions')
      .set('Origin', 'capacitor://localhost')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth — input validation (no GitHub token needed)
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/register — validation', () => {
  it('returns 400 when username missing', async () => {
    const res = await request(app).post('/api/auth/register').send({ password: 'pass1234' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/username/i);
  });

  it('returns 400 when password missing', async () => {
    const res = await request(app).post('/api/auth/register').send({ username: 'testuser' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/username/i);
  });

  it('returns 400 when username shorter than 3 chars', async () => {
    const res = await request(app).post('/api/auth/register').send({ username: 'ab', password: 'pass1234' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/3 characters/i);
  });

  it('returns 400 when password shorter than 4 chars', async () => {
    const res = await request(app).post('/api/auth/register').send({ username: 'validuser', password: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/4 characters/i);
  });
});

describe('POST /api/auth/login — validation', () => {
  it('returns 400 when username missing', async () => {
    const res = await request(app).post('/api/auth/login').send({ password: 'pass1234' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/username/i);
  });

  it('returns 400 when both password and _hash missing', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'testuser' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
  });
});

describe('POST /api/auth/save — validation', () => {
  it('returns 400 when username missing', async () => {
    const res = await request(app).post('/api/auth/save').send({ passwordHash: 'hash123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/credentials/i);
  });

  it('returns 400 when passwordHash missing', async () => {
    const res = await request(app).post('/api/auth/save').send({ username: 'testuser' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/credentials/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit: simpleHash
// ─────────────────────────────────────────────────────────────────────────────
describe('simpleHash()', () => {
  it('is deterministic — same input same output', () => {
    expect(simpleHash('hello world')).toBe(simpleHash('hello world'));
  });

  it('produces different hashes for different inputs', () => {
    expect(simpleHash('apple')).not.toBe(simpleHash('orange'));
  });

  it('returns a non-empty string', () => {
    const h = simpleHash('test');
    expect(typeof h).toBe('string');
    expect(h.length).toBeGreaterThan(0);
  });

  it('handles empty string without throwing', () => {
    expect(() => simpleHash('')).not.toThrow();
  });

  it('handles long strings', () => {
    const long = 'a'.repeat(1000);
    expect(() => simpleHash(long)).not.toThrow();
    expect(typeof simpleHash(long)).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit: buildPrompt
// ─────────────────────────────────────────────────────────────────────────────
describe('buildPrompt()', () => {
  it('generates True/False format for truefalse mode', () => {
    const p = buildPrompt('Science', 'easy', 5, 'kids', 'truefalse', []);
    expect(p).toContain('"True"');
    expect(p).toContain('"False"');
  });

  it('includes flag emoji format for Flag Quiz', () => {
    const p = buildPrompt('Flag Quiz', 'medium', 10, 'tweens', 'questions', []);
    expect(p).toContain('"flag"');
    expect(p).toContain('flag emoji');
  });

  it('includes countryCode field for World Atlas', () => {
    const p = buildPrompt('World Atlas', 'medium', 10, 'tweens', 'questions', []);
    expect(p).toContain('countryCode');
  });

  it('does NOT ask to identify flags in World Atlas', () => {
    const p = buildPrompt('World Atlas', 'medium', 10, 'tweens', 'questions', []);
    expect(p).toContain('Do NOT ask');
  });

  it('includes topic name for general topics', () => {
    const p = buildPrompt('IPL Cricket', 'hard', 10, 'teens', 'questions', []);
    expect(p).toContain('IPL Cricket');
  });

  it('treats adaptive as medium difficulty', () => {
    const p = buildPrompt('Maths', 'adaptive', 5, 'kids', 'questions', []);
    expect(p.toLowerCase()).toContain('medium');
  });

  it('uses kids age description for kids', () => {
    const p = buildPrompt('Science', 'easy', 5, 'kids', 'questions', []);
    expect(p).toContain('8');
    expect(p.toLowerCase()).toContain('simple');
  });

  it('uses adults age description for adults', () => {
    const p = buildPrompt('Science', 'hard', 10, 'adults', 'questions', []);
    expect(p.toLowerCase()).toContain('pub quiz');
  });

  it('includes avoided questions list', () => {
    const p = buildPrompt('Maths', 'easy', 5, 'kids', 'questions', ['hash1', 'hash2']);
    expect(p).toContain('hash1');
    expect(p).toContain('hash2');
  });

  it('requests more questions than count (for cache)', () => {
    // buildPrompt receives count+10 from the caller — test the prompt mentions the right number
    const p = buildPrompt('Maths', 'easy', 15, 'tweens', 'questions', []);
    expect(p).toContain('15');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit: Rate limiter
// ─────────────────────────────────────────────────────────────────────────────
describe('checkRateLimit()', () => {
  beforeEach(() => rateLimits.clear());

  it('allows first 40 requests from same IP', () => {
    for (let i = 0; i < 40; i++) {
      expect(checkRateLimit('test-ip-a')).toBe(true);
    }
  });

  it('blocks the 41st request', () => {
    for (let i = 0; i < 40; i++) checkRateLimit('test-ip-b');
    expect(checkRateLimit('test-ip-b')).toBe(false);
  });

  it('tracks different IPs independently', () => {
    for (let i = 0; i < 40; i++) checkRateLimit('ip-maxed');
    // A different IP should still be allowed
    expect(checkRateLimit('ip-fresh')).toBe(true);
  });

  it('resets after window expires', () => {
    // Exhaust the limit
    for (let i = 0; i < 40; i++) checkRateLimit('ip-reset-test');
    expect(checkRateLimit('ip-reset-test')).toBe(false);
    // Manually expire the window
    const entry = rateLimits.get('ip-reset-test');
    entry.windowStart = Date.now() - (61 * 60 * 1000); // 61 minutes ago
    rateLimits.set('ip-reset-test', entry);
    // Should be allowed again
    expect(checkRateLimit('ip-reset-test')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit: Question cache
// ─────────────────────────────────────────────────────────────────────────────
describe('Question cache — getCached() / addToCache()', () => {
  const KEY = 'cache-test-key';

  beforeEach(() => questionCache.clear());

  it('returns null when cache is empty', () => {
    expect(getCached(KEY, 5, new Set())).toBeNull();
  });

  it('returns questions after adding to cache', () => {
    addToCache(KEY, MOCK_QUESTIONS);
    const result = getCached(KEY, 5, new Set());
    expect(result).not.toBeNull();
    expect(result.length).toBe(5);
  });

  it('returns null when fewer cached questions than requested', () => {
    addToCache(KEY, MOCK_QUESTIONS.slice(0, 3));
    expect(getCached(KEY, 5, new Set())).toBeNull();
  });

  it('excludes asked questions from results', () => {
    addToCache(KEY, MOCK_QUESTIONS);
    // Hash of first question
    const askedHash = simpleHash(MOCK_QUESTIONS[0].question.slice(0, 60));
    const askedSet = new Set([askedHash]);
    const result = getCached(KEY, 5, askedSet);
    expect(result).not.toBeNull();
    result.forEach(q => {
      expect(q.question).not.toBe(MOCK_QUESTIONS[0].question);
    });
  });

  it('does not add duplicate questions', () => {
    addToCache(KEY, MOCK_QUESTIONS);
    addToCache(KEY, MOCK_QUESTIONS); // same questions again
    const entry = questionCache.get(KEY);
    expect(entry.pool.length).toBe(MOCK_QUESTIONS.length);
  });

  it('merges new unique questions into existing cache', () => {
    const extraQ = { question: 'Brand new question?', options: ['A','B','C','D'], answer: 'A', hint:'', explanation:'' };
    addToCache(KEY, MOCK_QUESTIONS);
    addToCache(KEY, [...MOCK_QUESTIONS, extraQ]);
    const entry = questionCache.get(KEY);
    expect(entry.pool.length).toBe(MOCK_QUESTIONS.length + 1);
  });

  it('returns null when cache is expired', () => {
    addToCache(KEY, MOCK_QUESTIONS);
    // Manually expire the cache
    const entry = questionCache.get(KEY);
    entry.createdAt = Date.now() - (7 * 60 * 60 * 1000); // 7 hours ago
    questionCache.set(KEY, entry);
    expect(getCached(KEY, 5, new Set())).toBeNull();
  });
});
