# Monkeytype

A full-stack typing-test platform: typing tests with accurate, server-verified results, accounts, history and statistics, database-backed leaderboards, real-time multiplayer races, lessons, daily challenges and achievements.

> Name and branding: this project uses the name "Monkeytype" as requested. Its code, themes and assets are original. Before any public launch, check your rights to the name and branding.

## Architecture

| Part | Technology | Where |
| --- | --- | --- |
| Typing engine, scoring, validation, word generation, languages, lessons | TypeScript, no DOM (runs in browser **and** server) | `shared/` |
| Web client | React 19 + TypeScript, Vite, plain CSS with theme tokens | `src/` |
| API + multiplayer | Node.js, Express 5, `ws` WebSockets | `server/` |
| Database | PostgreSQL (plain SQL migrations, `pg` driver) | `server/migrations/` |
| Tests | Vitest (unit + integration on a real database), Playwright (E2E) | `tests/`, `e2e/` |

Why this shape:

- **One engine everywhere.** The browser records every keystroke as an event (`{t, k, v}`) and computes results with `shared/engine.ts`. When a result is saved, the server replays the same event log through the same engine and stores **its own** numbers. Edited numbers, wrong word lists, wrong durations and impossible timings are rejected. History, statistics and leaderboards all read those stored server values.
- **A long-running Node server** (not serverless) because multiplayer needs persistent WebSocket connections and authoritative in-memory room state.
- **Minimal dependencies:** Express, `pg`, `ws`, `zod`, `nodemailer`, React and React Router. Charts, sounds (Web Audio), password hashing (Node's `scrypt`), rate limiting and security headers are implemented in the project.

```
browser ── keystroke events ──► TypingSession ─► TypingEngine (shared) ─► live UI / results
   │                                                     ▲
   └── POST /api/results {words, events, claimed} ──► verifySubmission() replays ─► PostgreSQL
   └── WebSocket /ws (races) ──► MultiplayerHub: per-player TypingEngine, server clock, outcomes
```

## Quick start (development)

Requirements: Node.js 20+ (22 recommended), PostgreSQL 14+.

```bash
npm install
cp .env.example .env            # then edit DATABASE_URL if needed
createdb monkeytype             # or create it with your Postgres tooling
npm run migrate                 # optional: the server also migrates on start
npm run dev                     # API on :3000, web app on http://localhost:5173
```

Without `SMTP_URL`, verification and password-reset emails are **printed to the server log** instead of sent.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API (tsx watch) + Vite dev server with proxy for `/api` and `/ws` |
| `npm run build` | Typecheck, build the client to `dist/client`, bundle the server to `dist/server` |
| `npm run build:preview` | Build `dist/monkeytype-preview.html`: one self-contained page (no server) with the typing test, settings and practice, for quick demos |
| `npm start` | Run the production build (serves API, WebSockets and the client on one port) |
| `npm run migrate` / `npm run migrate:prod` | Apply database migrations (source / built) |
| `npm test` | Unit + integration tests (needs `TEST_DATABASE_URL`; that database is **wiped**) |
| `npm run test:unit` | Unit tests only (no database needed) |
| `npm run test:e2e` | Builds, starts the app on :3100 against `monkeytype_e2e` (**wiped**), runs Playwright |

Test databases: integration tests refuse to run unless the database name contains `test`; E2E refuses unless it contains `e2e`.

```bash
createdb monkeytype_test && createdb monkeytype_e2e
```

Playwright uses its own Chromium, or `CHROMIUM_PATH` / `/opt/pw-browsers/chromium` when present.

`scripts/dev/*.mjs` are small screenshot helpers used for visual review; they are not part of the test suite.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://monkey:monkey@localhost:5432/monkeytype` | Main database |
| `TEST_DATABASE_URL` | `…/monkeytype_test` | Integration tests (wiped) |
| `E2E_DATABASE_URL` | `…/monkeytype_e2e` | End-to-end tests (wiped) |
| `PORT` | `3000` | HTTP + WebSocket port |
| `APP_URL` | `http://localhost:5173` | Public URL used in email links and the CSRF origin check |
| `NODE_ENV` | – | `production` enables `Secure` cookies and HSTS |
| `SMTP_URL` | – | e.g. `smtp://user:pass@smtp.example.com:587`. Unset = emails go to the log |
| `FRAME_ANCESTORS` | – | Space-separated origins allowed to embed the app in an iframe (e.g. a WordPress site). Unset = embedding blocked |
| `MAIL_FROM` | `Monkeytype <no-reply@example.com>` | Sender address |

Secrets live only in the server environment; nothing secret is bundled into the client.

## Deployment

1. Provision PostgreSQL and set `DATABASE_URL`, `APP_URL` (your HTTPS origin), `NODE_ENV=production`, and `SMTP_URL`/`MAIL_FROM` for real emails.
2. `npm ci && npm run build`
3. `npm run migrate:prod` (or let the server migrate on start; migrations take an advisory lock, so concurrent starts are safe).
4. `npm start` behind a TLS-terminating reverse proxy that forwards WebSocket upgrades on `/ws`. Nginx example:

   ```nginx
   location / {
     proxy_pass http://127.0.0.1:3000;
     proxy_http_version 1.1;
     proxy_set_header Upgrade $http_upgrade;
     proxy_set_header Connection "upgrade";
     proxy_set_header Host $host;
     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
     proxy_set_header X-Forwarded-Proto $scheme;
   }
   ```
5. Health check: `GET /api/health` (checks the database).

**Embedding in another site (e.g. WordPress):** set `FRAME_ANCESTORS` to that site's origin(s). Prefer serving the app on a subdomain of the same site (e.g. `type.example.com` for `example.com`): browsers then treat it as same-site, so sign-in works inside the iframe. From a completely different domain, many browsers block the login cookie inside iframes, so typing tests work but signing in may not; link to the app instead.

**Scaling limits (single instance by design today):** multiplayer rooms and rate-limit counters live in process memory. Run one instance, or before scaling out add sticky sessions for `/ws` plus a shared store (e.g. Redis) for rooms and rate limits.

## Calculations (summary)

Full definitions are on the in-app About page and in `shared/engine.ts`.

- **WPM (net):** characters of correctly typed words + their spaces (+ correct letters of the last, unfinished word) ÷ 5 ÷ minutes.
- **Raw WPM (gross):** all typed characters including errors, extras and spaces ÷ 5 ÷ minutes.
- **Accuracy:** correct keystrokes ÷ (correct + wrong keystrokes) × 100; corrected mistakes still count, backspaces are not keystrokes.
- **Consistency:** `100 × (1 − tanh(cv + cv³/3 + cv⁵/5))` where cv is the coefficient of variation of per-second raw speed.
- **Time:** measured with `performance.now()` from the first keystroke; timed tests end exactly at the limit, so background-tab timer throttling cannot change results.

## Leaderboard rules

Ranked: time 15/30/60/120 s and words 10/25/50/100, punctuation and numbers off, default word list (200 words), not pasted, not failed, accuracy ≥ 75 %, ≤ 350 WPM, keystroke timing not machine-regular. One entry per player (their best in the period). Order: WPM ↓, accuracy ↓, earlier result first. Periods are UTC calendar day / ISO week (Monday) / month / all time. Country boards use the profile country. The server replay prevents edited results but **cannot prove a human typed the log**; ranked keystroke logs are stored in `test_replays` for auditing.

## WordPress plugin

`npm run build:wp` builds `dist/typing-test.zip`, a WordPress plugin with the whole app (accounts are WordPress users, multiplayer uses HTTP polling, results are checked by a PHP port of the engine). See `docs/WORDPRESS.md`.

## Documentation

- `docs/SCHEMA.md` – database tables and indexes
- `docs/WORDPRESS.md` – the WordPress plugin: install, architecture, build and tests
- `docs/PROGRESS.md` – feature checklist, test status, known limitations and next steps
