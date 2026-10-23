# Database schema

PostgreSQL. Migrations are plain SQL files in `server/migrations/`, applied in filename order by `server/migrate.ts` (tracked in `schema_migrations`, each in a transaction, serialised with an advisory lock). Add a change as a new file (`002_….sql`); never edit an applied migration.

Every user-owned table references `users(id) ON DELETE CASCADE`, so deleting an account removes all its data.

| Table | Purpose | Key constraints / indexes |
| --- | --- | --- |
| `users` | email, username, scrypt password hash, email verification time | unique `lower(email)`, unique `lower(username)`, username format check |
| `profiles` | bio, avatar id, 2-letter country, keyboard | 1:1 with users |
| `sessions` | login sessions; `id` is the **SHA-256 of the cookie token** (the token itself is never stored) | index on user, expiry; expired rows purged hourly |
| `email_tokens` | single-use verification / password-reset tokens (hashed) | `kind` check, expiry, `used_at` |
| `preferences` | the user's validated settings object (JSONB) for cross-device sync | 1:1 with users |
| `test_results` | one row per completed test: config, the **server-replayed** numbers, per-second timeline, per-key stats, eligibility + reasons, PB flag, imported flag | `UNIQUE(user_id, client_id)` prevents duplicate submissions; `(user_id, created_at DESC)` for history; partial indexes `WHERE leaderboard_eligible` on `(mode, mode2, language, created_at)` and `(mode, mode2, language, wpm DESC, accuracy DESC)` for leaderboards |
| `test_replays` | words + keystroke events of ranked results, for auditing | 1:1 with result |
| `personal_records` | best result per (user, mode, mode2, language, punctuation, numbers) | composite PK; updated in the same transaction as the result with `SELECT … FOR UPDATE` |
| `user_achievements` | unlocked achievement ids | PK (user, achievement) |
| `lesson_progress` | attempts, best wpm/accuracy, first pass time per lesson | PK (user, lesson) |
| `goals` | daily test / minute / wpm targets | range checks |
| `rooms` | multiplayer rooms (history; live state is in server memory) | index on code |
| `matches` | one row per finished race: language, text, start/end, end reason | |
| `match_participants` | per-player place, outcome (`win`/`loss`/`draw`/`dnf`), wpm, accuracy, finish time; guests have `user_id NULL` + `guest_name` | PK (match, seat); index on user |

## Static datasets

Word lists, quotes, lessons, achievements and themes are versioned TypeScript data in `shared/` rather than database tables. They are read-only content shipped with the code: the browser needs them offline, and the server needs identical copies to validate results. Only user activity related to them (results, progress, unlocks) is stored in the database. Moving them into tables would only be worth it if they need editing at runtime (e.g. an admin UI).

## Transactions

- Saving a result (insert, replay log, personal record, lesson progress, achievements) is a single transaction.
- Registration (user + profile) and password reset (consume token, update hash, revoke sessions) are transactions.
- Saving a race (match + participants + achievements) is a transaction.
