import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Sample, KeyStat } from "../../shared/engine";
import { getLanguage, LANGUAGES } from "../../shared/languages";
import LineChart from "../components/LineChart";
import Results from "../components/Results";
import { api, qs } from "../lib/api";
import { fmt, fmtDate, fmtDateTime, fmtDuration, modeLabel } from "../lib/format";
import { getLocalHistory } from "../lib/localHistory";
import { useAuth } from "../state/auth";

interface Totals {
  tests: number;
  best_wpm: number;
  avg_wpm: number;
  best_accuracy: number;
  avg_accuracy: number;
  avg_consistency: number;
  chars_typed: number;
  words_typed: number;
  time_ms: number;
  failed_tests: number;
}
interface StatsData {
  totals: Totals;
  byLanguage: { language: string; tests: number; avg_wpm: number; best_wpm: number; avg_accuracy: number }[];
  byMode: { mode: string; mode2: string; tests: number; avg_wpm: number; best_wpm: number; avg_accuracy: number }[];
  daily: { day: string; tests: number; avg_wpm: number; best_wpm: number; avg_accuracy: number; avg_consistency: number }[];
  records: { mode: string; mode2: string; language: string; punctuation: boolean; numbers: boolean; wpm: number; accuracy: number; created_at: string; result_id: number }[];
}
export interface ResultRow {
  id: number;
  mode: string;
  mode2: string;
  language: string;
  punctuation: boolean;
  numbers: boolean;
  difficulty: string;
  wpm: number;
  raw_wpm: number;
  accuracy: number;
  consistency: number;
  correct_chars: number;
  incorrect_chars: number;
  extra_chars: number;
  missed_chars: number;
  errors: number;
  backspaces: number;
  correct_words: number;
  duration_ms: number;
  failed: boolean;
  leaderboard_eligible: boolean;
  ineligible_reasons: string[];
  is_pb: boolean;
  imported: boolean;
  created_at: string;
  timeline?: Sample[];
  key_stats?: Record<string, KeyStat>;
}

const RANGES = [
  { id: "7", label: "7 days", days: 7 },
  { id: "30", label: "30 days", days: 30 },
  { id: "90", label: "90 days", days: 90 },
  { id: "all", label: "all time", days: 0 },
];

function cssVar(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export default function StatsPage() {
  const { user, loading } = useAuth();
  if (loading) return <div className="page muted">Loading…</div>;
  if (!user) return <GuestStats />;
  return <AccountStats />;
}

function AccountStats() {
  const [range, setRange] = useState("30");
  const [mode, setMode] = useState("");
  const [language, setLanguage] = useState("");
  const [stats, setStats] = useState<StatsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ results: ResultRow[]; total: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const from = useMemo(() => {
    const r = RANGES.find((x) => x.id === range)!;
    return r.days ? new Date(Date.now() - r.days * 86400000).toISOString() : undefined;
  }, [range]);
  const filters = { from, mode: mode || undefined, language: language || undefined };
  const key = JSON.stringify(filters);

  useEffect(() => {
    setError(null);
    api<StatsData>(`/api/me/stats${qs(filters)}`)
      .then(setStats)
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reload]);
  useEffect(() => setOffset(0), [key]);
  useEffect(() => {
    api<{ results: ResultRow[]; total: number }>(`/api/me/results${qs({ ...filters, limit: 20, offset })}`)
      .then(setHistory)
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, offset, reload]);

  const main = cssVar("--main", "#e2b714");
  const sub = cssVar("--sub", "#646669");
  const text = cssVar("--text", "#d1d0c5");

  return (
    <div className="page">
      <div className="page-head">
        <h1>Statistics</h1>
        <a className="btn btn-small btn-ghost" href="/api/me/export" download>
          export my data (JSON)
        </a>
      </div>
      <div className="filters">
        <div className="seg" role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button key={r.id} className={range === r.id ? "active" : ""} aria-pressed={range === r.id} onClick={() => setRange(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
        <label className="field-inline">
          <span>mode</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">all</option>
            {["time", "words", "quote", "custom", "practice", "lesson", "challenge"].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="field-inline">
          <span>language</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">all</option>
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <div className="banner banner-error">
          {error}{" "}
          <button className="link-btn" onClick={() => setReload((r) => r + 1)}>
            try again
          </button>
        </div>
      )}
      {!stats && !error && <p className="muted">Loading…</p>}
      {stats && stats.totals.tests === 0 && (
        <div className="empty">
          <p>No completed tests in this period.</p>
          <p>
            <Link to="/" className="btn">
              take a test
            </Link>
          </p>
        </div>
      )}
      {stats && stats.totals.tests > 0 && (
        <>
          <div className="tiles" data-testid="stat-tiles">
            <Tile label="tests completed" value={String(stats.totals.tests)} />
            <Tile label="best wpm" value={fmt(stats.totals.best_wpm, 2)} />
            <Tile label="average wpm" value={fmt(stats.totals.avg_wpm, 2)} />
            <Tile label="best accuracy" value={`${fmt(stats.totals.best_accuracy, 2)}%`} />
            <Tile label="average accuracy" value={`${fmt(stats.totals.avg_accuracy, 2)}%`} />
            <Tile label="avg consistency" value={`${fmt(stats.totals.avg_consistency, 1)}%`} />
            <Tile label="characters typed" value={stats.totals.chars_typed.toLocaleString()} />
            <Tile label="correct words" value={stats.totals.words_typed.toLocaleString()} />
            <Tile label="time typing" value={fmtDuration(stats.totals.time_ms)} />
          </div>
          <h2>Progress</h2>
          <LineChart
            ariaLabel="Average and best WPM per day, with average accuracy"
            labels={stats.daily.map((d) => d.day.slice(5))}
            yLabel="wpm"
            y2Label="accuracy %"
            series={[
              { name: "avg wpm", color: main, values: stats.daily.map((d) => d.avg_wpm) },
              { name: "best wpm", color: text, values: stats.daily.map((d) => d.best_wpm), dashed: true },
              { name: "avg accuracy", color: sub, values: stats.daily.map((d) => d.avg_accuracy), secondary: true },
            ]}
          />
          <LineChart
            ariaLabel="Average consistency per day"
            height={140}
            labels={stats.daily.map((d) => d.day.slice(5))}
            yLabel="consistency %"
            series={[{ name: "consistency", color: sub, values: stats.daily.map((d) => d.avg_consistency) }]}
          />
          <div className="two-col">
            <div>
              <h2>Personal records</h2>
              {stats.records.length === 0 ? (
                <p className="muted">Complete a time or words test to set a record.</p>
              ) : (
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>test</th>
                      <th>language</th>
                      <th className="num">wpm</th>
                      <th className="num">acc</th>
                      <th>date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.records.map((r) => (
                      <tr key={`${r.mode}${r.mode2}${r.language}${r.punctuation}${r.numbers}`}>
                        <td>
                          <Link to={`/stats/result/${r.result_id}`}>
                            {modeLabel(r.mode, r.mode2)}
                            {r.punctuation ? " +punct" : ""}
                            {r.numbers ? " +num" : ""}
                          </Link>
                        </td>
                        <td>{getLanguage(r.language).name}</td>
                        <td className="num strong">{fmt(r.wpm, 2)}</td>
                        <td className="num">{fmt(r.accuracy, 1)}%</td>
                        <td className="muted">{fmtDate(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div>
              <h2>By language</h2>
              <table className="table compact">
                <thead>
                  <tr>
                    <th>language</th>
                    <th className="num">tests</th>
                    <th className="num">avg</th>
                    <th className="num">best</th>
                    <th className="num">acc</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byLanguage.map((l) => (
                    <tr key={l.language}>
                      <td>{getLanguage(l.language).name}</td>
                      <td className="num">{l.tests}</td>
                      <td className="num">{fmt(l.avg_wpm, 1)}</td>
                      <td className="num">{fmt(l.best_wpm, 1)}</td>
                      <td className="num">{fmt(l.avg_accuracy, 1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h2>By test mode</h2>
              <table className="table compact">
                <thead>
                  <tr>
                    <th>mode</th>
                    <th className="num">tests</th>
                    <th className="num">avg</th>
                    <th className="num">best</th>
                    <th className="num">acc</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byMode.map((m) => (
                    <tr key={m.mode + m.mode2}>
                      <td>{m.mode === "quote" || m.mode === "lesson" || m.mode === "challenge" ? m.mode : modeLabel(m.mode, m.mode2)}</td>
                      <td className="num">{m.tests}</td>
                      <td className="num">{fmt(m.avg_wpm, 1)}</td>
                      <td className="num">{fmt(m.best_wpm, 1)}</td>
                      <td className="num">{fmt(m.avg_accuracy, 1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      <h2>History</h2>
      {history && history.results.length === 0 && <p className="muted">No results for these filters.</p>}
      {history && history.results.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table" data-testid="history-table">
              <thead>
                <tr>
                  <th>date</th>
                  <th>test</th>
                  <th className="num">wpm</th>
                  <th className="num">raw</th>
                  <th className="num">acc</th>
                  <th className="num hide-sm">consistency</th>
                  <th className="hide-sm">language</th>
                </tr>
              </thead>
              <tbody>
                {history.results.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link to={`/stats/result/${r.id}`}>{fmtDateTime(r.created_at)}</Link>
                    </td>
                    <td>
                      {modeLabel(r.mode, r.mode2)}
                      {r.failed && <span className="tag tag-err">failed</span>}
                      {r.is_pb && (
                        <span className="pb-dot" title="Personal best when set">
                          ★
                        </span>
                      )}
                      {r.imported && <span className="tag">imported</span>}
                    </td>
                    <td className="num strong">{fmt(r.wpm, 2)}</td>
                    <td className="num">{fmt(r.raw_wpm, 2)}</td>
                    <td className="num">{fmt(r.accuracy, 1)}%</td>
                    <td className="num hide-sm">{fmt(r.consistency, 1)}%</td>
                    <td className="hide-sm">{getLanguage(r.language).name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="pager" aria-label="History pages">
            <button className="btn btn-small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>
              ← newer
            </button>
            <span>
              {offset + 1}–{Math.min(offset + 20, history.total)} of {history.total}
            </span>
            <button className="btn btn-small" disabled={offset + 20 >= history.total} onClick={() => setOffset(offset + 20)}>
              older →
            </button>
          </nav>
        </>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="tile">
      <div className="tile-value">{value}</div>
      <div className="tile-label">{label}</div>
    </div>
  );
}

function GuestStats() {
  const local = getLocalHistory().filter((r) => !r.failed);
  const best = local.reduce((m, r) => Math.max(m, r.stats.wpm), 0);
  const avg = local.length ? local.reduce((s, r) => s + r.stats.wpm, 0) / local.length : 0;
  const avgAcc = local.length ? local.reduce((s, r) => s + r.stats.accuracy, 0) / local.length : 0;
  return (
    <div className="page">
      <h1>Statistics</h1>
      <div className="banner">
        You are not signed in. Below are the last {local.length} result(s) stored on this device. <Link to="/account/register">Create an account</Link> or{" "}
        <Link to="/account/login">sign in</Link> to keep full history, charts and records; you can import these results afterwards.
      </div>
      {local.length === 0 ? (
        <div className="empty">
          <p>No results yet.</p>
          <Link to="/" className="btn">
            take a test
          </Link>
        </div>
      ) : (
        <>
          <div className="tiles">
            <Tile label="tests on this device" value={String(local.length)} />
            <Tile label="best wpm" value={fmt(best, 2)} />
            <Tile label="average wpm" value={fmt(avg, 2)} />
            <Tile label="average accuracy" value={`${fmt(avgAcc, 2)}%`} />
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>date</th>
                <th>test</th>
                <th className="num">wpm</th>
                <th className="num">acc</th>
                <th>language</th>
              </tr>
            </thead>
            <tbody>
              {local.map((r) => (
                <tr key={r.submission.clientId}>
                  <td>{fmtDateTime(r.createdAt)}</td>
                  <td>{modeLabel(r.submission.mode, r.submission.mode2)}</td>
                  <td className="num strong">{fmt(r.stats.wpm, 2)}</td>
                  <td className="num">{fmt(r.stats.accuracy, 1)}%</td>
                  <td>{getLanguage(r.submission.language).name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export function ResultDetailPage() {
  const { id } = useParams();
  const [r, setR] = useState<ResultRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<ResultRow>(`/api/me/results/${id}`)
      .then(setR)
      .catch((e) => setError(e.message));
  }, [id]);
  if (error)
    return (
      <div className="page">
        <div className="banner banner-error">{error}</div>
        <Link to="/stats">← back to statistics</Link>
      </div>
    );
  if (!r) return <div className="page muted">Loading…</div>;
  return (
    <div className="page">
      <Link to="/stats">← back to statistics</Link>
      <p className="muted">{fmtDateTime(r.created_at)}</p>
      <Results
        stats={{
          wpm: r.wpm,
          rawWpm: r.raw_wpm,
          accuracy: r.accuracy,
          consistency: r.consistency,
          correctChars: r.correct_chars,
          incorrectChars: r.incorrect_chars,
          extraChars: r.extra_chars,
          missedChars: r.missed_chars,
          correctKeys: 0,
          incorrectKeys: r.errors,
          backspaces: r.backspaces,
          durationMs: r.duration_ms,
          wordsCompleted: r.correct_words,
          correctWords: r.correct_words,
        }}
        timeline={r.timeline ?? []}
        keyStats={r.key_stats ?? {}}
        failed={r.failed}
        mode={r.mode}
        mode2={r.mode2}
        language={r.language}
        extras={[r.punctuation && "punctuation", r.numbers && "numbers", r.difficulty !== "normal" && r.difficulty].filter(Boolean) as string[]}
      >
        <p className="muted small center">
          {r.is_pb && "★ Personal best when it was set. "}
          {r.leaderboard_eligible ? "Counted on the leaderboard." : `Not ranked: ${r.ineligible_reasons.join("; ") || "not a ranked test"}.`}
        </p>
      </Results>
    </div>
  );
}
