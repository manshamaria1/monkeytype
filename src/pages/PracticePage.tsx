import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { dailyChallenge, todayUtc } from "../../shared/challenge";
import { getLesson, LESSONS, weakKeyWords } from "../../shared/lessons";
import DrillRunner from "../components/DrillRunner";
import { api } from "../lib/api";
import { fmt } from "../lib/format";
import { getLocalHistory } from "../lib/localHistory";
import { readJson, writeJson } from "../lib/storage";
import { useAuth } from "../state/auth";
import { useConfig } from "../state/config";
import { useToast } from "../state/toast";
import type { TypingSession } from "../typing/session";

interface LessonProgress {
  lesson_id: string;
  attempts: number;
  best_wpm: number;
  best_accuracy: number;
  completed_at: string | null;
}

const LOCAL_LESSONS = "mt.lessonProgress";
const LOCAL_CHALLENGES = "mt.challenges";

/** Lesson progress: from the account when signed in, otherwise from this device. */
function useLessonProgress() {
  const { user } = useAuth();
  const [progress, setProgress] = useState<Record<string, LessonProgress>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (user) {
      api<{ progress: LessonProgress[] }>("/api/me/lessons")
        .then((r) => setProgress(Object.fromEntries(r.progress.map((p) => [p.lesson_id, p]))))
        .catch((e) => setError(e.message));
    } else setProgress(readJson(LOCAL_LESSONS, {}));
  }, [user]);
  return { progress, error };
}

export function recordLocalLesson(id: string, wpm: number, acc: number, passed: boolean) {
  const all = readJson<Record<string, LessonProgress>>(LOCAL_LESSONS, {});
  const p = all[id] ?? { lesson_id: id, attempts: 0, best_wpm: 0, best_accuracy: 0, completed_at: null };
  all[id] = {
    ...p,
    attempts: p.attempts + 1,
    best_wpm: Math.max(p.best_wpm, wpm),
    best_accuracy: Math.max(p.best_accuracy, acc),
    completed_at: p.completed_at ?? (passed ? new Date().toISOString() : null),
  };
  writeJson(LOCAL_LESSONS, all);
}

export default function PracticePage() {
  const { user } = useAuth();
  const { update } = useConfig();
  const navigate = useNavigate();
  const { progress, error } = useLessonProgress();
  const today = todayUtc();
  const challenge = useMemo(() => dailyChallenge(today), [today]);
  const [challengeDone, setChallengeDone] = useState<{ best_wpm: number; best_accuracy: number } | null>(null);
  useEffect(() => {
    if (user)
      api<{ challenges: { date: string; best_wpm: number; best_accuracy: number }[] }>("/api/me/challenges")
        .then((r) => setChallengeDone(r.challenges.find((c) => c.date === today) ?? null))
        .catch(() => {});
    else setChallengeDone(readJson<Record<string, { best_wpm: number; best_accuracy: number }>>(LOCAL_CHALLENGES, {})[today] ?? null);
  }, [user, today]);
  const completed = LESSONS.filter((l) => progress[l.id]?.completed_at).length;
  const categories = [...new Set(LESSONS.map((l) => l.category))];

  return (
    <div className="page">
      <h1>Practice & lessons</h1>
      <div className="practice-cards">
        <Link to="/practice/challenge" className="card practice-card">
          <h2>📅 Daily challenge</h2>
          <p>
            <strong>{challenge.title}</strong> — {challenge.description}
          </p>
          <p className="muted small">
            {challengeDone ? `✓ completed today · best ${fmt(challengeDone.best_wpm)} wpm` : "Same text for everyone today (UTC). Not completed yet."}
          </p>
        </Link>
        <Link to="/practice/weak-keys" className="card practice-card">
          <h2>🎯 Weak keys</h2>
          <p>Drill words that contain the letters you miss most often, based on your recent tests.</p>
        </Link>
        <button
          className="card practice-card"
          onClick={() => {
            update({ mode: "custom" });
            navigate("/");
          }}
        >
          <h2>✎ Custom text</h2>
          <p>Practise any text you like. Opens the test in custom mode; use "edit text" to enter your own.</p>
        </button>
      </div>
      <Goals />
      <div className="page-head">
        <h2>Lessons</h2>
        <span className="muted">
          {completed}/{LESSONS.length} passed{!user && " (saved on this device)"}
        </span>
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {categories.map((cat) => (
        <section key={cat}>
          <h3 className="muted">{cat}</h3>
          <div className="lesson-grid">
            {LESSONS.filter((l) => l.category === cat).map((l) => {
              const p = progress[l.id];
              return (
                <Link key={l.id} to={`/practice/lesson/${l.id}`} className={`card lesson-card${p?.completed_at ? " done" : ""}`}>
                  <div className="lesson-title">
                    {p?.completed_at ? "✓ " : ""}
                    {l.title}
                  </div>
                  <p className="muted small">{l.description}</p>
                  <p className="small">
                    pass: {l.passAccuracy}% accuracy, {l.passWpm} wpm
                    {p && (
                      <span className="muted">
                        {" "}
                        · best {fmt(p.best_wpm)} wpm / {fmt(p.best_accuracy)}% · {p.attempts} tries
                      </span>
                    )}
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function Goals() {
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<{ goals: { daily_tests: number; daily_minutes: number; target_wpm: number } | null; today: { tests: number; minutes: number; bestWpm: number } } | null>(null);
  const [edit, setEdit] = useState<{ daily_tests: number; daily_minutes: number; target_wpm: number } | null>(null);
  useEffect(() => {
    if (user)
      api<typeof data>("/api/me/goals")
        .then(setData)
        .catch(() => {});
  }, [user]);
  if (!user)
    return (
      <div className="card">
        <h2>Personal goals</h2>
        <p className="muted">
          <Link to="/account/login">Sign in</Link> to set daily goals and track them across devices.
        </p>
      </div>
    );
  if (!data) return null;
  const g = data.goals ?? { daily_tests: 5, daily_minutes: 10, target_wpm: 60 };
  const bar = (v: number, max: number) => (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(Math.min(1, max ? v / max : 0) * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${Math.min(100, max ? (v / max) * 100 : 0)}%` }} />
    </div>
  );
  return (
    <div className="card">
      <div className="page-head">
        <h2>Today's goals</h2>
        {!edit && (
          <button className="btn btn-small btn-ghost" onClick={() => setEdit(g)}>
            {data.goals ? "edit goals" : "set goals"}
          </button>
        )}
      </div>
      {edit ? (
        <form
          className="form goal-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/api/me/goals", { method: "PUT", body: edit });
              setData({ ...data, goals: edit });
              setEdit(null);
              toast("success", "Goals saved.");
            } catch (err) {
              toast("error", (err as Error).message);
            }
          }}
        >
          <label className="field-inline">
            <span>tests per day</span>
            <input type="number" min={0} max={500} value={edit.daily_tests} onChange={(e) => setEdit({ ...edit, daily_tests: Number(e.target.value) })} />
          </label>
          <label className="field-inline">
            <span>minutes per day</span>
            <input type="number" min={0} max={600} value={edit.daily_minutes} onChange={(e) => setEdit({ ...edit, daily_minutes: Number(e.target.value) })} />
          </label>
          <label className="field-inline">
            <span>target wpm</span>
            <input type="number" min={0} max={400} value={edit.target_wpm} onChange={(e) => setEdit({ ...edit, target_wpm: Number(e.target.value) })} />
          </label>
          <button className="btn btn-small">save</button>
          <button type="button" className="btn btn-small btn-ghost" onClick={() => setEdit(null)}>
            cancel
          </button>
        </form>
      ) : (
        <div className="goals">
          <div>
            <span>
              tests: {data.today.tests}/{g.daily_tests}
            </span>
            {bar(data.today.tests, g.daily_tests)}
          </div>
          <div>
            <span>
              minutes: {data.today.minutes}/{g.daily_minutes}
            </span>
            {bar(data.today.minutes, g.daily_minutes)}
          </div>
          <div>
            <span>
              best wpm today: {fmt(data.today.bestWpm)}/{g.target_wpm}
            </span>
            {bar(data.today.bestWpm, g.target_wpm)}
          </div>
          {!data.goals && <p className="muted small">These are suggested goals. Set your own to save them.</p>}
        </div>
      )}
    </div>
  );
}

export function LessonPage() {
  const { id } = useParams();
  const lesson = getLesson(id ?? "");
  const { user } = useAuth();
  const navigate = useNavigate();
  if (!lesson)
    return (
      <div className="page">
        <p>Lesson not found.</p>
        <Link to="/practice">← back to practice</Link>
      </div>
    );
  const idx = LESSONS.indexOf(lesson);
  const nextLesson = LESSONS[idx + 1];
  const evaluate = (s: TypingSession) => {
    const st = s.engine.stats();
    return !s.engine.failed && st.accuracy >= lesson.passAccuracy && st.wpm >= lesson.passWpm;
  };
  return (
    <div className="page">
      <Link to="/practice">← all lessons</Link>
      <h1>{lesson.title}</h1>
      <p>{lesson.description}</p>
      <p className="tip">
        <strong>Finger placement:</strong> {lesson.tip}
      </p>
      <p className="muted small">
        Pass with at least {lesson.passAccuracy}% accuracy and {lesson.passWpm} wpm.
      </p>
      <DrillRunner
        key={lesson.id}
        makeWords={() => lesson.generate(Math.random)}
        mode="lesson"
        mode2={lesson.id}
        showKeyboard
        focusKeys={lesson.keys}
        onFinished={(s) => {
          if (!user && s.engine.stats().correctKeys > 0) {
            const st = s.engine.stats();
            recordLocalLesson(lesson.id, st.wpm, st.accuracy, evaluate(s));
          }
        }}
        renderOutcome={(s) => {
          const passed = evaluate(s);
          const st = s.engine.stats();
          return (
            <div className={`lesson-outcome ${passed ? "pass" : "fail"}`} data-testid="lesson-outcome">
              {passed ? (
                <>
                  <strong>✓ Lesson passed!</strong>{" "}
                  {nextLesson && (
                    <button className="link-btn" onClick={() => navigate(`/practice/lesson/${nextLesson.id}`)}>
                      Next: {nextLesson.title} →
                    </button>
                  )}
                </>
              ) : (
                <>
                  <strong>Not passed yet.</strong>{" "}
                  {st.accuracy < lesson.passAccuracy
                    ? `Accuracy ${fmt(st.accuracy)}% is below ${lesson.passAccuracy}%: slow down a little and aim for fewer mistakes.`
                    : `Speed ${fmt(st.wpm)} wpm is below ${lesson.passWpm} wpm: keep a steady rhythm and try again.`}
                </>
              )}
            </div>
          );
        }}
      />
    </div>
  );
}

export function ChallengePage() {
  const today = todayUtc();
  const { user } = useAuth();
  const challenge = useMemo(() => dailyChallenge(today), [today]);
  return (
    <div className="page">
      <Link to="/practice">← practice</Link>
      <h1>Daily challenge · {today}</h1>
      <p>
        <strong>{challenge.title}</strong> — {challenge.description}
      </p>
      <DrillRunner
        makeWords={() => challenge.words}
        mode="challenge"
        mode2={today}
        onFinished={(s) => {
          const st = s.engine.stats();
          if (!user && st.correctKeys > 0 && !s.engine.failed) {
            const all = readJson<Record<string, { best_wpm: number; best_accuracy: number }>>(LOCAL_CHALLENGES, {});
            const prev = all[today];
            all[today] = { best_wpm: Math.max(prev?.best_wpm ?? 0, st.wpm), best_accuracy: Math.max(prev?.best_accuracy ?? 0, st.accuracy) };
            writeJson(LOCAL_CHALLENGES, all);
          }
        }}
        renderOutcome={(s) => {
          const st = s.engine.stats();
          const hit = st.accuracy >= challenge.targetAccuracy;
          return (
            <div className={`lesson-outcome ${hit ? "pass" : "fail"}`}>
              {hit ? `✓ Challenge complete with ${fmt(st.accuracy)}% accuracy.` : `Completed, but below the ${challenge.targetAccuracy}% accuracy target. Try again!`}
            </div>
          );
        }}
      />
    </div>
  );
}

export function WeakKeysPage() {
  const { user } = useAuth();
  const [keys, setKeys] = useState<{ key: string; missRate: number; hit: number; miss: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (user) {
      api<{ keys: { key: string; missRate: number; hit: number; miss: number }[] }>("/api/me/weak-keys")
        .then((r) => setKeys(r.keys))
        .catch((e) => setError(e.message));
    } else {
      // Guests: use results stored on this device.
      const agg: Record<string, { hit: number; miss: number }> = {};
      for (const r of getLocalHistory()) {
        if (r.submission.language !== "english") continue;
        const ks = r.keyStats;
        if (!ks) continue;
        for (const [k, v] of Object.entries(ks)) {
          if (!/^[a-z]$/.test(k)) continue;
          const a = (agg[k] ??= { hit: 0, miss: 0 });
          a.hit += v.hit;
          a.miss += v.miss;
        }
      }
      setKeys(
        Object.entries(agg)
          .filter(([, v]) => v.hit + v.miss >= 10)
          .map(([key, v]) => ({ key, ...v, missRate: v.miss / (v.hit + v.miss) }))
          .sort((a, b) => b.missRate - a.missRate),
      );
    }
  }, [user]);
  const weakest = (keys ?? []).filter((k) => k.miss > 0).slice(0, 4);
  return (
    <div className="page">
      <Link to="/practice">← practice</Link>
      <h1>Weak keys</h1>
      {error && <div className="banner banner-error">{error}</div>}
      {!keys && !error && <p className="muted">Analysing your recent tests…</p>}
      {keys && weakest.length === 0 && (
        <div className="empty">
          <p>Not enough data yet. Complete a few English tests and come back; we need at least 10 presses of a key to judge it.</p>
          <Link className="btn" to="/">
            take a test
          </Link>
        </div>
      )}
      {weakest.length > 0 && (
        <>
          <p>
            Your most-missed keys:{" "}
            {weakest.map((k) => (
              <span className="key-chip" key={k.key}>
                {k.key} <small>{fmt(k.missRate * 100)}% missed</small>
              </span>
            ))}
          </p>
          <DrillRunner makeWords={() => weakKeyWords(weakest.map((k) => k.key), 30)} mode="custom" mode2="weak-keys" showKeyboard focusKeys={weakest.map((k) => k.key).join("")} />
        </>
      )}
    </div>
  );
}
