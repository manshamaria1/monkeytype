import { Router } from "express";
import type pg from "pg";
import { ACHIEVEMENTS } from "../../shared/achievements";
import { ah, HttpError } from "../http";

/** Public profile: only data the user would expect to be public (no email, no full history). */
export function userRoutes(db: pg.Pool) {
  const r = Router();
  r.get(
    "/:username",
    ah(async (req, res) => {
      const username = String(req.params.username);
      if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw new HttpError(404, "User not found");
      const { rows } = await db.query(
        `SELECT u.id, u.username, u.created_at, p.bio, p.avatar, p.country, p.keyboard
           FROM users u JOIN profiles p ON p.user_id = u.id WHERE lower(u.username) = lower($1)`,
        [username],
      );
      const user = rows[0];
      if (!user) throw new HttpError(404, "User not found");
      const [records, totals, achievements, matches] = await Promise.all([
        db.query(
          `SELECT mode, mode2, language, wpm, accuracy, created_at FROM personal_records
            WHERE user_id = $1 AND NOT punctuation AND NOT numbers ORDER BY mode, (mode2)::int`,
          [user.id],
        ),
        db.query(
          `SELECT count(*)::int AS tests, COALESCE(sum(duration_ms), 0)::bigint AS time_ms, COALESCE(sum(correct_words), 0)::bigint AS words
             FROM test_results WHERE user_id = $1 AND NOT failed`,
          [user.id],
        ),
        db.query(`SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = $1 ORDER BY unlocked_at`, [user.id]),
        db.query(
          `SELECT count(*) FILTER (WHERE outcome = 'win')::int AS wins, count(*) FILTER (WHERE outcome = 'loss')::int AS losses,
                  count(*) FILTER (WHERE outcome = 'draw')::int AS draws FROM match_participants WHERE user_id = $1`,
          [user.id],
        ),
      ]);
      const t = totals.rows[0];
      res.json({
        username: user.username,
        joined: user.created_at,
        bio: user.bio,
        avatar: user.avatar,
        country: user.country,
        keyboard: user.keyboard,
        records: records.rows,
        totals: { tests: t.tests, timeMs: Number(t.time_ms), words: Number(t.words) },
        achievements: achievements.rows
          .map((a) => {
            const def = ACHIEVEMENTS.find((d) => d.id === a.achievement_id);
            return def ? { id: def.id, title: def.title, icon: def.icon, description: def.description, unlockedAt: a.unlocked_at } : null;
          })
          .filter(Boolean),
        matches: matches.rows[0],
      });
    }),
  );
  return r;
}
