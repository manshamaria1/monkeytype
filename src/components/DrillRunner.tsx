import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ResultMode } from "../../shared/config";
import { useAuth } from "../state/auth";
import { useConfig } from "../state/config";
import { TypingSession } from "../typing/session";
import { rulesFromConfig } from "../typing/setup";
import { useResultSaver, type SaveState } from "../typing/useResultSaver";
import { useKeySounds, useSessionActivity, useSessionClock } from "../typing/useTypingTest";
import Keyboard from "./Keyboard";
import LiveStats from "./LiveStats";
import Results from "./Results";
import TypingArea from "./TypingArea";

interface Props {
  /** Generates fresh text for each attempt. */
  makeWords: () => string[];
  mode: ResultMode;
  mode2: string;
  language?: string;
  showKeyboard?: boolean;
  focusKeys?: string;
  /** Called with the finished session and the save outcome (e.g. lesson pass/fail). */
  renderOutcome?: (session: TypingSession, save: SaveState) => ReactNode;
  onFinished?: (session: TypingSession) => void;
}

/** A self-contained bounded typing exercise used by lessons, challenges and drills. */
export default function DrillRunner({ makeWords, mode, mode2, language = "english", showKeyboard, focusKeys, renderOutcome, onFinished }: Props) {
  const { config } = useConfig();
  const { user } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [finished, setFinished] = useState<TypingSession | null>(null);
  const onKey = useKeySounds(config);
  // Lessons use normal rules (no difficulty/strict) so pass criteria are comparable.
  const session = useMemo(
    () =>
      new TypingSession(
        { words: makeWords(), rules: { ...rulesFromConfig(config, true), difficulty: "normal", strict: false } },
        { onKey, onFinish: (s) => setFinished(s) },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attempt, mode2],
  );
  useEffect(() => setFinished(null), [session]);
  useSessionClock(session);
  useSessionActivity(session);
  useEffect(() => {
    if (finished) onFinished?.(finished);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  const makeSubmission = useCallback(
    (s: TypingSession) =>
      s.toSubmission({
        mode,
        mode2,
        language,
        wordListSize: "medium",
        punctuation: false,
        numbers: false,
        difficulty: "normal",
        strictMode: false,
        confidenceMode: config.confidenceMode,
        freedomMode: config.freedomMode,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, mode2, language],
  );
  const { state: save, retry } = useResultSaver(finished, makeSubmission);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab" && config.quickRestart === "tab" && !document.querySelector("dialog[open]")) {
        e.preventDefault();
        setAttempt((a) => a + 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [config.quickRestart]);

  const e = session.engine;
  return (
    <div className="drill">
      {!finished ? (
        <>
          <LiveStats session={session} config={config} timeLimitMs={null} />
          <TypingArea key={session.id} session={session} config={config} />
          {showKeyboard && <Keyboard session={session} focusKeys={focusKeys} />}
          <div className="test-actions">
            <button className="icon-btn" onClick={() => setAttempt((a) => a + 1)} aria-label="Restart with new text" title="Restart">
              ↻
            </button>
          </div>
        </>
      ) : (
        <Results
          stats={e.stats()}
          timeline={e.samples}
          keyStats={e.keyStats}
          failed={e.failed}
          mode={mode}
          mode2={mode2}
          language={language}
          save={save}
          onRetrySave={retry}
          showChart={config.showResultChart}
          showKeyStats={config.showKeyStats}
          signedIn={!!user}
        >
          {renderOutcome?.(finished, save)}
          <div className="results-actions">
            <button className="btn" onClick={() => setAttempt((a) => a + 1)}>
              try again
            </button>
          </div>
        </Results>
      )}
    </div>
  );
}
