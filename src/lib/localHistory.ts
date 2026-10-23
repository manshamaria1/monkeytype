import type { Submission } from "../../shared/results";
import type { KeyStat, TestStats } from "../../shared/engine";
import { readJson, removeKey, writeJson } from "./storage";

/**
 * Results of tests taken while signed out, kept on this device only (last 30).
 * After signing in they can be imported into the account; they are re-verified by
 * the server and never ranked.
 */
const KEY = "mt.localHistory";
const MAX = 30;

export interface LocalResult {
  submission: Submission;
  stats: TestStats;
  keyStats?: Record<string, KeyStat>;
  failed: boolean;
  createdAt: number;
}

export function getLocalHistory(): LocalResult[] {
  const v = readJson<LocalResult[]>(KEY, []);
  return Array.isArray(v) ? v : [];
}

export function addLocalResult(r: LocalResult) {
  const list = [r, ...getLocalHistory().filter((x) => x.submission.clientId !== r.submission.clientId)].slice(0, MAX);
  // If storage is full, drop the oldest entries until it fits.
  for (let n = list.length; n > 0; n--) if (writeJson(KEY, list.slice(0, n))) return;
}

export function clearLocalHistory() {
  removeKey(KEY);
}

export function localBest(sub: Pick<Submission, "mode" | "mode2" | "language" | "punctuation" | "numbers">, excludeId?: string): number | null {
  let best: number | null = null;
  for (const r of getLocalHistory()) {
    const s = r.submission;
    if (r.failed || s.clientId === excludeId) continue;
    if (s.mode === sub.mode && s.mode2 === sub.mode2 && s.language === sub.language && s.punctuation === sub.punctuation && s.numbers === sub.numbers) {
      best = Math.max(best ?? 0, r.stats.wpm);
    }
  }
  return best;
}
