import { useEffect, useState } from "react";
import PreviewOnly from "../components/PreviewOnly";
import { PREVIEW } from "../lib/preview";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { AVATARS, avatarEmoji } from "../../shared/avatars";
import { getLanguage } from "../../shared/languages";
import { api } from "../lib/api";
import { fmt, fmtDate, fmtDateTime, fmtDuration, modeLabel } from "../lib/format";
import { useAuth } from "../state/auth";
import { useToast } from "../state/toast";

interface PublicProfile {
  username: string;
  joined: string;
  bio: string;
  avatar: string;
  country: string | null;
  keyboard: string;
  records: { mode: string; mode2: string; language: string; wpm: number; accuracy: number; created_at: string }[];
  totals: { tests: number; timeMs: number; words: number };
  achievements: { id: string; title: string; icon: string; description: string; unlockedAt: string }[];
  matches: { wins: number; losses: number; draws: number };
}

function ProfileView({ p }: { p: PublicProfile }) {
  return (
    <>
      <div className="profile-head">
        <div className="avatar-lg" aria-hidden="true">
          {avatarEmoji(p.avatar)}
        </div>
        <div>
          <h1>{p.username}</h1>
          <p className="muted small">
            joined {fmtDate(p.joined)}
            {p.country && ` · ${p.country}`}
            {p.keyboard && ` · ⌨ ${p.keyboard}`}
          </p>
          {p.bio && <p>{p.bio}</p>}
        </div>
      </div>
      <div className="tiles">
        <div className="tile">
          <div className="tile-value">{p.totals.tests}</div>
          <div className="tile-label">tests completed</div>
        </div>
        <div className="tile">
          <div className="tile-value">{fmtDuration(p.totals.timeMs)}</div>
          <div className="tile-label">time typing</div>
        </div>
        <div className="tile">
          <div className="tile-value">{p.totals.words.toLocaleString()}</div>
          <div className="tile-label">correct words</div>
        </div>
        <div className="tile">
          <div className="tile-value">
            {p.matches.wins}/{p.matches.losses}/{p.matches.draws}
          </div>
          <div className="tile-label">races won/lost/drawn</div>
        </div>
      </div>
      <h2>Personal records</h2>
      {p.records.length === 0 ? (
        <p className="muted">No records yet.</p>
      ) : (
        <div className="records">
          {p.records.map((r) => (
            <div className="record" key={r.mode + r.mode2 + r.language}>
              <div className="muted small">
                {modeLabel(r.mode, r.mode2)} · {getLanguage(r.language).name.toLowerCase()}
              </div>
              <div className="record-wpm">{fmt(r.wpm)}</div>
              <div className="muted small">{fmt(r.accuracy)}% acc</div>
            </div>
          ))}
        </div>
      )}
      <h2>Achievements</h2>
      {p.achievements.length === 0 ? (
        <p className="muted">No achievements unlocked yet.</p>
      ) : (
        <div className="achievements">
          {p.achievements.map((a) => (
            <div className="achievement" key={a.id} title={a.description}>
              <span className="achievement-icon" aria-hidden="true">
                {a.icon}
              </span>
              <div>
                <strong>{a.title}</strong>
                <div className="muted small">{a.description}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function PublicProfilePageInner() {
  const { username } = useParams();
  const [p, setP] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setP(null);
    setError(null);
    api<PublicProfile>(`/api/users/${encodeURIComponent(username ?? "")}`)
      .then(setP)
      .catch((e) => setError(e.message));
  }, [username]);
  return (
    <div className="page">
      {error && <div className="banner banner-error">{error}</div>}
      {!p && !error && <p className="muted">Loading…</p>}
      {p && <ProfileView p={p} />}
    </div>
  );
}

interface OwnProfile {
  username: string;
  email: string;
  email_verified: boolean;
  bio: string;
  avatar: string;
  country: string | null;
  keyboard: string;
}

interface AchievementRow {
  id: string;
  title: string;
  description: string;
  icon: string;
  unlockedAt: string | null;
}

interface MatchRow {
  id: number;
  started_at: string;
  language: string;
  word_count: number;
  place: number;
  outcome: string;
  wpm: number;
  accuracy: number;
  players: number;
}

function ProfilePageInner() {
  const { user, loading, logout, refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [form, setForm] = useState<OwnProfile | null>(null);
  const [achievements, setAchievements] = useState<AchievementRow[]>([]);
  const [matches, setMatches] = useState<{ matches: MatchRow[]; summary: { wins: number; losses: number; draws: number; dnf: number } } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api<OwnProfile>("/api/me/profile")
      .then((p) => {
        setProfile(p);
        setForm(p);
      })
      .catch((e) => setError(e.message));
    api<{ achievements: AchievementRow[] }>("/api/me/achievements")
      .then((r) => setAchievements(r.achievements))
      .catch(() => {});
    api<typeof matches>("/api/me/matches")
      .then(setMatches)
      .catch(() => {});
  }, [user]);

  if (loading) return <div className="page muted">Loading…</div>;
  if (!user) return <Navigate to="/account/login" replace />;

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      await api("/api/me/profile", {
        method: "PATCH",
        body: { username: form.username, bio: form.bio, avatar: form.avatar, country: form.country || null, keyboard: form.keyboard },
      });
      setProfile(form);
      await refresh();
      toast("success", "Profile saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const unlocked = achievements.filter((a) => a.unlockedAt);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Your profile</h1>
        <span className="row-gap">
          <Link className="btn btn-small btn-ghost" to={`/u/${user.username}`}>
            view public profile
          </Link>
          <button
            className="btn btn-small btn-ghost"
            onClick={async () => {
              await logout();
              navigate("/");
            }}
          >
            sign out
          </button>
        </span>
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {form && (
        <form
          className="card form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset className="avatar-pick">
            <legend>Avatar</legend>
            {AVATARS.map((a) => (
              <button
                type="button"
                key={a.id}
                className={`avatar-opt${form.avatar === a.id ? " active" : ""}`}
                aria-pressed={form.avatar === a.id}
                aria-label={a.id}
                onClick={() => setForm({ ...form, avatar: a.id })}
              >
                {a.emoji}
              </button>
            ))}
          </fieldset>
          <div className="two-col">
            <label className="field">
              <span>Username</span>
              <input value={form.username} maxLength={20} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </label>
            <label className="field">
              <span>Country (two-letter code, optional, used for country leaderboards)</span>
              <input value={form.country ?? ""} maxLength={2} onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") || null })} />
            </label>
          </div>
          <label className="field">
            <span>Bio</span>
            <textarea rows={2} maxLength={300} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
          </label>
          <label className="field">
            <span>Keyboard</span>
            <input maxLength={60} value={form.keyboard} onChange={(e) => setForm({ ...form, keyboard: e.target.value })} />
          </label>
          <p className="muted small">
            Email: {profile?.email} {profile?.email_verified ? "(verified)" : "(not verified)"}
          </p>
          <div className="row-end">
            <button className="btn" disabled={saving || JSON.stringify(form) === JSON.stringify(profile)}>
              {saving ? "saving…" : "save profile"}
            </button>
          </div>
        </form>
      )}

      <h2>
        Achievements ({unlocked.length}/{achievements.length})
      </h2>
      <div className="achievements">
        {achievements.map((a) => (
          <div className={`achievement${a.unlockedAt ? "" : " locked"}`} key={a.id}>
            <span className="achievement-icon" aria-hidden="true">
              {a.unlockedAt ? a.icon : "🔒"}
            </span>
            <div>
              <strong>{a.title}</strong>
              <div className="muted small">{a.description}</div>
              {a.unlockedAt && <div className="muted small">unlocked {fmtDate(a.unlockedAt)}</div>}
            </div>
          </div>
        ))}
      </div>

      <h2>Race history</h2>
      {matches && (
        <p className="muted">
          {matches.summary.wins} wins · {matches.summary.losses} losses · {matches.summary.draws} draws · {matches.summary.dnf} not finished
        </p>
      )}
      {matches && matches.matches.length === 0 && (
        <p className="muted">
          No races yet. <Link to="/multiplayer">Start one</Link>.
        </p>
      )}
      {matches && matches.matches.length > 0 && (
        <table className="table compact">
          <thead>
            <tr>
              <th>date</th>
              <th>result</th>
              <th className="num">place</th>
              <th className="num">wpm</th>
              <th className="num">acc</th>
              <th className="hide-sm">race</th>
            </tr>
          </thead>
          <tbody>
            {matches.matches.map((m) => (
              <tr key={m.id}>
                <td>{fmtDateTime(m.started_at)}</td>
                <td>
                  <span className={`tag tag-${m.outcome}`}>{m.outcome}</span>
                </td>
                <td className="num">
                  {m.place}/{m.players}
                </td>
                <td className="num">{fmt(m.wpm, 1)}</td>
                <td className="num">{fmt(m.accuracy, 1)}%</td>
                <td className="hide-sm muted">
                  {m.word_count} words · {getLanguage(m.language).name}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <AccountSecurity />
    </div>
  );
}

function AccountSecurity() {
  const toast = useToast();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [delPassword, setDelPassword] = useState("");
  const [delOpen, setDelOpen] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);
  return (
    <>
      <h2>Password</h2>
      <form
        className="card form"
        onSubmit={async (e) => {
          e.preventDefault();
          setPwError(null);
          try {
            await api("/api/me/password", { body: { current, next } });
            setCurrent("");
            setNext("");
            toast("success", "Password changed. Other devices were signed out.");
          } catch (err) {
            setPwError((err as Error).message);
          }
        }}
      >
        <div className="two-col">
          <label className="field">
            <span>Current password</span>
            <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </label>
          <label className="field">
            <span>New password (8+ characters)</span>
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </label>
        </div>
        {pwError && <p className="form-error">{pwError}</p>}
        <div className="row-end">
          <button className="btn" disabled={!current || next.length < 8}>
            change password
          </button>
        </div>
      </form>
      <h2>Your data</h2>
      <div className="card">
        <p>
          <a href="/api/me/export" download>
            Download all your data
          </a>{" "}
          (profile, settings, every result, records, achievements, races) as JSON.
        </p>
        {!delOpen ? (
          <button className="btn btn-danger" onClick={() => setDelOpen(true)}>
            delete account
          </button>
        ) : (
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              setDelError(null);
              try {
                await api("/api/me", { method: "DELETE", body: { password: delPassword } });
                setUser(null);
                toast("success", "Your account and all its data were deleted.");
                navigate("/");
              } catch (err) {
                setDelError((err as Error).message);
              }
            }}
          >
            <p>This permanently deletes your account, results, records and leaderboard entries. It cannot be undone.</p>
            <label className="field">
              <span>Enter your password to confirm</span>
              <input type="password" autoComplete="current-password" value={delPassword} onChange={(e) => setDelPassword(e.target.value)} />
            </label>
            {delError && <p className="form-error">{delError}</p>}
            <div className="row-gap">
              <button className="btn btn-danger" disabled={!delPassword}>
                permanently delete
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setDelOpen(false)}>
                cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}

export default function ProfilePage() {
  if (PREVIEW) return <PreviewOnly feature="Profile" />;
  return <ProfilePageInner />;
}

export function PublicProfilePage() {
  if (PREVIEW) return <PreviewOnly feature="Profile" />;
  return <PublicProfilePageInner />;
}
