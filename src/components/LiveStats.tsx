import { useEffect, useState, useSyncExternalStore } from "react";
import type { Config } from "../../shared/config";
import type { TypingSession } from "../typing/session";

/** Timer / progress / live speed. Re-renders a few times per second, not per keystroke. */
export default function LiveStats({ session, config, timeLimitMs }: { session: TypingSession; config: Config; timeLimitMs: number | null }) {
  useSyncExternalStore(session.subscribe, () => session.started);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!session.started || session.finished) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [session, session.started, session.finished]);

  const e = session.engine;
  const elapsed = session.elapsed();
  const live = session.started ? e.stats(elapsed) : null;
  let timer = "";
  let fraction = 0;
  if (timeLimitMs) {
    const left = Math.max(0, timeLimitMs - elapsed);
    timer = String(Math.ceil(left / 1000));
    fraction = Math.min(1, elapsed / timeLimitMs);
  } else if (e.rules.bounded) {
    timer = `${Math.min(e.index, e.wordCount)}/${e.wordCount}`;
    fraction = e.progress();
  } else {
    timer = `${Math.floor(elapsed / 1000)}s`;
  }
  const show = session.started && !session.finished;
  return (
    <div className={`live-stats${show ? " visible" : ""}`} aria-live="off" data-testid="live-stats">
      {config.timerStyle === "text" && <span className="live-timer" data-testid="live-timer">{timer}</span>}
      {config.liveWpm && <span className="live-wpm">{live ? Math.round(live.wpm) : 0}</span>}
      {config.liveAccuracy && <span className="live-acc">{live ? `${Math.round(live.accuracy)}%` : ""}</span>}
      {config.timerStyle === "bar" && (
        <div className="live-bar" role="progressbar" aria-valuenow={Math.round(fraction * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${fraction * 100}%` }} />
        </div>
      )}
    </div>
  );
}
