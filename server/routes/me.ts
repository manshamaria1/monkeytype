import { Router } from "express";
import { z } from "zod";
import type pg from "pg";
import { configSchema, sanitizeConfig } from "../../shared/config";
import { ACHIEVEMENTS } from "../../shared/achievements";
import { LESSONS } from "../../shared/lessons";
import { currentUser, hashPassword, requireUser, verifyPassword, clearSessionCookie } from "../auth";
import { tx } from "../db";
import { ah, HttpError, parseBody } from "../http";
import { rateLimit } from "../security";
import { passwordSchema, usernameSchema } from "./auth";
import { AVATARS } from "../../shared/avatars";

const filterSchema = z.object({
  mode: z.string().max(20).optional(),
  mode2: z.string().max(40).optional(),
  language: z.string().max(40).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** Builds a WHERE clause for the shared history/stats filters. */
function filters(userId: number, q: z.infer<typeof filterSchema>, alias = "") {
  const a = alias ? alias + "." : "";
  const where = [`${a}user_id = $1`];
  const params: unknown[] = [userId];
  const add = (cond: string, v: unknown) => {
    params.push(v);
    where.push(cond.replace("?", `$${params.length}`));
  };
  if (q.mode) add(`${a}mode = ?`, q.mode);
  if (q.mode2) add(`${a}mode2 = ?`, q.mode2);
  if (q.language) add(`${a}language = ?`, q.language);
  if (q.from) add(`${a}created_at >= ?`, q.from);
  if (q.to) add(`${a}created_at < ?`, q.to);
  return { where: where.join(" AND "), params };
}

const RESULT_COLUMNS = `id, mode, mode2, language, word_list_size, punctuation, numbers, difficulty, strict_mode, wpm, raw_wpm,
  accuracy, consistency, correct_chars, incorrect_chars, extra_chars, missed_chars, errors, backspaces, correct_words,
  duration_ms, failed, leaderboard_eligible, ineligible_reasons, is_pb, imported, created_at`;

const profileSchema = z.object({
  username: usernameSchema.optional(),
  bio: z.string().max(300).optional(),
  avatar: z.enum(AVATARS.map((a) => a.id) as [string, ...string[]]).optional(),
  country: z
    .string()
    .regex(/^[A-Za-z]{2}$/, "Use a two-letter country code")
    .transform((s) => s.toUpperCase())
    .nullable()
    .optional(),
  keyboard: z.string().max(60).optional(),
});

export function meRoutes(db: pg.Pool) {
  const r = Router();
  r.use(requireUser);

  // ---- preferences (settings sync) ----
  r.get(
    "/preferences",
    ah(async (req, res) => {
      const { rows } = await db.query(`SELECT config, updated_at FROM preferences WHERE user_id = $1`, [currentUser(req).id]);
      res.json(rows[0] ? { config: sanitizeConfig(rows[0].config), updatedAt: rows[0].updated_at } : { config: null });
    }),
  );
  r.put(
    "/preferences",
    rateLimit({ name: "prefs", windowMs: 60_000, max: 60, key: (req) => String(req.user?.id) }),
    ah(async (req, res) => {
      const config = parseBody(z.object({ config: configSchema }), req.body).config;
      await db.query(
        `INSERT INTO preferences (user_id, config) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET config = EXCLUDED.config, updated_at = now()`,
        [currentUser(req).id, JSON.stringify(config)],
      );
      res.json({ ok: true });
    }),
  );

  // ---- profile ----
  r.get(
    "/profile",
    ah(async (req, res) => {
      const u = currentUser(req);
      const { rows } = await db.query(
        `SELECT u.username, u.email, u.email_verified_at IS NOT NULL AS email_verified, u.created_at, p.bio, p.avatar, p.country, p.keyboard
           FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = $1`,
        [u.id],
      );
      res.json(rows[0]);
    }),
  );
  r.patch(
    "/profile",
    ah(async (req, res) => {
      const u = currentUser(req);
      const body = parseBody(profileSchema, req.body);
      try {
        await tx(db, async (c) => {
          if (body.username && body.username !== u.username) {
            await c.query(`UPDATE users SET username = $1 WHERE id = $2`, [body.username, u.id]);
          }
          await c.query(
            `UPDATE profiles SET bio = COALESCE($2, bio), avatar = COALESCE($3, avatar),
                    country = CASE WHEN $5 THEN $4 ELSE country END, keyboard = COALESCE($6, keyboard), updated_at = now()
              WHERE user_id = $1`,
            [u.id, body.bio ?? null, body.avatar ?? null, body.country ?? null, body.country !== undefined, body.keyboard ?? null],
          );
        });
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw new HttpError(409, "This username is taken.");
        throw e;
      }
      res.json({ ok: true });
    }),
  );

  r.post(
    "/password",
    rateLimit({ name: "pw", windowMs: 60_000, max: 5, key: (req) => String(req.user?.id) }),
    ah(async (req, res) => {
      const u = currentUser(req);
      const body = parseBody(z.object({ current: z.string().min(1).max(200), next: passwordSchema }), req.body);
      const { rows } = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [u.id]);
      if (!(await verifyPassword(body.current, rows[0].password_hash))) throw new HttpError(403, "Current password is incorrect.");
      await db.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [await hashPassword(body.next), u.id]);
      // Sign out other devices.
      await db.query(`DELETE FROM sessions WHERE user_id = $1 AND id <> $2`, [u.id, u.sessionId]);
      res.json({ ok: true });
    }),
  );

  r.delete(
    "/",
    rateLimit({ name: "delete", windowMs: 60_000, max: 5, key: (req) => String(req.user?.id) }),
    ah(async (req, res) => {
      const u = currentUser(req);
      const body = parseBody(z.object({ password: z.string().min(1).max(200) }), req.body);
      const { rows } = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [u.id]);
      if (!(await verifyPassword(body.password, rows[0].password_hash))) throw new HttpError(403, "Password is incorrect.");
      // ON DELETE CASCADE removes sessions, results, records, progress, achievements and preferences.
      await db.query(`DELETE FROM users WHERE id = $1`, [u.id]);
      clearSessionCookie(res);
      res.json({ ok: true });
    }),
  );

  r.get(
    "/export",
    ah(async (req, res) => {
      const u = currentUser(req);
      const [profile, prefs, results, records, achievements, lessons, goals, matches] = await Promise.all([
        db.query(`SELECT u.username, u.email, u.created_at, p.bio, p.avatar, p.country, p.keyboard FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = $1`, [u.id]),
        db.query(`SELECT config FROM preferences WHERE user_id = $1`, [u.id]),
        db.query(`SELECT ${RESULT_COLUMNS}, timeline, key_stats FROM test_results WHERE user_id = $1 ORDER BY created_at`, [u.id]),
        db.query(`SELECT mode, mode2, language, punctuation, numbers, wpm, accuracy, raw_wpm, consistency, created_at FROM personal_records WHERE user_id = $1`, [u.id]),
        db.query(`SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = $1`, [u.id]),
        db.query(`SELECT lesson_id, attempts, best_wpm, best_accuracy, completed_at FROM lesson_progress WHERE user_id = $1`, [u.id]),
        db.query(`SELECT daily_tests, daily_minutes, target_wpm FROM goals WHERE user_id = $1`, [u.id]),
        db.query(`SELECT m.started_at, m.language, mp.place, mp.outcome, mp.wpm, mp.accuracy FROM match_participants mp JOIN matches m ON m.id = mp.match_id WHERE mp.user_id = $1 ORDER BY m.started_at`, [u.id]),
      ]);
      res.setHeader("Content-Disposition", `attachment; filename="monkeytype-${u.username}.json"`);
      res.json({
        exportedAt: new Date().toISOString(),
        profile: profile.rows[0],
        preferences: prefs.rows[0]?.config ?? null,
        results: results.rows,
        personalRecords: records.rows,
        achievements: achievements.rows,
        lessons: lessons.rows,
        goals: goals.rows[0] ?? null,
        matches: matches.rows,
      });
    }),
  );

  // ---- history ----
  r.get(
    "/results",
    ah(async (req, res) => {
      const q = parseBody(
        filterSchema.extend({
          limit: z.coerce.number().int().min(1).max(100).default(25),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        req.query,
      );
      const { where, params } = filters(currentUser(req).id, q);
      params.push(q.limit, q.offset);
      const { rows } = await db.query(
        `SELECT ${RESULT_COLUMNS}, count(*) OVER ()::int AS total FROM test_results WHERE ${where}
          ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      res.json({ results: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 });
    }),
  );

  r.get(
    "/results/:id",
    ah(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw new HttpError(400, "Invalid id");
      const { rows } = await db.query(`SELECT ${RESULT_COLUMNS}, timeline, key_stats FROM test_results WHERE id = $1 AND user_id = $2`, [
        id,
        currentUser(req).id,
      ]);
      if (!rows[0]) throw new HttpError(404, "Result not found");
      res.json(rows[0]);
    }),
  );

  r.get(
    "/stats",
    ah(async (req, res) => {
      const q = parseBody(filterSchema, req.query);
      const { where, params } = filters(currentUser(req).id, q);
      const ok = `${where} AND NOT failed`;
      const [totals, byLanguage, byMode, daily, records] = await Promise.all([
        db.query(
          `SELECT count(*)::int AS tests,
                  COALESCE(max(wpm), 0) AS best_wpm, COALESCE(round(avg(wpm), 2), 0)::float AS avg_wpm,
                  COALESCE(max(accuracy), 0) AS best_accuracy, COALESCE(round(avg(accuracy), 2), 0)::float AS avg_accuracy,
                  COALESCE(round(avg(consistency), 2), 0)::float AS avg_consistency,
                  COALESCE(sum(correct_chars + incorrect_chars + extra_chars), 0)::bigint AS chars_typed,
                  COALESCE(sum(correct_words), 0)::bigint AS words_typed,
                  COALESCE(sum(duration_ms), 0)::bigint AS time_ms,
                  (SELECT count(*)::int FROM test_results WHERE ${where} AND failed) AS failed_tests
             FROM test_results WHERE ${ok}`,
          params,
        ),
        db.query(
          `SELECT language, count(*)::int AS tests, round(avg(wpm), 2)::float AS avg_wpm, max(wpm) AS best_wpm, round(avg(accuracy), 2)::float AS avg_accuracy
             FROM test_results WHERE ${ok} GROUP BY language ORDER BY tests DESC`,
          params,
        ),
        db.query(
          `SELECT mode, mode2, count(*)::int AS tests, round(avg(wpm), 2)::float AS avg_wpm, max(wpm) AS best_wpm, round(avg(accuracy), 2)::float AS avg_accuracy
             FROM test_results WHERE ${ok} GROUP BY mode, mode2 ORDER BY tests DESC LIMIT 30`,
          params,
        ),
        db.query(
          `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::int AS tests,
                  round(avg(wpm), 2)::float AS avg_wpm, max(wpm) AS best_wpm,
                  round(avg(accuracy), 2)::float AS avg_accuracy, round(avg(consistency), 2)::float AS avg_consistency
             FROM test_results WHERE ${ok} GROUP BY day ORDER BY day DESC LIMIT 120`,
          params,
        ),
        db.query(
          `SELECT mode, mode2, language, punctuation, numbers, wpm, accuracy, raw_wpm, consistency, created_at, result_id
             FROM personal_records WHERE user_id = $1 ORDER BY mode, (mode2)::int, language`,
          [currentUser(req).id],
        ),
      ]);
      const t = totals.rows[0];
      res.json({
        totals: { ...t, chars_typed: Number(t.chars_typed), words_typed: Number(t.words_typed), time_ms: Number(t.time_ms) },
        byLanguage: byLanguage.rows,
        byMode: byMode.rows,
        daily: daily.rows.reverse(),
        records: records.rows,
      });
    }),
  );

  /** Letters with the highest miss rate over the last 50 tests. */
  r.get(
    "/weak-keys",
    ah(async (req, res) => {
      const { rows } = await db.query(
        `SELECT key_stats FROM test_results WHERE user_id = $1 AND language = 'english' ORDER BY created_at DESC LIMIT 50`,
        [currentUser(req).id],
      );
      const agg: Record<string, { hit: number; miss: number }> = {};
      for (const r of rows) {
        for (const [k, v] of Object.entries(r.key_stats as Record<string, { hit: number; miss: number }>)) {
          if (!/^[a-z]$/.test(k)) continue;
          const a = (agg[k] ??= { hit: 0, miss: 0 });
          a.hit += v.hit;
          a.miss += v.miss;
        }
      }
      const keys = Object.entries(agg)
        .filter(([, v]) => v.hit + v.miss >= 10)
        .map(([key, v]) => ({ key, ...v, missRate: v.miss / (v.hit + v.miss) }))
        .sort((a, b) => b.missRate - a.missRate);
      res.json({ keys, testsAnalysed: rows.length });
    }),
  );

  // ---- achievements, lessons, goals, matches ----
  r.get(
    "/achievements",
    ah(async (req, res) => {
      const { rows } = await db.query(`SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = $1`, [currentUser(req).id]);
      const unlocked = new Map(rows.map((r) => [r.achievement_id, r.unlocked_at]));
      res.json({
        achievements: ACHIEVEMENTS.map((a) => ({ id: a.id, title: a.title, description: a.description, icon: a.icon, unlockedAt: unlocked.get(a.id) ?? null })),
      });
    }),
  );

  r.get(
    "/lessons",
    ah(async (req, res) => {
      const { rows } = await db.query(
        `SELECT lesson_id, attempts, best_wpm, best_accuracy, completed_at FROM lesson_progress WHERE user_id = $1`,
        [currentUser(req).id],
      );
      res.json({ progress: rows, total: LESSONS.length });
    }),
  );

  const goalSchema = z.object({
    daily_tests: z.number().int().min(0).max(500),
    daily_minutes: z.number().int().min(0).max(600),
    target_wpm: z.number().int().min(0).max(400),
  });
  r.get(
    "/goals",
    ah(async (req, res) => {
      const u = currentUser(req);
      const [g, today] = await Promise.all([
        db.query(`SELECT daily_tests, daily_minutes, target_wpm FROM goals WHERE user_id = $1`, [u.id]),
        db.query(
          `SELECT count(*)::int AS tests, COALESCE(sum(duration_ms), 0)::bigint AS ms, COALESCE(max(wpm), 0) AS best_wpm
             FROM test_results WHERE user_id = $1 AND NOT failed AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
          [u.id],
        ),
      ]);
      const t = today.rows[0];
      res.json({ goals: g.rows[0] ?? null, today: { tests: t.tests, minutes: Math.round(Number(t.ms) / 6000) / 10, bestWpm: t.best_wpm } });
    }),
  );
  r.put(
    "/goals",
    ah(async (req, res) => {
      const g = parseBody(goalSchema, req.body);
      await db.query(
        `INSERT INTO goals (user_id, daily_tests, daily_minutes, target_wpm) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET daily_tests = $2, daily_minutes = $3, target_wpm = $4, updated_at = now()`,
        [currentUser(req).id, g.daily_tests, g.daily_minutes, g.target_wpm],
      );
      res.json({ ok: true });
    }),
  );

  r.get(
    "/challenges",
    ah(async (req, res) => {
      const { rows } = await db.query(
        `SELECT mode2 AS date, max(wpm) AS best_wpm, max(accuracy) AS best_accuracy, count(*)::int AS attempts
           FROM test_results WHERE user_id = $1 AND mode = 'challenge' AND NOT failed GROUP BY mode2 ORDER BY mode2 DESC LIMIT 60`,
        [currentUser(req).id],
      );
      res.json({ challenges: rows });
    }),
  );

  r.get(
    "/matches",
    ah(async (req, res) => {
      const u = currentUser(req);
      const [list, summary] = await Promise.all([
        db.query(
          `SELECT m.id, m.started_at, m.language, jsonb_array_length(m.words) AS word_count, mp.place, mp.outcome, mp.wpm, mp.accuracy,
                  (SELECT count(*)::int FROM match_participants x WHERE x.match_id = m.id) AS players
             FROM match_participants mp JOIN matches m ON m.id = mp.match_id
            WHERE mp.user_id = $1 ORDER BY m.started_at DESC LIMIT 50`,
          [u.id],
        ),
        db.query(
          `SELECT count(*) FILTER (WHERE outcome = 'win')::int AS wins, count(*) FILTER (WHERE outcome = 'loss')::int AS losses,
                  count(*) FILTER (WHERE outcome = 'draw')::int AS draws, count(*) FILTER (WHERE outcome = 'dnf')::int AS dnf
             FROM match_participants WHERE user_id = $1`,
          [u.id],
        ),
      ]);
      res.json({ matches: list.rows, summary: summary.rows[0] });
    }),
  );

  return r;
}
