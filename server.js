const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));

// Serve index.html for all non-API routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Claude proxy — keeps ANTHROPIC_API_KEY secret on the server
app.post('/api/claude', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set on server.' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
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

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(36);
}

// ── Registry Gist ─────────────────────────────────────────────────────────────
// One private Gist with description "QuizMania-Registry" stores:
// { "users": { "username": { "gistId": "...", "passwordHash": "..." } } }

let _registryGistId = null; // cached in memory

async function getRegistryGistId() {
  if (_registryGistId) return _registryGistId;

  // Search existing gists for the registry
  const res = await fetch('https://api.github.com/gists', {
    headers: gistHeaders(),
  });
  if (!res.ok) throw new Error('Failed to list gists');
  const gists = await res.json();
  const found = gists.find(g => g.description === 'QuizMania-Registry');
  if (found) {
    _registryGistId = found.id;
    return _registryGistId;
  }

  // Create the registry gist
  const create = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: gistHeaders(),
    body: JSON.stringify({
      description: 'QuizMania-Registry',
      public: false,
      files: { 'registry.json': { content: JSON.stringify({ users: {} }) } },
    }),
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
    method: 'PATCH',
    headers: gistHeaders(),
    body: JSON.stringify({
      files: { 'registry.json': { content: JSON.stringify(registry) } },
    }),
  });
  if (!res.ok) throw new Error('Failed to write registry');
}

// ── Auth endpoints ────────────────────────────────────────────────────────────

// POST /api/auth/register  { username, password, profile }
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, profile } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });

    const uname = username.toLowerCase().trim();
    if (uname.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters.' });
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });

    const registry = await readRegistry();
    if (registry.users[uname]) {
      return res.status(409).json({ error: 'Username already taken.' });
    }

    const passwordHash = simpleHash(password);

    // Create per-user Gist
    const gistRes = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: gistHeaders(),
      body: JSON.stringify({
        description: `QuizMania — ${uname}`,
        public: false,
        files: {
          'quizmania.json': {
            content: JSON.stringify({ profile: profile || {}, history: [], asked: {} }),
          },
        },
      }),
    });
    if (!gistRes.ok) throw new Error('Failed to create user Gist');
    const gistData = await gistRes.json();
    const gistId = gistData.id;

    // Add to registry
    registry.users[uname] = { gistId, passwordHash };
    await writeRegistry(registry);

    res.json({ ok: true, username: uname, passwordHash });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login  { username, password }  OR  { username, _hash }  (auto-login)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password, _hash } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required.' });
    if (!password && !_hash) return res.status(400).json({ error: 'Password required.' });

    const uname = username.toLowerCase().trim();
    const registry = await readRegistry();
    const entry = registry.users[uname];
    if (!entry) return res.status(401).json({ error: 'Account not found.' });

    // Support direct hash comparison for auto-login (hash already computed client-side)
    const passwordHash = _hash || simpleHash(password);
    if (entry.passwordHash !== passwordHash) return res.status(401).json({ error: 'Wrong password.' });

    // Fetch user data from their Gist
    const gistRes = await fetch(`https://api.github.com/gists/${entry.gistId}`, { headers: gistHeaders() });
    if (!gistRes.ok) return res.status(500).json({ error: 'Failed to load profile.' });

    const gistData = await gistRes.json();
    const raw = gistData.files['quizmania.json']?.content;
    const payload = raw ? JSON.parse(raw) : { profile: {}, history: [], asked: {} };

    res.json({
      ok: true,
      username: uname,
      passwordHash,
      profile: payload.profile,
      history: payload.history || [],
      asked: payload.asked || {},
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/save  { username, passwordHash, profile, history, asked }
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
      method: 'PATCH',
      headers: gistHeaders(),
      body: JSON.stringify({
        files: {
          'quizmania.json': {
            content: JSON.stringify({ profile, history: history || [], asked: asked || {} }),
          },
        },
      }),
    });

    if (!patchRes.ok) return res.status(500).json({ error: 'Save failed.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PWA Manifest ──────────────────────────────────────────────────────────────
app.get('/manifest.json', (req, res) => {
  const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%237c3aed'/%3E%3Ctext y='.85em' font-size='75' x='12'%3E%E2%9A%A1%3C/text%3E%3C/svg%3E";
  res.json({
    name: 'QuizMania',
    short_name: 'QuizMania',
    description: 'AI-powered quiz game for kids, tweens and teens!',
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

app.listen(PORT, () => {
  console.log(`QuizMania running on port ${PORT}`);
  // Keep-alive ping — prevents Render free tier cold starts
  setInterval(() => {
    fetch('https://quizmania.onrender.com').catch(()=>{});
  }, 14 * 60 * 1000); // every 14 minutes
});
