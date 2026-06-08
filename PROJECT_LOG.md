# QuizMania — Project Log

**Owner:** Vasanth Sanil (vasanth.sanil@gmail.com)  
**Live URL:** https://quizmania-pap3.onrender.com  
**GitHub:** push to main → Render auto-deploys in ~1 min  
**Last updated:** May 2026

---

## What This Is

An AI-powered quiz app for the whole family (kids, tweens, teens, adults 18+). Questions are generated dynamically by Claude AI (claude-haiku-4-5-20251001). Built as a single-file web app, served by Express on Render (free tier). Plan is to share with family/friends for 1–2 months, then wrap as iOS/Android app and monetize.

---

## Architecture

| File | Purpose |
|------|---------|
| `index.html` | Entire frontend — HTML + CSS + JS (no build tools) |
| `server.js` | Express server — serves index.html, proxies `/api/claude` (hints), `/api/questions` (cached generation), auth endpoints, leaderboard |
| `sw.js` | Service worker — app shell caching, offline fallback |
| `package.json` | Node deps (express only) |
| `manifest.json` | PWA manifest |
| `CLAUDE.md` | Instructions for Claude — key rules, architecture, deployment steps |

**Deployment:** Render free tier Web Service  
- Build: `npm install`  
- Start: `node server.js`  
- Env vars on Render: `ANTHROPIC_API_KEY`, `GITHUB_TOKEN` (never in code)

---

## Features Built

### Auth & Profiles
- Username + password account system
- Profile stored in GitHub Gist (registry Gist maps username → {gistId, passwordHash})
- Per-user Gist stores: {profile, history, asked}
- Auto-login on load from `qm_auth` localStorage
- Guest mode: local profiles only, no cloud sync
- Cloud save after every quiz (`cloudSave()`)

### Age Groups
- 🐣 Kids (8–11)
- 🧒 Tweens (12–14)
- 🧑 Teens (15–18)
- 🔞 Adults (18+) — requires one-click age confirmation modal; unlocks adult topics + adult fun packs

### Topics (14 standard + 6 adult-only)
Standard: Mathematics, Science, Flag Quiz, World Atlas, Geography, History, Technology, Sports, General Knowledge, Space & Astronomy, Animals & Nature, Music & Arts, Movies & TV, IPL Cricket

Adult-only: Food & Drink, Politics & World Affairs, Literature & Books, Mythology & Ancient History, Business & Finance, Science & Medicine

### Fun Packs
Kids/Family: Harry Potter, Minecraft, Marvel, Disney, Premier League, Pokémon, Taylor Swift, Olympics  
Adults: Netflix, True Crime, Classic Rock, Pub Quiz, World Politics, Food & Wine, Literature, World Cinema

### Quiz Engine
- Modes: Questions (5/10/15/20/30/50), Timed (60s/90s/2min/5min/10min/15min), True/False
- Difficulty: Easy (5pts), Medium (10pts), Hard (15pts), Adaptive (auto-adjusts)
- Combo multiplier: 3+ correct = ×1.5, 5+ = ×2
- 50:50 lifeline, Claude hint, per-question timer, voice readout
- Anti-repeat: question hashes stored per topic-difficulty bucket, sent to Claude as "avoid repeating", cap 200 then reset

### XP & Levels
10 levels: Novice → Explorer → Scholar → Expert → Master → Genius → Prodigy → Legend → Champion → Quiz God

### Leaderboard
- Global (all registered users, from GitHub Gist registry)
- Local (this device profiles)
- Sort by: Avg Score, Best Score, Most Quizzes
- Refresh button, expanded stats, global rank badge on home screen

### Daily Challenge
- 10 General Knowledge questions, same seed for everyone each day
- Marked done once completed, resets next day

### Performance & Cost
- **Server-side question cache:** 6-hour TTL, 200 questions/bucket — expected 60–70% fewer Claude API calls
- **Rate limiting:** 40 requests/IP/hour on `/api/questions`
- **Service worker:** app shell cached, offline fallback page
- Keep-alive ping every 14 min to prevent Render free tier sleep

### UX
- **Landing screen** for first-time visitors (before auth)
- **Bottom nav bar** on mobile ≤768px (Home / Play / Ranks / History / Profile)
- **Haptic feedback:** double pulse = correct, long buzz = wrong (`navigator.vibrate`)
- **Slide transitions:** screens slide left/right based on navigation direction
- **Safe area support:** `env(safe-area-inset-*)` for iPhone notch/home indicator
- **Invite Friends** card (Web Share API)
- **Feedback floating button** (opens mailto)
- Dark/light theme toggle, mute toggle
- Confetti on 70%+ score, level-up modal, achievement chips

---

## Monetization Plan (future)

| Phase | Plan |
|-------|------|
| Now | Free for everyone — circulate with family/friends 1–2 months |
| Web | AdSense on **adult profiles only** (COPPA — no ads on kids/teens) |
| Mobile | Capacitor wrapper → App Store + Play Store |
| Mobile ads | AdMob rewarded ads (optional, skippable) |
| Optional | One-time "Remove Ads" IAP (~$1.99) |

**Why adults-only ads:** COPPA compliance. Kids/teens see zero ads — this is both legally required and a selling point for parents.

---

## Key Implementation Rules (do not break)

1. **Answer matching:** Always index-based (`pickAnswer(this, ${i})`), never put answer strings in `onclick` — apostrophes break HTML
2. **Timer:** Start AFTER `generateQuestions()` resolves — never before
3. **Timed mode:** Generate 50 questions upfront
4. **Modals:** Always use custom `showModal()`, never `confirm()`
5. **API key:** `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` must be env vars on Render — NEVER in code
6. **Question generation:** Frontend calls `/api/questions` (server cache) — never Anthropic API directly
7. **Hints only:** `/api/claude` endpoint is kept for hint requests only

---

## Next Steps (not yet built)

- [x] Swipe gestures between screens
- [x] Pull-to-refresh on leaderboard
- [x] AdSense integration (adults only)
- [x] PWA install banner
- [x] Question reporting (🚩 flag button)
- [x] Offline question cache
- [x] Topic progress rings
- [x] Onboarding tutorial (3-step modal)
- [x] Weekly challenge
- [x] Leaderboard age group filter
- [x] More fun packs (Fortnite, F1, K-Pop, Squid Game, NFL, Roblox + more)
- [x] Capacitor iOS/Android wrapper — code done, user runs `npx cap add ios/android` from terminal
- [ ] AdMob rewarded ads (mobile, depends on Capacitor)
- [ ] App Store / Play Store submission (depends on Capacitor)

---

## Session Log

### Session 15 (June 8, 2026) — Faster quiz start (cold start + prefetch fixes)
- **Problem:** Questions loaded slowly at the start of a quiz. Three root causes found and fixed.
- **1. Render free-tier cold start** (server sleeps after ~15 min idle; first request waited 30–50s):
  - `server.js`: added lightweight `GET /api/health` → `{ok:true}`.
  - `index.html`: pings `/api/health` on app load (in `window load`) to wake the server while the user is still on the home screen.
- **2. The "quick" first batch was over-generating.** The client asked for 2 questions but the server padded every request with `+10` (for cache warming), so even the fast first call generated ~12 questions.
  - `server.js`: `genCount = count <= 4 ? count : count + 10` — small quick-start batches now generate exactly what's asked. `max_tokens` for tiny batches dropped to 1200 → faster first response. Larger batches still pad +10 to warm the cache.
- **3. Prefetch was thrown away on every settings change.** `goToSettings()` started a prefetch with default settings, but `selectMode/Count/Time/Diff` each set `_prefetch=null`, so anyone who tweaked a setting lost it and re-fetched fresh on Start.
  - New `triggerPrefetch()` (debounced 250ms) invalidates immediately (no stale prefetch) then re-warms for the *current* settings. Called from `goToSettings` + all four `select*` handlers.
  - `selectQTimer` no longer nulls the prefetch (the per-question timer doesn't change question content).
  - Quick-start buffer bumped from 2 → 3 questions across `goToSettings`/`triggerPrefetch`, `startQuiz` fallback, and the daily/challenge prefetch.
- Verified `server.js` and `index.html` both parse.

### Session 14 (June 8, 2026) — Save & Resume quiz + combo badge overlap fix
- **Save & Quit / Resume:**
  - "✕ Quit" now opens a modal with **💾 Save & Quit** (in addition to Keep Playing / Quit). Saving snapshots the full quiz to `localStorage` key `qm_saved_quiz_{pid}` — questions, score, answers, streak/combo, adaptive difficulty, lifelines, toggles, elapsed time, and (timed mode) `timerLeft`.
  - Home screen shows a purple **"⏸️ Resume your quiz"** banner when a save exists (`updateResumeBanner()` in the `home` showScreen hook). Tapping it calls `resumeQuiz()` — restores all globals + `qe`, re-shows the quiz screen, restarts the timed countdown if needed, and continues at the next un-answered question (`idx = answers.length`, so no double-counting).
  - One save slot per profile. Save overwrites; resuming or finishing (`endQuiz` → `clearSavedQuiz()`) clears it. Save & Quit is hidden during replay mode.
  - New fns: `saveQuizState`, `getSavedQuiz`, `clearSavedQuiz`, `saveAndQuit`, `updateResumeBanner`, `resumeQuiz`, `_savedQuizKey`.
- **Combo badge hiding the question (iPad/mobile/desktop):** `.combo-badge` was `position:absolute; top:12px; left:12px`, sitting directly on top of the first line of question text. Moved it to a centered ribbon on the card's top edge (`top:-14px; left:50%; translateX(-50%)`, with `pointer-events:none` + shadow). Updated the `comboPop` keyframes to keep the `translateX(-50%)` during the scale animation so it stays centered.
- Verified all script blocks parse; `.question-card` has no `overflow:hidden` so the ribbon isn't clipped.

### Session 13 (June 7, 2026) — Fix: questions auto-advancing without an answer
- **Bug:** Reported in a FIFA 2026 quiz — questions skipped to the next without the player's answer registering.
- **Root cause:** A redundant second "Next →" button was rendered at the *top* of the question (above the question card) in addition to the one in the footer. On mobile it popped up right where players tap answers, so a fast double-tap / ghost-click hit Next and skipped the question before the answer counted. (Per-question timer ruled out — user never enabled it; default is Off.)
- **Fix in `index.html`:**
  - Removed the duplicate top `next-quiz-btn` (only the footer `#next-btn` remains).
  - Added a tap-guard in `nextQuestion()` — ignores a Next activation within 450ms of an answer being revealed. Sets `qe._answeredAt` in both `pickAnswer()` and `autoTimeUp()`.
- Verified all script blocks still parse; only one Next button remains.

- **Second bug (the real one the user saw): FIFA World Cup 2026 Predictions auto-advancing / "self-answering."**
  - **Root cause:** The *deployed* (HEAD) version of `revealPrediction()` had `setTimeout(()=>{ if(_currentFifaIdx()===currentIdx) fifaNav(1); }, 4000)` — a 4-second auto-advance after each pick. Because `renderCurrentFifaMatch()` re-reveals already-picked matches, the auto-advance cascaded: one pick → jumps every 4s through every already-picked match → marched to Match 37 of 37 ("You've predicted all matches!"). Looked like it answered by itself.
  - The working copy had already removed the timer locally but **it was never pushed** — so the live site kept doing it.
  - **Fix in `index.html`:**
    - Confirmed the 4s auto-advance `setTimeout` is gone; only a manual "Next Match →" button remains. Updated the stale comment.
    - Added a **🔄 Reset** button in the FIFA header + `resetFifaPicks()` (uses custom `showModal`, per project rule — no `confirm()`). Clears `_fifaPicks` + `qm_fifa_picks`, keeps cached expert preds, resets to Match 1 so the user can re-predict.
  - **Action for user:** push so live gets the fix, then tap 🔄 Reset to clear the auto-filled picks and predict matches manually.

### Session 1–3 (early builds)
- Built initial quiz app, deployed to Render
- Added multi-profile picker, topic grid, settings screen
- Fixed answer matching bug (index-based approach)

### Session 4–5
- Added GitHub Gist cloud sync
- Built username/password auth with Gist registry
- Added per-question timer, mute, confetti, voice

### Session 6
- Added global leaderboard (all registered users)
- Sort by avg/best/quizzes, refresh button, rank badge on home

### Session 9 (May 2026) — Wrap-up confirmation
- User confirmed all work from this session is done
- Reminded to push code: `git commit + git push` from terminal
- Render will auto-deploy in ~1 min after push

### Session 8 (May 2026) — Project Log Setup
- User asked how to save conversations from Cowork — explained Cowork has no built-in export (research preview)
- Created `PROJECT_LOG.md` as a living project record
- Added rule to `CLAUDE.md` so Claude automatically updates PROJECT_LOG.md at the end of every session without being asked
- Confirmed all Session 7 changes were complete and ready to push

### Session 12 (May 2026) — Capacitor iOS/Android Wrapper

- **`capacitor.config.json`** — App ID `com.quizmania.app`, webDir `www`, SplashScreen (dark purple, 1.5s), StatusBar dark
- **`package.json`** — Added Capacitor 6 devDependencies: core, cli, ios, android, splash-screen, status-bar, haptics. Added scripts: `build:www`, `cap:sync`, `cap:ios`, `cap:android`
- **`www/`** — Build output folder; `npm run build:www` copies index.html + manifest.json here before Capacitor sync
- **`index.html`** — Added `_isNative` / `API_BASE` detection. All 6 `/api/` fetch calls now use `API_BASE + '/api/...'` so bundled app hits `https://quizmania-pap3.onrender.com` from inside iOS/Android
- **`server.js`** — CORS middleware added: allows `capacitor://localhost` (iOS), `http://localhost` (Android), `ionic://localhost`, and the Render domain

**User still needs to run (requires Xcode / Android Studio on Mac):**
1. `npm install` — installs Capacitor packages
2. `npx cap add ios` + `npx cap add android` — first time only
3. `npm run cap:ios` / `npm run cap:android` — opens IDE
4. Apple Developer account ($99/yr) for App Store submission

### Session 11 (May 2026) — Onboarding, Weekly Challenge, More Packs & Leaderboard

**New features:**
- **Onboarding tutorial** — 3-step modal on first login (topic picking → lifelines → streaks/leaderboard). Dot step indicators, skip button. Stored in `qm_onboarded` localStorage.
- **Weekly challenge** — Purple banner on home screen alongside daily. 20 questions, topic rotates weekly by ISO week seed (same topic for all players), resets every Monday. Stored in `qm_weekly_{pid}`.
- **Leaderboard age group filter** — Filter pills (All / Kids / Tweens / Teens / Adults) on global leaderboard. Age groups compete separately. Uses `p.age` field already in player data.
- **More fun packs** — 8 new kids/family packs: Fortnite, Squid Game, Formula 1, K-Pop/BTS, Stranger Things, NFL, Roblox, Among Us. 4 new adult packs: Sitcoms, Pop Culture, The 90s, Crypto & Tech.
- **Score animation** — Confirmed already built via `animateCount()`.

### Session 10 (May 2026) — Polish, Ads, Maps & UX Improvements

**AdSense integration:**
- AdSense publisher ID + slot ID injected server-side from env vars (`ADSENSE_PUBLISHER_ID`, `ADSENSE_SLOT_ID`) — never in code
- Ad container hidden until AdSense actually fills the slot (polls `data-ad-status="filled"`)
- `initAds()` wired up in `selectProfile()` — adults-only, COPPA compliant

**Branding cleanup:**
- Removed all "AI-powered" and "Powered by Claude AI" user-facing text
- New copy: "Think you know everything? Prove it! 🔥", "🧠 Thousands of questions. Zero repeats.", "Think fast. Score big. Become the Quiz God! 🏆"

**World Atlas maps:**
- Replaced broken rectangle SVG map with real Leaflet.js (OpenStreetMap) maps
- 100+ country lat/lng lookup table with per-country zoom levels
- Gold pin marker at country center, non-interactive (no accidental swipe during quiz)
- Flag Quiz: still uses flag emoji display (unchanged)
- World Atlas: pure geography text questions, no flag spoilers

**New features built:**
- **PWA install banner** — detects `beforeinstallprompt`, shows custom banner after login, dismiss state persisted
- **Question reporting** — 🚩 button in quiz, resets each question, logs to Render server via `/api/report`
- **Offline question cache** — questions stored in localStorage after each successful load; auto-fallback with toast on network failure
- **Topic progress rings** — circular SVG rings replacing flat strength bars; color-coded, tappable to set topic, scrollable row

**Already-confirmed existing features (not rebuilt):**
- Share results card (canvas + Web Share API) ✅
- Rematch / Replay button ✅
- Challenge a friend (encoded URL) ✅

### Session 7 (May 2026) — Full Production Upgrade
- **server.js:** Complete rewrite — server-side question cache (6hr TTL), rate limiting, prompt builder moved server-side, new `/api/questions` endpoint, adults age group in prompts
- **sw.js:** New — service worker, app shell caching, offline fallback
- **index.html:** Landing screen, Adults 18+ age group + confirmation modal, 6 adult topics, 8 adult fun packs, mobile bottom nav, haptic feedback, slide transitions, safe area CSS, Invite Friends card, feedback FAB, SW registration, `generateQuestions()` → `/api/questions`
