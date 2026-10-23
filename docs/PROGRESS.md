# Development progress

Last updated: 2026-10-23. Read this first when continuing development.

## Current state

The project was started from an empty directory. Phases 1–12 of the development plan have been implemented and tested:

- Typecheck: clean
- Unit and integration tests (`npm test`): 127 passing, 6 files. Integration tests run on a real PostgreSQL database.
- End-to-end tests (`npm run test:e2e`): 14 passing (13 desktop Chrome, 1 Pixel 7 mobile), against the production build
- Production build: succeeds (main bundle ~98 KB gzip; other pages lazy-loaded)

## Feature checklist

### Typing engine (`shared/engine.ts`, `src/typing/`)
- [x] Time (15/30/60/120 + custom 5–3600 s), words (10/25/50/100 + custom 1–1000), quote, custom text, practice (no timer)
- [x] Punctuation, numbers, word-list size, difficulty (normal/expert/master), strict mode
- [x] Correct / incorrect / extra / missed / pending letters; error underline on submitted wrong words; typo display modes
- [x] Backspace, going back to a previous wrong word, freedom mode, confidence on/max, Ctrl+Backspace, autocorrect-style replacements
- [x] Timestamp-based timing (performance.now); exact end at the limit; finish exactly once; no timers left after restart (unmount cleanup)
- [x] Mobile input (hidden input, word+space insertion), IME composition, paste block/allow (allowed paste = unranked)
- [x] Leave-page warning during a test; Tab restart; focus handling
- [x] WPM, raw, accuracy, consistency, characters, errors, backspaces, per-second timeline, per-key stats
- [x] Unicode: NFC normalisation, code-point comparison, grapheme-cluster rendering, RTL

### Product
- [x] Results screen with chart, PB indicator, save status + retry, leaderboard eligibility, achievements unlocked
- [x] Settings (central zod schema in `shared/config.ts`), local persistence, account sync (newest wins), import/export, reset
- [x] 13 themes + custom colours, live theme preview, fonts, font size, caret style/animation/blink, reduced motion, sounds (Web Audio)
- [x] 9 languages: English, Spanish, French, German, Portuguese (full); Hindi, Urdu, Punjabi, Arabic (beta: need a native keyboard / IME)
- [x] Accounts: register, login (email or username), logout, forgot/reset password, email verification, profile, avatar, username change, password change, data export, account deletion
- [x] Guest results kept on the device and importable after sign-in (re-verified, never ranked)
- [x] Statistics: totals, records, trends, consistency, per-language and per-mode tables, filters, paginated history, result detail
- [x] Leaderboards: daily/weekly/monthly/all-time, time/words lengths, language, country, search, pagination, own rank, PB markers, empty/loading/error states, visible rules
- [x] Multiplayer: rooms with codes and invite links, ready/start, synchronized countdown, server-authoritative progress, live opponents, results (win/loss/draw/dnf), disconnect + 30 s rejoin, abandoned-room cleanup, race time limit, persisted match history
- [x] Practice: 11 lessons with finger guidance and an on-screen keyboard, daily challenge, weak-key drill, custom text, daily goals
- [x] 20 achievements, unlocked server-side from real activity only
- [x] Keyboard shortcuts with reference panel; command palette
- [x] Security: scrypt hashing, hashed session and email tokens, httpOnly SameSite cookies, CSRF origin + JSON checks, rate limits, CSP and security headers, zod validation everywhere, ownership checks

## Known limitations / honest caveats

1. **Email delivery** needs `SMTP_URL`. Without it, links are written to the server log (fine for development, not production).
2. **Anti-cheat** is strong against edited numbers but cannot prove a human typed a keystroke log; a determined cheater can forge a plausible log. Ranked logs are kept in `test_replays` for review, but there is no admin/moderation UI yet.
3. **Single instance:** multiplayer rooms and rate-limit counters are in memory. Scaling out needs sticky WebSocket sessions + a shared store (Redis).
4. **Beta languages** (Hindi, Urdu, Punjabi, Arabic) pass automated generation/rendering/typing tests, but have not been tested by native speakers with real IMEs. Word lists are short (150–175 words; the other languages have 230–540) and were written for this project; review by native speakers is recommended.
5. **Lessons** assume a QWERTY layout and English.
6. **Multiplayer "invite"** means sharing the room link/code; there are no in-app notifications or friend lists.
7. Fonts load from Google Fonts (the CSP allows it). Self-host them if third-party requests are unwanted.
8. No load testing has been done.

## Suggested next tasks

1. Moderation: admin role, view/invalidate suspicious ranked results using `test_replays`.
2. Redis-backed rooms/rate limits for horizontal scaling.
3. Native-speaker review and larger word lists for the beta languages; more quotes.
4. Alternative keyboard layouts (Dvorak, Colemak, AZERTY) for lessons and the on-screen keyboard.
5. Visual regression tests for themes.
