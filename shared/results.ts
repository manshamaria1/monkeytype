import { z } from "zod";
import { RESULT_MODES, TIME_PRESETS, WORD_PRESETS } from "./config";
import { replay, type EngineRules, type Sample, type TestStats, type TypingEvent, type KeyStat } from "./engine";
import { findQuote, isLanguage } from "./languages";
import { isValidGeneratedWord, splitText, WORD_LIST_SIZES } from "./words";
import { getLesson } from "./lessons";
import { dailyChallenge } from "./challenge";
import { getLanguage } from "./languages";

export const eventSchema = z.union([
  z.object({ t: z.number().finite().min(0).max(3_700_000), k: z.literal("i"), v: z.string().max(120) }),
  z.object({ t: z.number().finite().min(0).max(3_700_000), k: z.literal("c") }),
  z.object({ t: z.number().finite().min(0).max(3_700_000), k: z.literal("b") }),
]);

export const submissionSchema = z.object({
  clientId: z.string().uuid(),
  mode: z.enum(RESULT_MODES),
  mode2: z.string().min(1).max(40),
  language: z.string().min(1).max(40),
  wordListSize: z.enum(["small", "medium", "full"]),
  punctuation: z.boolean(),
  numbers: z.boolean(),
  difficulty: z.enum(["normal", "expert", "master"]),
  strictMode: z.boolean(),
  confidenceMode: z.enum(["off", "on", "max"]),
  freedomMode: z.boolean(),
  words: z.array(z.string().min(1).max(80)).min(1).max(5000),
  events: z.array(eventSchema).min(1).max(40000),
  durationMs: z.number().int().min(1).max(3_600_000),
  claimed: z.object({ wpm: z.number(), rawWpm: z.number(), accuracy: z.number() }),
  pasted: z.boolean(),
  /** Client wall-clock time the test finished; used for imported offline results only. */
  finishedAt: z.number().int().optional(),
});

export type Submission = z.infer<typeof submissionSchema>;

export interface VerifiedResult {
  stats: TestStats;
  timeline: Sample[];
  keyStats: Record<string, KeyStat>;
  failed: boolean;
  eligible: boolean;
  /** Why the result is not leaderboard-eligible (empty when eligible). */
  ineligibleReasons: string[];
}

export type VerifyOutcome = { ok: true; result: VerifiedResult } | { ok: false; error: string };

/** Leaderboard rules, shown to users on the leaderboard page. */
export const LEADERBOARD_RULES = {
  timeModes: TIME_PRESETS as readonly number[],
  wordModes: WORD_PRESETS as readonly number[],
  minAccuracy: 75,
  maxWpm: 350,
  wordListSize: "medium" as const,
  description: [
    "Only time tests (15, 30, 60, 120 s) and word tests (10, 25, 50, 100 words) count.",
    "Punctuation and numbers must be off, the word list must be the default (200 most common words), and nothing may be pasted.",
    "Accuracy must be at least 75% and the test must be completed (failed expert/master tests do not count).",
    "Each result is re-calculated on the server from its keystroke log. The server's numbers are the ones stored.",
    "Each player appears once per board, with their best result in the selected period.",
    "Ranking: higher WPM first, then higher accuracy, then whoever set the result earlier.",
  ],
};

/** Absolute tolerance between client-claimed and server-replayed numbers. */
const TOLERANCE = 0.5;

export function rulesFor(sub: Pick<Submission, "mode" | "strictMode" | "confidenceMode" | "freedomMode" | "difficulty">): EngineRules {
  return {
    strict: sub.strictMode,
    confidence: sub.confidenceMode,
    freedom: sub.freedomMode,
    difficulty: sub.difficulty,
    bounded: !(sub.mode === "time" || sub.mode === "practice"),
  };
}

/**
 * Re-run a submitted test from its keystroke log and decide whether it is a valid
 * result and whether it may appear on leaderboards. This catches tampered numbers,
 * impossible timings, wrong word lists and wrong test configurations. It cannot
 * prove a human typed the log (a determined cheater can forge a plausible log),
 * so leaderboards also apply plausibility limits.
 */
export function verifySubmission(sub: Submission): VerifyOutcome {
  if (!isLanguage(sub.language)) return { ok: false, error: "Unknown language" };

  // Events must be in time order and inside the test duration.
  let prevT = 0;
  for (const ev of sub.events) {
    if (ev.t < prevT) return { ok: false, error: "Keystroke log is out of order" };
    if (ev.t > sub.durationMs + 5) return { ok: false, error: "Keystroke after the end of the test" };
    prevT = ev.t;
  }

  const n = Number(sub.mode2);
  const reasons: string[] = [];
  switch (sub.mode) {
    case "time": {
      if (!Number.isInteger(n) || n < 5 || n > 3600) return { ok: false, error: "Invalid duration" };
      break;
    }
    case "words": {
      if (!Number.isInteger(n) || n < 1 || n > 1000) return { ok: false, error: "Invalid word count" };
      if (sub.words.length !== n) return { ok: false, error: "Word count does not match the test" };
      break;
    }
    case "quote": {
      const q = findQuote(sub.mode2);
      if (!q) return { ok: false, error: "Unknown quote" };
      if (q.language.id !== sub.language) return { ok: false, error: "Quote language mismatch" };
      if (splitText(q.quote.text).join(" ") !== sub.words.join(" ")) return { ok: false, error: "Quote text does not match" };
      break;
    }
    case "lesson": {
      const lesson = getLesson(sub.mode2);
      if (!lesson) return { ok: false, error: "Unknown lesson" };
      break;
    }
    case "challenge": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(sub.mode2)) return { ok: false, error: "Invalid challenge date" };
      const ch = dailyChallenge(sub.mode2);
      if (ch.words.join(" ") !== sub.words.join(" ")) return { ok: false, error: "Challenge text does not match" };
      break;
    }
    case "custom":
    case "practice":
      break;
  }

  if (sub.mode === "time" || sub.mode === "words") {
    const listSize = WORD_LIST_SIZES[sub.wordListSize];
    const pool = getLanguage(sub.language).words;
    const allowed = new Set(pool.slice(0, Math.min(listSize, pool.length)));
    for (const w of sub.words) {
      if (!isValidGeneratedWord(w, sub.language, sub)) return { ok: false, error: `Word not from the ${sub.language} word list` };
      const core = w.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
      const lower = core.charAt(0).toLocaleLowerCase() + core.slice(1);
      if (!/^[0-9]+$/.test(core) && !allowed.has(core) && !allowed.has(lower)) {
        return { ok: false, error: "Word not from the selected word list size" };
      }
    }
  }

  const rules = rulesFor(sub);
  let engine;
  if (rules.bounded) {
    engine = replay(sub.words, sub.events, rules);
    if (!engine.finished) {
      // A bounded test may only end early if it was abandoned; those are not results.
      return { ok: false, error: "Test was not completed" };
    }
    if (Math.abs((engine.endT ?? 0) - sub.durationMs) > 5) return { ok: false, error: "Duration does not match the keystroke log" };
  } else {
    if (sub.mode === "time" && Math.abs(sub.durationMs - n * 1000) > 50) {
      // Timed tests end exactly at the timer, unless failed early (expert/master).
      engine = replay(sub.words, sub.events, rules, sub.durationMs);
      if (!engine.failed) return { ok: false, error: "Duration does not match the selected time" };
    } else {
      engine = replay(sub.words, sub.events, rules, sub.durationMs);
    }
  }

  const stats = engine.stats();
  if (stats.correctKeys + stats.incorrectKeys === 0) return { ok: false, error: "No input recorded" };
  if (Math.abs(stats.wpm - sub.claimed.wpm) > TOLERANCE || Math.abs(stats.accuracy - sub.claimed.accuracy) > TOLERANCE || Math.abs(stats.rawWpm - sub.claimed.rawWpm) > TOLERANCE) {
    return { ok: false, error: "Result does not match the keystroke log" };
  }
  if (stats.wpm > 1000) return { ok: false, error: "Implausible speed" };

  // Leaderboard eligibility.
  const isTime = sub.mode === "time" && LEADERBOARD_RULES.timeModes.includes(n);
  const isWords = sub.mode === "words" && LEADERBOARD_RULES.wordModes.includes(n);
  if (!isTime && !isWords) reasons.push("Only standard time and word tests are ranked");
  if (sub.punctuation || sub.numbers) reasons.push("Punctuation and numbers must be off");
  if (sub.wordListSize !== LEADERBOARD_RULES.wordListSize) reasons.push("Only the default word list size is ranked");
  if (engine.failed) reasons.push("Failed tests are not ranked");
  if (stats.accuracy < LEADERBOARD_RULES.minAccuracy) reasons.push(`Accuracy below ${LEADERBOARD_RULES.minAccuracy}%`);
  if (sub.pasted) reasons.push("Text was pasted");
  if (stats.wpm > LEADERBOARD_RULES.maxWpm) reasons.push("Speed above the plausibility limit");
  if (looksAutomated(sub.events)) reasons.push("Keystroke timing looks automated");

  return {
    ok: true,
    result: {
      stats,
      timeline: engine.samples,
      keyStats: engine.keyStats,
      failed: engine.failed,
      eligible: reasons.length === 0,
      ineligibleReasons: reasons,
    },
  };
}

/** Flags logs whose keystroke intervals are almost perfectly regular (scripted input). */
export function looksAutomated(events: TypingEvent[]): boolean {
  if (events.length < 30) return false;
  const deltas: number[] = [];
  for (let i = 1; i < events.length; i++) deltas.push(events[i].t - events[i - 1].t);
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const sd = Math.sqrt(deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / deltas.length);
  return sd < 3;
}

export interface RankedEntry {
  userId: number;
  wpm: number;
  accuracy: number;
  createdAt: number;
}

/** The leaderboard ordering, also used in SQL (ORDER BY wpm DESC, accuracy DESC, created_at ASC). */
export function compareEntries(a: RankedEntry, b: RankedEntry): number {
  return b.wpm - a.wpm || b.accuracy - a.accuracy || a.createdAt - b.createdAt;
}

/** Keep each user's best entry, then sort. Reference implementation of the SQL query. */
export function rankEntries<T extends RankedEntry>(entries: T[]): (T & { rank: number })[] {
  const best = new Map<number, T>();
  for (const e of entries) {
    const cur = best.get(e.userId);
    if (!cur || compareEntries(e, cur) < 0) best.set(e.userId, e);
  }
  return [...best.values()].sort(compareEntries).map((e, i) => ({ ...e, rank: i + 1 }));
}

export const PERIODS = ["daily", "weekly", "monthly", "alltime"] as const;
export type Period = (typeof PERIODS)[number];

/** Start of the current leaderboard period in UTC (weeks start on Monday). */
export function periodStart(period: Period, now: Date = new Date()): Date | null {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  switch (period) {
    case "daily":
      return new Date(Date.UTC(y, m, d));
    case "weekly": {
      const dow = (now.getUTCDay() + 6) % 7; // Monday = 0
      return new Date(Date.UTC(y, m, d - dow));
    }
    case "monthly":
      return new Date(Date.UTC(y, m, 1));
    case "alltime":
      return null;
  }
}
