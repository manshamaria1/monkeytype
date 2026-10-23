import { useRef, useState, type ReactNode } from "react";
import { DEFAULT_CONFIG, FONTS, sanitizeConfig, type Config, type ThemeColors } from "../../shared/config";
import { LANGUAGES } from "../../shared/languages";
import { CUSTOM_THEME_ID, getTheme, THEMES } from "../../shared/themes";
import { playError, playKey } from "../lib/sound";
import { useAuth } from "../state/auth";
import { useConfig } from "../state/config";
import { useToast } from "../state/toast";

function Row({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting-text">
        <h3>{title}</h3>
        <p className="muted small">{desc}</p>
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Choice<K extends keyof Config>({ k, options, labels }: { k: K; options: readonly Config[K][]; labels?: Record<string, string> }) {
  const { config, set } = useConfig();
  return (
    <div className="seg wrap" role="group" aria-label={String(k)}>
      {options.map((o) => (
        <button key={String(o)} className={config[k] === o ? "active" : ""} aria-pressed={config[k] === o} onClick={() => set(k, o)}>
          {labels?.[String(o)] ?? String(o)}
        </button>
      ))}
    </div>
  );
}

function Toggle<K extends keyof Config>({ k }: { k: K }) {
  const { config, set } = useConfig();
  const on = config[k] === true;
  return (
    <div className="seg" role="group">
      <button className={!on ? "active" : ""} aria-pressed={!on} onClick={() => set(k, false as Config[K])}>
        off
      </button>
      <button className={on ? "active" : ""} aria-pressed={on} onClick={() => set(k, true as Config[K])}>
        on
      </button>
    </div>
  );
}

const COLOR_FIELDS: { key: keyof ThemeColors; label: string }[] = [
  { key: "bg", label: "background" },
  { key: "text", label: "correct text" },
  { key: "sub", label: "pending text" },
  { key: "error", label: "errors" },
  { key: "errorExtra", label: "extra letters" },
  { key: "main", label: "accent" },
  { key: "caret", label: "caret" },
  { key: "subAlt", label: "panels" },
];

export default function SettingsPage() {
  const { config, set, update, replace, reset, sync, previewTheme } = useConfig();
  const { user } = useAuth();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const current = getTheme(config.theme, config.customTheme);

  const exportSettings = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "monkeytype-settings.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importSettings = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      replace(sanitizeConfig(data));
      toast("success", "Settings imported. Unknown or invalid values were ignored.");
    } catch {
      toast("error", "That file is not a valid settings export.");
    }
  };

  const syncText = user
    ? { local: "", syncing: "Saving to your account…", synced: "Synced to your account.", error: "Could not sync to your account; saved on this device." }[sync]
    : "Saved on this device. Sign in to sync settings across devices.";

  return (
    <div className="page settings">
      <div className="page-head">
        <h1>Settings</h1>
        <span className="muted small" data-testid="sync-status">
          {syncText}
        </span>
      </div>
      <nav className="settings-nav" aria-label="Settings sections">
        {["test", "input", "appearance", "theme", "display", "sound", "data"].map((s) => (
          <a key={s} href={`#settings-${s}`}>
            {s}
          </a>
        ))}
      </nav>

      <section id="settings-test">
        <h2>Test</h2>
        <Row title="language" desc="Word list and quotes used for tests.">
          <select value={config.language} onChange={(e) => set("language", e.target.value)} aria-label="Language">
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.nativeName}){l.status === "beta" ? " – beta" : ""}
              </option>
            ))}
          </select>
        </Row>
        <Row title="word list size" desc="small = 100 most common words, medium = 200 (the ranked default), full = whole list.">
          <Choice k="wordListSize" options={["small", "medium", "full"] as const} />
        </Row>
        <Row title="difficulty" desc="normal: no penalty. expert: the test fails if you submit a wrong word. master: the test fails on any wrong keystroke.">
          <Choice k="difficulty" options={["normal", "expert", "master"] as const} />
        </Row>
        <Row title="strict mode" desc="Wrong letters are not entered (you must press the right key to continue), and space only works once the word is correct.">
          <Toggle k="strictMode" />
        </Row>
        <Row title="punctuation" desc="Add capitals, commas, full stops and other punctuation to generated words.">
          <Toggle k="punctuation" />
        </Row>
        <Row title="numbers" desc="Mix numbers into generated words.">
          <Toggle k="numbers" />
        </Row>
        <Row title="quote length" desc="Length of quotes in quote mode.">
          <Choice k="quoteLength" options={["any", "short", "medium", "long"] as const} />
        </Row>
      </section>

      <section id="settings-input">
        <h2>Input</h2>
        <Row title="confidence mode" desc="on: you cannot go back to previous words. max: backspace is disabled completely.">
          <Choice k="confidenceMode" options={["off", "on", "max"] as const} />
        </Row>
        <Row title="freedom mode" desc="Allow going back to any previous word, even if it was typed correctly.">
          <Toggle k="freedomMode" />
        </Row>
        <Row title="quick restart" desc="Key that restarts the test. With esc, the command palette moves to alt+shift+K.">
          <Choice k="quickRestart" options={["tab", "esc", "enter", "off"] as const} />
        </Row>
        <Row title="repeat on restart" desc="Quick restart during a test repeats the same text instead of new text.">
          <Toggle k="repeatOnRestart" />
        </Row>
        <Row title="paste" desc="block: pasting into the test is ignored. allow: pasting works but the result is never ranked.">
          <Choice k="pasteMode" options={["block", "allow"] as const} />
        </Row>
      </section>

      <section id="settings-appearance">
        <h2>Appearance</h2>
        <Row title="font family" desc="Font used for the typing text.">
          <select value={config.fontFamily} onChange={(e) => set("fontFamily", e.target.value)} aria-label="Font family">
            {FONTS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Row>
        <Row title="font size" desc="Size of the typing text.">
          <div className="range-row">
            <input
              type="range"
              min={1}
              max={4}
              step={0.25}
              value={config.fontSize}
              onChange={(e) => set("fontSize", Number(e.target.value))}
              aria-label="Font size"
            />
            <span>{config.fontSize}rem</span>
          </div>
        </Row>
        <Row title="caret style" desc="Shape of the typing caret.">
          <Choice k="caretStyle" options={["line", "block", "underline", "outline", "off"] as const} />
        </Row>
        <Row title="smooth caret" desc="How smoothly the caret glides between letters.">
          <Choice k="smoothCaret" options={["off", "slow", "medium", "fast"] as const} />
        </Row>
        <Row title="caret blink" desc="Blink the caret while waiting for input.">
          <Toggle k="caretBlink" />
        </Row>
        <Row title="error display" desc="off: wrong letters turn red. below: also show what you typed under the letter. replace: show what you typed instead.">
          <Choice k="indicateTypos" options={["off", "below", "replace"] as const} />
        </Row>
        <Row title="focus mode" desc="Hide the navigation and test options while you type.">
          <Toggle k="focusMode" />
        </Row>
        <Row title="reduced motion" desc="Turn off caret gliding and other animations. 'system' follows your device setting.">
          <Choice k="reducedMotion" options={["system", "on", "off"] as const} />
        </Row>
      </section>

      <section id="settings-theme">
        <h2>Theme</h2>
        <p className="muted small">Hover to preview, click to apply. Current: {current.name}</p>
        <div className="theme-grid" onMouseLeave={() => previewTheme(null)}>
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={`theme-swatch${config.theme === t.id ? " active" : ""}`}
              style={{ background: t.bg, color: t.text, borderColor: config.theme === t.id ? t.main : t.subAlt }}
              onMouseEnter={() => previewTheme(t.id)}
              onFocus={() => previewTheme(t.id)}
              onBlur={() => previewTheme(null)}
              onClick={() => set("theme", t.id)}
              aria-pressed={config.theme === t.id}
            >
              <span>{t.name}</span>
              <span className="swatch-dots" aria-hidden="true">
                <i style={{ background: t.main }} />
                <i style={{ background: t.sub }} />
                <i style={{ background: t.error }} />
              </span>
            </button>
          ))}
        </div>
        <h3>Custom colours</h3>
        <p className="muted small">Start from the current theme and change any colour. The custom theme is applied as you edit.</p>
        <div className="color-grid">
          {COLOR_FIELDS.map((f) => (
            <label key={f.key} className="color-field">
              <input
                type="color"
                value={(config.customTheme ?? current)[f.key]}
                onChange={(e) => {
                  const base: ThemeColors = config.customTheme ?? {
                    bg: current.bg,
                    main: current.main,
                    caret: current.caret,
                    sub: current.sub,
                    subAlt: current.subAlt,
                    text: current.text,
                    error: current.error,
                    errorExtra: current.errorExtra,
                  };
                  update({ customTheme: { ...base, [f.key]: e.target.value }, theme: CUSTOM_THEME_ID });
                }}
              />
              <span>{f.label}</span>
            </label>
          ))}
        </div>
        {config.customTheme && (
          <button className="btn btn-small btn-ghost" onClick={() => update({ customTheme: null, theme: DEFAULT_CONFIG.theme })}>
            remove custom theme
          </button>
        )}
      </section>

      <section id="settings-display">
        <h2>Live stats & results</h2>
        <Row title="live wpm" desc="Show your speed while typing.">
          <Toggle k="liveWpm" />
        </Row>
        <Row title="live accuracy" desc="Show your accuracy while typing.">
          <Toggle k="liveAccuracy" />
        </Row>
        <Row title="timer / progress" desc="How remaining time or word progress is shown during a test.">
          <Choice k="timerStyle" options={["text", "bar", "off"] as const} />
        </Row>
        <Row title="result chart" desc="Show the speed-over-time chart on the results screen.">
          <Toggle k="showResultChart" />
        </Row>
        <Row title="missed keys" desc="Show your most-missed keys on the results screen.">
          <Toggle k="showKeyStats" />
        </Row>
      </section>

      <section id="settings-sound">
        <h2>Sound</h2>
        <Row title="keystroke sound" desc="Sound played on each keystroke.">
          <Choice k="sound" options={["off", "click", "beep", "pop"] as const} />
        </Row>
        <Row title="error sound" desc="Play a different sound on a wrong keystroke.">
          <Toggle k="errorSound" />
        </Row>
        <Row title="volume" desc="Volume of typing sounds.">
          <div className="range-row">
            <input type="range" min={0} max={1} step={0.05} value={config.soundVolume} onChange={(e) => set("soundVolume", Number(e.target.value))} aria-label="Volume" />
            <button
              className="btn btn-small"
              onClick={() => {
                if (config.sound !== "off") playKey(config.sound, config.soundVolume);
                if (config.errorSound) setTimeout(() => playError(config.soundVolume), 250);
              }}
            >
              test
            </button>
          </div>
        </Row>
      </section>

      <section id="settings-data">
        <h2>Import, export & reset</h2>
        <Row title="export settings" desc="Download your settings as a JSON file.">
          <button className="btn btn-small" onClick={exportSettings}>
            export
          </button>
        </Row>
        <Row title="import settings" desc="Load settings from an exported JSON file.">
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importSettings(e.target.files[0])} />
          <button className="btn btn-small" onClick={() => fileRef.current?.click()}>
            import
          </button>
        </Row>
        <Row title="reset to defaults" desc="Restore every setting to its default value.">
          {confirmReset ? (
            <span className="row-gap">
              <button
                className="btn btn-small btn-danger"
                onClick={() => {
                  reset();
                  setConfirmReset(false);
                  toast("success", "Settings reset to defaults.");
                }}
              >
                yes, reset
              </button>
              <button className="btn btn-small btn-ghost" onClick={() => setConfirmReset(false)}>
                cancel
              </button>
            </span>
          ) : (
            <button className="btn btn-small btn-danger" onClick={() => setConfirmReset(true)} data-testid="reset-settings">
              reset
            </button>
          )}
        </Row>
      </section>
    </div>
  );
}
