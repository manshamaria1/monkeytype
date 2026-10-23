import { useEffect, useState } from "react";
import PreviewOnly from "../components/PreviewOnly";
import { PREVIEW } from "../lib/preview";
import { Link, useSearchParams } from "react-router-dom";
import { avatarEmoji } from "../../shared/avatars";
import { LANGUAGES } from "../../shared/languages";
import { LEADERBOARD_RULES, PERIODS } from "../../shared/results";
import { api, qs } from "../lib/api";
import { fmt, fmtDateTime } from "../lib/format";
import { useAuth } from "../state/auth";

interface Entry {
  rank: number;
  result_id: number;
  wpm: number;
  raw_wpm: number;
  accuracy: number;
  consistency: number;
  created_at: string;
  username: string;
  avatar: string;
  country: string | null;
  is_pb: boolean;
}

const PERIOD_LABEL: Record<string, string> = { daily: "today", weekly: "this week", monthly: "this month", alltime: "all-time" };

function LeaderboardPageInner() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const period = params.get("period") ?? "alltime";
  const mode = params.get("mode") ?? "time";
  const mode2 = params.get("mode2") ?? (mode === "time" ? "60" : "25");
  const language = params.get("language") ?? "english";
  const countryInput = params.get("country") ?? "";
  // Only complete two-letter codes filter the board.
  const country = countryInput.length === 2 ? countryInput : "";
  const page = Number(params.get("page") ?? 1);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [data, setData] = useState<{ entries: Entry[]; total: number; pageSize: number } | null>(null);
  const [mine, setMine] = useState<{ rank: number; wpm: number; accuracy: number; total: number } | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  const setParam = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  };

  const query = { period, mode, mode2, language, country, search: params.get("search") ?? "" };
  const queryKey = JSON.stringify(query) + page;

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api<{ entries: Entry[]; total: number; pageSize: number }>(`/api/leaderboard${qs({ ...query, page, pageSize: 50 })}`, { signal: ctrl.signal })
      .then(setData)
      .catch((e) => e.name !== "AbortError" && setError(e.message))
      .finally(() => setLoading(false));
    if (user) {
      api<{ entry: typeof mine }>(`/api/leaderboard/rank${qs({ period, mode, mode2, language, country })}`, { signal: ctrl.signal })
        .then((r) => setMine(r.entry))
        .catch(() => setMine(undefined));
    } else setMine(undefined);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, user, reload]);

  const options = mode === "time" ? LEADERBOARD_RULES.timeModes : LEADERBOARD_RULES.wordModes;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="page">
      <h1>Leaderboard</h1>
      <div className="filters" role="group" aria-label="Leaderboard filters">
        <div className="seg" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p} className={period === p ? "active" : ""} aria-pressed={period === p} onClick={() => setParam({ period: p })}>
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Mode">
          {(["time", "words"] as const).map((m) => (
            <button key={m} className={mode === m ? "active" : ""} aria-pressed={mode === m} onClick={() => setParam({ mode: m, mode2: m === "time" ? "60" : "25" })}>
              {m}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Length">
          {options.map((o) => (
            <button key={o} className={mode2 === String(o) ? "active" : ""} aria-pressed={mode2 === String(o)} onClick={() => setParam({ mode2: String(o) })}>
              {o}
            </button>
          ))}
        </div>
        <label className="field-inline">
          <span>language</span>
          <select value={language} onChange={(e) => setParam({ language: e.target.value })}>
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field-inline">
          <span>country</span>
          <input
            value={countryInput}
            maxLength={2}
            size={3}
            placeholder="all"
            aria-label="Country code (two letters), empty for global"
            onChange={(e) => {
              const v = e.target.value.toUpperCase().replace(/[^A-Z]/g, "");
              if (v.length === 0 || v.length === 2) setParam({ country: v });
              else setParams(new URLSearchParams({ ...Object.fromEntries(params), country: v }), { replace: true });
            }}
          />
        </label>
        <form
          className="field-inline"
          onSubmit={(e) => {
            e.preventDefault();
            setParam({ search: search.trim() });
          }}
        >
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="search player" aria-label="Search player by username" maxLength={20} />
          <button className="btn btn-small">search</button>
        </form>
      </div>

      {user && mine !== undefined && (
        <div className="my-rank" data-testid="my-rank">
          {mine ? (
            <>
              Your rank: <strong>#{mine.rank}</strong> of {mine.total} · {fmt(mine.wpm, 2)} wpm · {fmt(mine.accuracy, 1)}%
            </>
          ) : (
            <>You have no eligible result on this board yet.</>
          )}
        </div>
      )}
      {!user && (
        <p className="muted">
          <Link to="/account/login">Sign in</Link> to appear on the leaderboard.
        </p>
      )}

      {error && (
        <div className="banner banner-error">
          Could not load the leaderboard: {error}{" "}
          <button className="link-btn" onClick={() => setReload((r) => r + 1)}>
            try again
          </button>
        </div>
      )}
      {loading && !data && <p className="muted">Loading…</p>}
      {data && data.entries.length === 0 && !loading && (
        <div className="empty">
          <p>No results on this board {PERIOD_LABEL[period]} yet.</p>
          <p className="muted">
            Take a {mode} {mode2} test in {LANGUAGES.find((l) => l.id === language)?.name} while signed in to be the first.
          </p>
        </div>
      )}
      {data && data.entries.length > 0 && (
        <div className={`table-wrap${loading ? " loading" : ""}`}>
          <table className="table" data-testid="leaderboard-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">player</th>
                <th scope="col" className="num">
                  wpm
                </th>
                <th scope="col" className="num">
                  accuracy
                </th>
                <th scope="col" className="num hide-sm">
                  raw
                </th>
                <th scope="col" className="num hide-sm">
                  consistency
                </th>
                <th scope="col" className="hide-sm">
                  date
                </th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.result_id} className={user?.username === e.username ? "me" : ""}>
                  <td>{e.rank === 1 ? "🥇" : e.rank === 2 ? "🥈" : e.rank === 3 ? "🥉" : e.rank}</td>
                  <td>
                    <Link to={`/u/${e.username}`} className="player">
                      <span className="avatar-sm" aria-hidden="true">
                        {avatarEmoji(e.avatar)}
                      </span>
                      {e.username}
                      {e.country && <span className="muted small"> {e.country}</span>}
                      {e.is_pb && (
                        <span className="pb-dot" title="Personal best">
                          ★
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="num strong">{fmt(e.wpm, 2)}</td>
                  <td className="num">{fmt(e.accuracy, 2)}%</td>
                  <td className="num hide-sm">{fmt(e.raw_wpm, 2)}</td>
                  <td className="num hide-sm">{fmt(e.consistency, 1)}%</td>
                  <td className="hide-sm muted">{fmtDateTime(e.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && pages > 1 && (
        <nav className="pager" aria-label="Pages">
          <button className="btn btn-small" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) })}>
            ← prev
          </button>
          <span>
            page {page} of {pages}
          </span>
          <button className="btn btn-small" disabled={page >= pages} onClick={() => setParam({ page: String(page + 1) })}>
            next →
          </button>
        </nav>
      )}

      <details className="rules">
        <summary>How the leaderboard works</summary>
        <ul>
          {LEADERBOARD_RULES.description.map((d) => (
            <li key={d}>{d}</li>
          ))}
          <li>Periods use UTC: today starts at 00:00 UTC, weeks start on Monday.</li>
          <li>
            Country boards include only players who set a country on their profile. Results are checked automatically; this cannot catch every
            cheater, but suspicious results can be audited from their stored keystroke logs.
          </li>
        </ul>
      </details>
    </div>
  );
}

export default function LeaderboardPage() {
  if (PREVIEW) return <PreviewOnly feature="Leaderboard" />;
  return <LeaderboardPageInner />;
}
