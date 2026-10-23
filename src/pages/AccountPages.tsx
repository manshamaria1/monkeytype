import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import PreviewOnly from "../components/PreviewOnly";
import { PREVIEW } from "../lib/preview";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth, type User } from "../state/auth";
import { useToast } from "../state/toast";

function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="page narrow">
      <div className="card">
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function LoginPageInner() {
  const { setUser, user } = useAuth();
  const navigate = useNavigate();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useSubmit();
  useEffect(() => {
    if (user) navigate("/profile", { replace: true });
  }, [user, navigate]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api<{ user: User }>("/api/auth/login", { body: { login, password } });
      setUser(r.user);
      navigate("/");
    });
  };
  return (
    <AuthCard title="Sign in">
      <form onSubmit={submit} className="form" noValidate>
        <label className="field">
          <span>Email or username</span>
          <input autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-block" disabled={busy}>
          {busy ? "signing in…" : "sign in"}
        </button>
      </form>
      <p className="muted small">
        <Link to="/account/forgot">Forgot your password?</Link> · No account? <Link to="/account/register">Create one</Link>
      </p>
    </AuthCard>
  );
}

function RegisterPageInner() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const { busy, error, run } = useSubmit();
  const [localError, setLocalError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return setLocalError("Username must be 3–20 letters, numbers or underscores.");
    if (password.length < 8) return setLocalError("Password must be at least 8 characters.");
    if (password !== confirm) return setLocalError("Passwords do not match.");
    run(async () => {
      const r = await api<{ user: User }>("/api/auth/register", { body: { email, username, password } });
      setUser(r.user);
      navigate("/");
    });
  };
  const err = localError ?? error;
  return (
    <AuthCard title="Create account">
      <p className="muted small">An account keeps your history, syncs your settings and puts you on the leaderboard. Typing tests work without one.</p>
      <form onSubmit={submit} className="form" noValidate>
        <label className="field">
          <span>Username</span>
          <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required maxLength={20} autoFocus />
        </label>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>Password (8+ characters)</span>
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </label>
        <label className="field">
          <span>Confirm password</span>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
        {err && (
          <p className="form-error" role="alert">
            {err}
          </p>
        )}
        <button className="btn btn-block" disabled={busy}>
          {busy ? "creating account…" : "create account"}
        </button>
      </form>
      <p className="muted small">
        Already have an account? <Link to="/account/login">Sign in</Link>
      </p>
    </AuthCard>
  );
}

function ForgotPageInner() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const { busy, error, run } = useSubmit();
  return (
    <AuthCard title="Reset password">
      {sent ? (
        <p role="status">{sent}</p>
      ) : (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const r = await api<{ message: string }>("/api/auth/forgot", { body: { email } });
              setSent(r.message);
            });
          }}
        >
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-block" disabled={busy}>
            send reset link
          </button>
        </form>
      )}
      <p className="muted small">
        <Link to="/account/login">Back to sign in</Link>
      </p>
    </AuthCard>
  );
}

function ResetPageInner() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const toast = useToast();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const { busy, error, run } = useSubmit();
  return (
    <AuthCard title="Choose a new password">
      {!token ? (
        <p className="form-error">This page needs the link from your reset email.</p>
      ) : (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api("/api/auth/reset", { body: { token, password } });
              toast("success", "Password changed. Please sign in.");
              navigate("/account/login");
            });
          }}
        >
          <label className="field">
            <span>New password (8+ characters)</span>
            <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoFocus />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-block" disabled={busy || password.length < 8}>
            set password
          </button>
        </form>
      )}
    </AuthCard>
  );
}

function VerifyPageInner() {
  const [params] = useSearchParams();
  const { refresh } = useAuth();
  const [state, setState] = useState<"working" | "ok" | string>("working");
  useEffect(() => {
    const token = params.get("token");
    if (!token) return setState("This page needs the link from your verification email.");
    api("/api/auth/verify", { body: { token } })
      .then(() => {
        setState("ok");
        void refresh();
      })
      .catch((e) => setState(e.message));
  }, [params, refresh]);
  return (
    <AuthCard title="Email verification">
      {state === "working" && <p>Verifying…</p>}
      {state === "ok" && (
        <p role="status">
          Your email is verified. <Link to="/">Start typing</Link>
        </p>
      )}
      {state !== "working" && state !== "ok" && <p className="form-error">{state}</p>}
    </AuthCard>
  );
}

export function LoginPage() {
  if (PREVIEW) return <PreviewOnly feature="Accounts" />;
  return <LoginPageInner />;
}

export function RegisterPage() {
  if (PREVIEW) return <PreviewOnly feature="Accounts" />;
  return <RegisterPageInner />;
}

export function ForgotPage() {
  if (PREVIEW) return <PreviewOnly feature="Accounts" />;
  return <ForgotPageInner />;
}

export function ResetPage() {
  if (PREVIEW) return <PreviewOnly feature="Accounts" />;
  return <ResetPageInner />;
}

export function VerifyPage() {
  if (PREVIEW) return <PreviewOnly feature="Accounts" />;
  return <VerifyPageInner />;
}
