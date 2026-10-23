import { Link } from "react-router-dom";
import type { Sample, KeyStat, TestStats } from "../../shared/engine";
import { ACHIEVEMENTS } from "../../shared/achievements";
import { getLanguage } from "../../shared/languages";
import { fmt, fmtDuration, modeLabel } from "../lib/format";
import type { SaveState } from "../typing/useResultSaver";
import LineChart from "./LineChart";

interface Props {
  stats: TestStats;
  timeline: Sample[];
  keyStats: Record<string, KeyStat>;
  failed: boolean;
  mode: string;
  mode2: string;
  language: string;
  extras?: string[];
  quoteSource?: string;
  save?: SaveState;
  onRetrySave?: () => void;
  showChart?: boolean;
  showKeyStats?: boolean;
  signedIn?: boolean;
  children?: React.ReactNode;
}

/** Results of a finished test. All numbers come from the engine's final state. */
export default function Results(p: Props) {
  const s = p.stats;
  const css = getComputedStyle(document.documentElement);
  const main = css.getPropertyValue("--main").trim() || "#e2b714";
  const sub = css.getPropertyValue("--sub").trim() || "#646669";
  const err = css.getPropertyValue("--error").trim() || "#ca4754";
  const missed = Object.entries(p.keyStats)
    .filter(([k, v]) => v.miss > 0 && k !== " ")
    .sort((a, b) => b[1].miss - a[1].miss)
    .slice(0, 8);

  return (
    <section className="results" aria-label="Test results" data-testid="results">
      {p.failed && <div className="banner banner-error">Test failed: the difficulty setting (expert or master) ended the test after a mistake.</div>}
      <div className="results-top">
        <div className="results-big">
          <div className="stat-big">
            <div className="stat-label">wpm</div>
            <div className="stat-value" data-testid="result-wpm">
              {fmt(s.wpm)}
            </div>
          </div>
          <div className="stat-big">
            <div className="stat-label">acc</div>
            <div className="stat-value" data-testid="result-acc">
              {fmt(s.accuracy)}%
            </div>
          </div>
          {p.save?.isPb && (
            <div className="pb-badge" title={p.save.previousPb ? `Previous best: ${fmt(p.save.previousPb, 2)} wpm` : "First result for this test"}>
              ★ new personal best
            </div>
          )}
        </div>
        {p.showChart !== false && p.timeline.length > 0 && (
          <div className="results-chart">
            <LineChart
              ariaLabel="Speed over the test: words per minute, raw speed and errors per second"
              labels={p.timeline.map((t) => String(t.s))}
              yLabel="words per minute"
              y2Label="errors"
              series={[
                { name: "wpm", color: main, values: p.timeline.map((t) => t.wpm) },
                { name: "raw", color: sub, values: p.timeline.map((t) => t.raw), dashed: true },
                { name: "errors", color: err, values: p.timeline.map((t) => t.err || null), markers: true, secondary: true },
              ]}
            />
          </div>
        )}
      </div>
      <dl className="results-grid">
        <div>
          <dt>test type</dt>
          <dd>
            {modeLabel(p.mode, p.mode2)}
            <br />
            {getLanguage(p.language).name.toLowerCase()}
            {p.extras?.map((x) => (
              <span key={x}>
                <br />
                {x}
              </span>
            ))}
          </dd>
        </div>
        <div>
          <dt>raw</dt>
          <dd data-testid="result-raw">{fmt(s.rawWpm)}</dd>
        </div>
        <div>
          <dt title="correct / incorrect / extra / missed characters">characters</dt>
          <dd data-testid="result-chars">
            {s.correctChars}/{s.incorrectChars}/{s.extraChars}/{s.missedChars}
          </dd>
        </div>
        <div>
          <dt title="consistency of speed throughout the test">consistency</dt>
          <dd>{s.consistency ? `${fmt(s.consistency)}%` : "-"}</dd>
        </div>
        <div>
          <dt title="wrong keystrokes, including ones you corrected">errors</dt>
          <dd data-testid="result-errors">{s.incorrectKeys}</dd>
        </div>
        <div>
          <dt>backspaces</dt>
          <dd data-testid="result-backspaces">{s.backspaces}</dd>
        </div>
        <div>
          <dt>time</dt>
          <dd>{fmtDuration(s.durationMs)}</dd>
        </div>
      </dl>
      {p.quoteSource && <p className="muted center">— {p.quoteSource}</p>}
      {p.showKeyStats !== false && missed.length > 0 && (
        <div className="missed-keys">
          <span className="muted">most missed:</span>
          {missed.map(([k, v]) => (
            <span key={k} className="key-chip" title={`${v.miss} missed of ${v.hit + v.miss}`}>
              {k === "extra" ? "extra letters" : k} <small>{v.miss}</small>
            </span>
          ))}
        </div>
      )}
      {p.save && <SaveStatus save={p.save} onRetry={p.onRetrySave} signedIn={!!p.signedIn} />}
      {p.children}
    </section>
  );
}

function SaveStatus({ save, onRetry, signedIn }: { save: SaveState; onRetry?: () => void; signedIn: boolean }) {
  return (
    <div className="save-status" data-testid="save-status">
      {save.status === "saving" && <span>Saving result…</span>}
      {save.status === "saved" && <span className="ok">✓ Result saved to your account.</span>}
      {save.status === "local" && (
        <span>
          Saved on this device only. <Link to="/account/login">Sign in</Link> to keep your history and appear on leaderboards.
        </span>
      )}
      {save.status === "skipped" && <span className="muted">{save.error}</span>}
      {save.status === "error" && (
        <span className="err">
          Result not saved: {save.error}{" "}
          {onRetry && (
            <button className="link-btn" onClick={onRetry}>
              retry
            </button>
          )}
        </span>
      )}
      {(save.status === "saved" || save.status === "local") && save.eligible !== undefined && (
        <div className="muted small" data-testid="eligibility">
          {save.eligible
            ? signedIn
              ? "Leaderboard: this result is eligible and counts toward the rankings."
              : "Leaderboard: this result would be eligible if you were signed in."
            : `Leaderboard: not eligible (${(save.ineligibleReasons ?? []).join("; ")}).`}
        </div>
      )}
      {save.newAchievements && save.newAchievements.length > 0 && (
        <div className="achievement-toast">
          {save.newAchievements.map((id) => {
            const a = ACHIEVEMENTS.find((x) => x.id === id);
            return a ? (
              <span key={id}>
                {a.icon} Achievement unlocked: <strong>{a.title}</strong>
              </span>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}
