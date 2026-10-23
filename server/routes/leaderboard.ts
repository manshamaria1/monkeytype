import { Router } from "express";
import { z } from "zod";
import type pg from "pg";
import { LEADERBOARD_RULES, PERIODS, periodStart } from "../../shared/results";
import { isLanguage } from "../../shared/languages";
import { currentUser, requireUser } from "../auth";
import { ah, HttpError, parseBody } from "../http";

const querySchema = z.object({
  period: z.enum(PERIODS).default("alltime"),
  mode: z.enum(["time", "words"]).default("time"),
  mode2: z.string().default("60"),
  language: z.string().default("english"),
  country: z
    .string()
    .regex(/^[A-Za-z]{2}$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  search: z.string().trim().max(20).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

type LbQuery = z.infer<typeof querySchema>;

function validate(q: LbQuery) {
  const n = Number(q.mode2);
  const allowed = q.mode === "time" ? LEADERBOARD_RULES.timeModes : LEADERBOARD_RULES.wordModes;
  if (!allowed.includes(n)) throw new HttpError(400, "This test length has no leaderboard");
  if (!isLanguage(q.language)) throw new HttpError(400, "Unknown language");
}

/**
 * Best eligible result per user for one board, ranked by WPM, then accuracy, then
 * the earlier result. Country boards rank only players from that country.
 */
function rankedCte(q: LbQuery) {
  const params: unknown[] = [q.mode, q.mode2, q.language, periodStart(q.period)];
  let countryFilter = "";
  if (q.country) {
    params.push(q.country.toUpperCase());
    countryFilter = `AND p.country = $${params.length}`;
  }
  const sql = `
    WITH best AS (
      SELECT DISTINCT ON (r.user_id) r.user_id, r.id, r.wpm, r.raw_wpm, r.accuracy, r.consistency, r.created_at
        FROM test_results r
        JOIN profiles p ON p.user_id = r.user_id
       WHERE r.leaderboard_eligible AND r.mode = $1 AND r.mode2 = $2 AND r.language = $3
         AND ($4::timestamptz IS NULL OR r.created_at >= $4) ${countryFilter}
       ORDER BY r.user_id, r.wpm DESC, r.accuracy DESC, r.created_at ASC
    ), ranked AS (
      SELECT best.*, ROW_NUMBER() OVER (ORDER BY wpm DESC, accuracy DESC, created_at ASC)::int AS rank FROM best
    )`;
  return { sql, params };
}

export function leaderboardRoutes(db: pg.Pool) {
  const r = Router();

  r.get("/rules", (_req, res) => res.json(LEADERBOARD_RULES));

  r.get(
    "/",
    ah(async (req, res) => {
      const q = parseBody(querySchema, req.query);
      validate(q);
      const { sql, params } = rankedCte(q);
      let where = "";
      if (q.search) {
        params.push(`%${q.search.replace(/[\\%_]/g, (m) => "\\" + m)}%`);
        where = `WHERE u.username ILIKE $${params.length}`;
      }
      params.push(q.pageSize, (q.page - 1) * q.pageSize);
      const { rows } = await db.query(
        `${sql}
         SELECT ranked.rank, ranked.id AS result_id, ranked.wpm, ranked.raw_wpm, ranked.accuracy, ranked.consistency,
                ranked.created_at, u.username, p.avatar, p.country,
                (pr.result_id IS NOT NULL) AS is_pb, count(*) OVER ()::int AS total
           FROM ranked
           JOIN users u ON u.id = ranked.user_id
           JOIN profiles p ON p.user_id = ranked.user_id
           LEFT JOIN personal_records pr ON pr.result_id = ranked.id
           ${where}
          ORDER BY ranked.rank
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const total = rows[0]?.total ?? 0;
      res.json({
        entries: rows.map(({ total: _t, ...e }) => e),
        total,
        page: q.page,
        pageSize: q.pageSize,
        periodStart: periodStart(q.period),
      });
    }),
  );

  r.get(
    "/rank",
    requireUser,
    ah(async (req, res) => {
      const user = currentUser(req);
      const q = parseBody(querySchema, req.query);
      validate(q);
      const { sql, params } = rankedCte(q);
      params.push(user.id);
      const { rows } = await db.query(
        `${sql}
         SELECT rank, wpm, accuracy, created_at, (SELECT count(*)::int FROM ranked) AS total
           FROM ranked WHERE user_id = $${params.length}`,
        params,
      );
      res.json({ entry: rows[0] ?? null });
    }),
  );

  return r;
}
