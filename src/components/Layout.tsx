import { Suspense, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { clearLocalHistory, getLocalHistory } from "../lib/localHistory";
import { DURATION_SHORTCUTS, NAV_SHORTCUTS } from "../lib/shortcuts";
import { useAuth } from "../state/auth";
import { PREVIEW } from "../lib/preview";
import { WP_BUILD } from "../lib/wp";
import { useConfig } from "../state/config";
import { useToast } from "../state/toast";
import { useUi } from "../state/ui";
import CommandPalette from "./CommandPalette";
import Modal from "./Modal";

const NAV = [
  { to: "/", label: "test", icon: "⌨", end: true },
  { to: "/leaderboard", label: "leaderboard", icon: "🏆" },
  { to: "/multiplayer", label: "multiplayer", icon: "⚔" },
  { to: "/stats", label: "stats", icon: "📈" },
  { to: "/practice", label: "practice", icon: "🎓" },
  { to: "/settings", label: "settings", icon: "⚙" },
  { to: "/about", label: "about", icon: "ⓘ" },
];

function inEditableField(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

export default function Layout() {
  const { user, offline } = useAuth();
  const { config, update } = useConfig();
  const ui = useUi();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const focusHide = config.focusMode && ui.typingActive;

  useEffect(() => setMenuOpen(false), [location.pathname]);

  // Global shortcuts. Alt+Shift combos are matched by physical key (e.code) so they
  // work on every layout and on macOS (where Option changes e.key).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const nav = NAV_SHORTCUTS.find((s) => s.code === e.code);
        if (nav) {
          e.preventDefault();
          navigate(nav.path);
          return;
        }
        const dur = DURATION_SHORTCUTS.find((s) => s.code === e.code);
        if (dur) {
          e.preventDefault();
          update({ mode: "time", time: dur.seconds });
          navigate("/");
          return;
        }
        if (e.code === "KeyF") {
          e.preventDefault();
          update({ focusMode: !config.focusMode });
          return;
        }
        if (e.code === "KeyK") {
          e.preventDefault();
          ui.setPaletteOpen(true);
          return;
        }
      }
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "Escape" && config.quickRestart !== "esc" && !ui.paletteOpen) {
        e.preventDefault();
        ui.setPaletteOpen(true);
        return;
      }
      if (e.key === "?" && !inEditableField()) {
        e.preventDefault();
        ui.setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, update, config.focusMode, config.quickRestart, ui]);

  return (
    <div className={`app${focusHide ? " focus-active" : ""}`}>
      {!WP_BUILD && (
        <a href="#main" className="skip-link">
          Skip to content
        </a>
      )}
      <header className="header">
        {!WP_BUILD && (
        <Link to="/" className="logo" aria-label="Monkeytype home">
          <span className="logo-mark" aria-hidden="true">
            🐒
          </span>
          <span className="logo-text">monkeytype</span>
        </Link>
        )}
        <button className="icon-btn menu-toggle" aria-expanded={menuOpen} aria-controls="main-nav" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">
          ☰
        </button>
        <nav id="main-nav" className={`nav${menuOpen ? " open" : ""}`} aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="nav-link">
              <span aria-hidden="true">{n.icon}</span> <span className="nav-label">{n.label}</span>
            </NavLink>
          ))}
          {user ? (
            <NavLink to="/profile" className="nav-link nav-user">
              <span aria-hidden="true">👤</span> <span className="nav-label">{user.username}</span>
            </NavLink>
          ) : (
            <NavLink to="/account/login" className="nav-link">
              <span aria-hidden="true">👤</span> <span className="nav-label">sign in</span>
            </NavLink>
          )}
        </nav>
      </header>
      {PREVIEW ? (
        <div className="banner">
          Preview without a server: typing tests, settings, themes and practice work, and results stay in this browser. Accounts, leaderboards and
          multiplayer need the full app running on a server.
        </div>
      ) : (
        offline && <div className="banner banner-error">Can't reach the server. Typing tests still work; results are kept on this device.</div>
      )}
      <ImportBanner />
      <VerifyBanner />
      <main id="main" className="main">
        <Suspense fallback={<div className="page muted">Loading…</div>}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="footer">
        <button className="link-btn" onClick={() => ui.setShortcutsOpen(true)}>
          <kbd>?</kbd> shortcuts
        </button>
        <span>
          <kbd>esc</kbd> or <kbd>alt</kbd>+<kbd>shift</kbd>+<kbd>k</kbd> command palette
        </span>
        <Link to="/about">about</Link>
        <Link to="/about#privacy">privacy</Link>
      </footer>
      <CommandPalette />
      <ShortcutsPanel />
    </div>
  );
}

function ShortcutsPanel() {
  const ui = useUi();
  const { config } = useConfig();
  return (
    <Modal open={ui.shortcutsOpen} onClose={() => ui.setShortcutsOpen(false)} title="Keyboard shortcuts">
      <table className="shortcuts">
        <tbody>
          <tr>
            <td>
              <kbd>{config.quickRestart === "off" ? "(off)" : config.quickRestart}</kbd>
            </td>
            <td>Restart test (change in Settings → input)</td>
          </tr>
          <tr>
            <td>
              <kbd>esc</kbd> / <kbd>alt</kbd>+<kbd>shift</kbd>+<kbd>K</kbd>
            </td>
            <td>Command palette (themes, modes, languages, navigation)</td>
          </tr>
          <tr>
            <td>
              <kbd>shift</kbd>+<kbd>enter</kbd>
            </td>
            <td>Finish a practice-mode test</td>
          </tr>
          <tr>
            <td>
              <kbd>alt</kbd>+<kbd>shift</kbd>+<kbd>F</kbd>
            </td>
            <td>Toggle focus mode</td>
          </tr>
          {DURATION_SHORTCUTS.map((d) => (
            <tr key={d.code}>
              <td>
                <kbd>alt</kbd>+<kbd>shift</kbd>+<kbd>{d.key}</kbd>
              </td>
              <td>Time test: {d.seconds} seconds</td>
            </tr>
          ))}
          {NAV_SHORTCUTS.map((s) => (
            <tr key={s.code}>
              <td>
                <kbd>alt</kbd>+<kbd>shift</kbd>+<kbd>{s.key}</kbd>
              </td>
              <td>Go to {s.label}</td>
            </tr>
          ))}
          <tr>
            <td>
              <kbd>?</kbd>
            </td>
            <td>This panel (when not typing)</td>
          </tr>
        </tbody>
      </table>
      <p className="muted small">Shortcuts are ignored while you type in form fields. On macOS, alt is the Option key.</p>
    </Modal>
  );
}

function ImportBanner() {
  const { user } = useAuth();
  const toast = useToast();
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setCount(user ? getLocalHistory().length : 0);
  }, [user]);
  if (!user || count === 0) return null;
  return (
    <div className="banner">
      You have {count} result{count === 1 ? "" : "s"} saved on this device from before you signed in.{" "}
      <button
        className="link-btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await api<{ imported: number; skipped: number }>("/api/results/import", {
              body: { results: getLocalHistory().map((x) => x.submission) },
            });
            clearLocalHistory();
            setCount(0);
            toast("success", `Imported ${r.imported} result(s)${r.skipped ? `, skipped ${r.skipped}` : ""}. Imported results are not ranked.`);
          } catch (e) {
            toast("error", (e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "importing…" : "import them into your account"}
      </button>{" "}
      ·{" "}
      <button
        className="link-btn"
        onClick={() => {
          clearLocalHistory();
          setCount(0);
        }}
      >
        discard
      </button>
    </div>
  );
}

function VerifyBanner() {
  const { user } = useAuth();
  const toast = useToast();
  const [hidden, setHidden] = useState(false);
  if (!user || user.emailVerified || hidden) return null;
  return (
    <div className="banner">
      Please verify your email address ({user.email}).{" "}
      <button
        className="link-btn"
        onClick={() =>
          api("/api/auth/resend-verification", { method: "POST" })
            .then(() => toast("success", "Verification email sent."))
            .catch((e) => toast("error", e.message))
        }
      >
        resend email
      </button>{" "}
      ·{" "}
      <button className="link-btn" onClick={() => setHidden(true)}>
        dismiss
      </button>
    </div>
  );
}
