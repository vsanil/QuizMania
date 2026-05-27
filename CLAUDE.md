# QuizMania — Project Instructions for Claude

## What This Project Is
An AI-powered quiz website for kids, tweens, and teens (ages 8–18). Questions are generated dynamically via the Claude API (claude-haiku-4-5-20251001). Single-file HTML/CSS/JS app (`index.html`) served by an Express proxy (`server.js`) on Render.

---

## Architecture

- `index.html` — entire frontend (HTML + CSS + JS, no build tools)
- `server.js` — Express server, serves index.html and proxies `/api/claude` to Anthropic API
- `package.json` — Node dependencies (express)
- `ANTHROPIC_API_KEY` — set as environment variable on Render (never in code)

The frontend calls `/api/claude` (never the Anthropic API directly). The server keeps the API key secret.

---

## Key Implementation Rules

### Answer Matching — ALWAYS use index-based approach
Never put answer strings in `onclick` attributes — apostrophes and quotes break HTML.
```js
// CORRECT
grid.innerHTML = q.options.map((opt, i) => `
  <button onclick="pickAnswer(this, ${i})" data-idx="${i}">
    <span>${opt}</span>
  </button>`).join('');

function pickAnswer(btn, idx) {
  const answer = q.options[idx]; // use index to get the string
}
```

### Timer — Start AFTER questions load
Never start the quiz timer before `generateQuestions()` resolves. Timer starts inside the `try` block after `qe.questions` is populated.

### Timed Mode — Generate 50 questions
Timed mode generates 50 questions upfront so the user never runs out mid-quiz.

### Modals — Use custom `showModal()`, never `confirm()`
Browser `confirm()` dialogs are unstyled and blocked in some browsers. Always use the custom modal.

### Profile Storage
Each profile gets isolated localStorage keys:
- `qm_profiles` — array of all profiles
- `qm_history_{pid}` — quiz history per profile
- `qm_asked_{pid}` — question hashes per profile (anti-repeat)

### Anti-Repeat Questions
Question hashes stored per `topic-difficulty` bucket. Sent to Claude as "Previously asked — AVOID repeating". Cap at 200 per bucket then reset.

---

## Deployment

- **Platform:** Render (free tier Web Service)
- **GitHub repo:** push to trigger auto-redeploy
- **Build command:** `npm install`
- **Start command:** `node server.js`
- **Env var:** `ANTHROPIC_API_KEY`

### After every code change, remind the user to push:
```bash
cd ~/Documents/Claude/Projects/QuizMania
git add index.html
git commit -m "describe the change"
git push
```

Render redeploys automatically within ~1 minute of a push.

---

## Topics
12 built-in topics: Mathematics, Science, World Atlas (with SVG map + countryCode), Geography, History, Technology, Sports, General Knowledge, Space & Astronomy, Animals & Nature, Music & Arts, Movies & TV. Plus open custom topics (any string).

## Age Groups
- `kids` — ages 8–11, simple words, fun, short sentences
- `tweens` — ages 12–14, moderate complexity, pop culture OK
- `teens` — ages 15–18, advanced vocabulary, deeper concepts

## Quiz Modes
- `questions` — fixed number (5 / 10 / 15 / 20)
- `timed` — countdown timer (60s / 90s / 2 min / 5 min), generates 50 Qs

## Difficulty
- `easy` — 5 pts, `medium` — 10 pts, `hard` — 15 pts
- `adaptive` — starts medium, adjusts based on 2-right-in-a-row / 2-wrong-in-a-row

---

## Known Sandbox Limitation
The git `.git/index.lock` file sometimes gets stuck in the bash sandbox — Claude cannot remove it. Always tell the user to run git commands from their own terminal, not via Claude's bash tool.

---

## npm Packages Installed
- `express` — HTTP server and `/api/claude` proxy
- `graphify` — installed (check usage as needed)
