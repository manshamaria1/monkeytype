import { useCallback, useEffect, useState } from "react";
import type { Submission } from "../../shared/results";
import { api, ApiError } from "../lib/api";
import { addLocalResult, localBest } from "../lib/localHistory";
import { useAuth } from "../state/auth";
import type { TypingSession } from "./session";

export interface SaveState {
  status: "idle" | "saving" | "saved" | "local" | "error" | "skipped";
  error?: string;
  isPb?: boolean;
  previousPb?: number | null;
  eligible?: boolean;
  ineligibleReasons?: string[];
  newAchievements?: string[];
  lesson?: { passed: boolean; firstPass: boolean };
}

interface SaveResponse {
  isPb: boolean;
  previousPb: number | null;
  eligible: boolean;
  ineligibleReasons: string[];
  newAchievements: string[];
  lesson?: { passed: boolean; firstPass: boolean };
}

/**
 * Saves a finished test. Signed in: the server verifies and stores it. Signed out:
 * the result is kept on this device and the server is asked only whether it would
 * have been leaderboard-eligible.
 */
export function useResultSaver(session: TypingSession | null, makeSubmission: (s: TypingSession) => Submission | null) {
  const { user } = useAuth();
  const [state, setState] = useState<SaveState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!session) {
      setState({ status: "idle" });
      return;
    }
    const sub = makeSubmission(session);
    if (!sub) {
      setState({ status: "skipped", error: "Nothing was typed, so there is no result to save." });
      return;
    }
    const stats = session.engine.stats();
    if (stats.correctKeys + stats.incorrectKeys === 0) {
      setState({ status: "skipped", error: "Nothing was typed, so there is no result to save." });
      return;
    }
    let cancelled = false;
    setState({ status: "saving" });
    if (user) {
      api<SaveResponse>("/api/results", { body: sub })
        .then((r) => !cancelled && setState({ status: "saved", ...r }))
        .catch((e: ApiError) => !cancelled && setState({ status: "error", error: e.message }));
    } else {
      const prev = localBest(sub, sub.clientId);
      addLocalResult({ submission: sub, stats, keyStats: session.engine.keyStats, failed: session.engine.failed, createdAt: Date.now() });
      const isPb = !session.engine.failed && (sub.mode === "time" || sub.mode === "words") && stats.wpm > 0 && (prev === null || stats.wpm > prev);
      api<{ eligible: boolean; ineligibleReasons: string[] }>("/api/results/verify", { body: sub })
        .then((r) => !cancelled && setState({ status: "local", isPb, previousPb: prev, ...r }))
        .catch((e: ApiError) =>
          !cancelled && setState({ status: "local", isPb, previousPb: prev, error: e.status === 0 ? undefined : e.message }),
        );
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { state, retry };
}
