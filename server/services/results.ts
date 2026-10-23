import type pg from "pg";
import { evaluateAchievements, longestStreak, type AchievementContext } from "../../shared/achievements";
import { getLesson } from "../../shared/lessons";
import type { Submission, VerifiedResult } from "../../shared/results";
import { tx, type Queryable } from "../db";

export interface SavedResult {
  id: number;
  duplicate: boolean;
  isPb: boolean;
  previousPb: number | null;
  eligible: boolean;
  ineligibleReasons: string[];
  newAchievements: string[];
  lesson?: { passed: boolean; firstPass: boolean };
}

/** Modes that have personal records. */
const PB_MODES = new Set(["time", "words"]);

export async function saveResult(
  db: pg.Pool,
  userId: number,
  sub: Submission,
  v: VerifiedResult,
  opts: { imported?: boolean } = {},
): Promise<SavedResult> {
  return tx(db, async (c) => {
    const s = v.stats;
    const eligible = v.eligible && !opts.imported;
    const reasons = opts.imported ? [...v.ineligibleReasons, "Imported from this device's offline history"] : v.ineligibleReasons;
    const createdAt = opts.imported && sub.finishedAt ? new Date(Math.min(sub.finishedAt, Date.now())) : new Date();
    const ins = await c.query(
      `INSERT INTO test_results (user_id, client_id, mode, mode2, language, word_list_size, punctuation, numbers, difficulty,
          strict_mode, wpm, raw_wpm, accuracy, consistency, correct_chars, incorrect_chars, extra_chars, missed_chars,
          errors, backspaces, correct_words, duration_ms, timeline, key_stats, failed, leaderboard_eligible,
          ineligible_reasons, imported, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
       ON CONFLICT (user_id, client_id) DO NOTHING
       RETURNING id`,
      [
        userId, sub.clientId, sub.mode, sub.mode2, sub.language, sub.wordListSize, sub.punctuation, sub.numbers,
        sub.difficulty, sub.strictMode, s.wpm, s.rawWpm, s.accuracy, s.consistency, s.correctChars, s.incorrectChars,
        s.extraChars, s.missedChars, s.incorrectKeys, s.backspaces, s.correctWords, s.durationMs,
        JSON.stringify(v.timeline), JSON.stringify(v.keyStats), v.failed, eligible, reasons, !!opts.imported, createdAt,
      ],
    );
    if (!ins.rows[0]) {
      // Same test submitted twice (retry after a network error): return the stored row.
      const { rows } = await c.query(
        `SELECT id, is_pb, leaderboard_eligible, ineligible_reasons FROM test_results WHERE user_id = $1 AND client_id = $2`,
        [userId, sub.clientId],
      );
      return {
        id: rows[0].id,
        duplicate: true,
        isPb: rows[0].is_pb,
        previousPb: null,
        eligible: rows[0].leaderboard_eligible,
        ineligibleReasons: rows[0].ineligible_reasons,
        newAchievements: [],
      };
    }
    const id: number = ins.rows[0].id;

    if (eligible) {
      await c.query(`INSERT INTO test_replays (result_id, words, events) VALUES ($1, $2, $3)`, [
        id,
        JSON.stringify(sub.words),
        JSON.stringify(sub.events),
      ]);
    }

    let isPb = false;
    let previousPb: number | null = null;
    if (PB_MODES.has(sub.mode) && !v.failed && s.wpm > 0) {
      const key = [userId, sub.mode, sub.mode2, sub.language, sub.punctuation, sub.numbers];
      const { rows } = await c.query(
        `SELECT wpm FROM personal_records WHERE user_id=$1 AND mode=$2 AND mode2=$3 AND language=$4 AND punctuation=$5 AND numbers=$6 FOR UPDATE`,
        key,
      );
      previousPb = rows[0]?.wpm ?? null;
      if (previousPb === null || s.wpm > previousPb) {
        isPb = true;
        await c.query(
          `INSERT INTO personal_records (user_id, mode, mode2, language, punctuation, numbers, result_id, wpm, accuracy, raw_wpm, consistency, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (user_id, mode, mode2, language, punctuation, numbers) DO UPDATE
             SET result_id = EXCLUDED.result_id, wpm = EXCLUDED.wpm, accuracy = EXCLUDED.accuracy,
                 raw_wpm = EXCLUDED.raw_wpm, consistency = EXCLUDED.consistency, created_at = EXCLUDED.created_at`,
          [...key, id, s.wpm, s.accuracy, s.rawWpm, s.consistency, createdAt],
        );
        await c.query(`UPDATE test_results SET is_pb = true WHERE id = $1`, [id]);
      }
    }

    let lesson: SavedResult["lesson"];
    if (sub.mode === "lesson") {
      const def = getLesson(sub.mode2)!;
      const passed = !v.failed && s.accuracy >= def.passAccuracy && s.wpm >= def.passWpm;
      const before = await c.query(
        `SELECT completed_at FROM lesson_progress WHERE user_id = $1 AND lesson_id = $2 FOR UPDATE`,
        [userId, sub.mode2],
      );
      await c.query(
        `INSERT INTO lesson_progress (user_id, lesson_id, attempts, best_wpm, best_accuracy, completed_at)
         VALUES ($1, $2, 1, $3, $4, CASE WHEN $5 THEN now() END)
         ON CONFLICT (user_id, lesson_id) DO UPDATE SET
           attempts = lesson_progress.attempts + 1,
           best_wpm = GREATEST(lesson_progress.best_wpm, EXCLUDED.best_wpm),
           best_accuracy = GREATEST(lesson_progress.best_accuracy, EXCLUDED.best_accuracy),
           completed_at = COALESCE(lesson_progress.completed_at, EXCLUDED.completed_at),
           updated_at = now()`,
        [userId, sub.mode2, s.wpm, s.accuracy, passed],
      );
      lesson = { passed, firstPass: passed && !before.rows[0]?.completed_at };
    }

    const newAchievements = await updateAchievements(c, userId);
    return { id, duplicate: false, isPb, previousPb, eligible, ineligibleReasons: reasons, newAchievements, lesson };
  });
}

export async function achievementContext(c: Queryable, userId: number): Promise<AchievementContext> {
  // Sequential on purpose: `c` may be a single transaction client.
  const agg = await c.query(
    `SELECT count(*)::int AS tests, COALESCE(max(wpm), 0) AS best_wpm, COALESCE(sum(correct_words), 0)::int AS words,
            COALESCE(max(accuracy) FILTER (WHERE correct_words >= 25 OR (mode = 'time' AND duration_ms >= 30000)), 0) AS best_acc
       FROM test_results WHERE user_id = $1 AND NOT failed`,
    [userId],
  );
  const days = await c.query(
    `SELECT DISTINCT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d FROM test_results WHERE user_id = $1 AND NOT failed`,
    [userId],
  );
  const lessons = await c.query(`SELECT count(*)::int AS n FROM lesson_progress WHERE user_id = $1 AND completed_at IS NOT NULL`, [userId]);
  const wins = await c.query(`SELECT count(*)::int AS n FROM match_participants WHERE user_id = $1 AND outcome = 'win'`, [userId]);
  const challenges = await c.query(
    `SELECT count(DISTINCT mode2)::int AS n FROM test_results WHERE user_id = $1 AND mode = 'challenge' AND NOT failed`,
    [userId],
  );
  const a = agg.rows[0];
  return {
    tests: a.tests,
    bestWpm: a.best_wpm,
    perfectTest: a.best_acc >= 100,
    bestQualifiedAccuracy: a.best_acc,
    totalWords: a.words,
    longestStreak: longestStreak(days.rows.map((r) => r.d)),
    lessonsCompleted: lessons.rows[0].n,
    matchWins: wins.rows[0].n,
    challengesCompleted: challenges.rows[0].n,
  };
}

/** Insert any newly earned achievements; returns the ids unlocked by this call. */
export async function updateAchievements(c: Queryable, userId: number): Promise<string[]> {
  const ctx = await achievementContext(c, userId);
  const earned = evaluateAchievements(ctx);
  if (earned.length === 0) return [];
  const { rows } = await c.query(
    `INSERT INTO user_achievements (user_id, achievement_id)
     SELECT $1, unnest($2::text[])
     ON CONFLICT DO NOTHING
     RETURNING achievement_id`,
    [userId, earned],
  );
  return rows.map((r) => r.achievement_id);
}
