import { useCallback, useEffect, useRef, useState } from "react";
import { TIME_PRESETS, WORD_PRESETS, type Config } from "../../shared/config";
import { LANGUAGES, getLanguage } from "../../shared/languages";
import LiveStats from "../components/LiveStats";
import Modal from "../components/Modal";
import Results from "../components/Results";
import TypingArea from "../components/TypingArea";
import { useAuth } from "../state/auth";
import { useConfig } from "../state/config";
import { useToast } from "../state/toast";
import { useUi } from "../state/ui";
import type { TypingSession } from "../typing/session";
import { useResultSaver } from "../typing/useResultSaver";
import { useTypingTest } from "../typing/useTypingTest";

function isOtherField(el: Element | null): boolean {
  if (!el) return false;
  if ((el as HTMLElement).dataset?.testid === "typing-input") return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
}

export default function TestPage() {
  const { config, set, update } = useConfig();
  const { user } = useAuth();
  const toast = useToast();
  const { typingActive, paletteOpen, shortcutsOpen } = useUi();
  const { session, setup, finished, restart } = useTypingTest(config);
  const [customOpen, setCustomOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [customTime, setCustomTime] = useState(false);

  const makeSubmission = useCallback(
    (s: TypingSession) =>
      s.toSubmission({
        mode: setup.mode,
        mode2: setup.mode2,
        language: setup.language,
        wordListSize: config.wordListSize,
        punctuation: config.punctuation,
        numbers: config.numbers,
        difficulty: config.difficulty,
        strictMode: config.strictMode,
        confidenceMode: config.confidenceMode,
        freedomMode: config.freedomMode,
      }),
    // The config at the time the test ran is the one that matters; setup changes with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setup],
  );
  const { state: save, retry } = useResultSaver(finished, makeSubmission);

  // Quick restart / practice finish keys.
  const restartRef = useRef(restart);
  restartRef.current = restart;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paletteOpen || shortcutsOpen || document.querySelector("dialog[open]")) return;
      if (isOtherField(document.activeElement)) return;
      const qr = config.quickRestart;
      if ((qr === "tab" && e.key === "Tab" && !e.shiftKey) || (qr === "esc" && e.key === "Escape")) {
        e.preventDefault();
        restartRef.current(config.repeatOnRestart && !session.finished);
        return;
      }
      if (qr === "enter" && e.key === "Enter" && session.finished) {
        e.preventDefault();
        restartRef.current(false);
        return;
      }
      if (e.key === "Enter" && e.shiftKey && setup.mode === "practice" && session.started && !session.finished) {
        e.preventDefault();
        session.stop();
        return;
      }
      // Any printable key focuses the test input (the key then lands in it).
      if (!session.finished && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const input = document.querySelector<HTMLInputElement>('[data-testid="typing-input"]');
        if (input && document.activeElement !== input) input.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [config.quickRestart, config.repeatOnRestart, session, setup.mode, paletteOpen, shortcutsOpen]);

  const lang = getLanguage(config.language);
  const hideBar = config.focusMode && typingActive;
  const engine = session.engine;

  return (
    <div className="test-page">
      {!finished && (
        <>
          <TestConfigBar config={config} set={set} update={update} hidden={hideBar} onCustomText={() => setCustomOpen(true)} customTime={customTime} setCustomTime={setCustomTime} />
          <div className={`test-header${hideBar ? " faded" : ""}`}>
            <button className="lang-btn" onClick={() => setLangOpen(true)} aria-label={`Language: ${lang.name}. Change language`}>
              🌐 {lang.name.toLowerCase()}
              {lang.status === "beta" && <span className="beta">beta</span>}
            </button>
          </div>
          <LiveStats session={session} config={config} timeLimitMs={setup.timeLimitMs} />
          <TypingArea
            key={session.id}
            session={session}
            config={config}
            dir={setup.dir}
            onPasteBlocked={() => toast("info", "Pasting is turned off (Settings → input → paste).")}
            onRestartKey={() => restart(false)}
          />
          <div className={`test-actions${hideBar ? " faded" : ""}`}>
            <button className="icon-btn" onClick={() => restart(false)} aria-label="Restart test (new text)" title="Restart test">
              ↻
            </button>
            {setup.mode === "practice" && session.started && (
              <button className="btn btn-small" onClick={() => session.stop()}>
                finish practice <kbd>shift</kbd>+<kbd>enter</kbd>
              </button>
            )}
          </div>
          {lang.status === "beta" && !typingActive && (
            <p className="muted small center">
              {lang.name} needs a {lang.name} keyboard layout or input method on your device. Support is in beta.
            </p>
          )}
        </>
      )}
      {finished && (
        <Results
          stats={engine.stats()}
          timeline={engine.samples}
          keyStats={engine.keyStats}
          failed={engine.failed}
          mode={setup.mode}
          mode2={setup.mode2}
          language={setup.language}
          quoteSource={setup.quote?.source}
          extras={[config.punctuation && "punctuation", config.numbers && "numbers", config.difficulty !== "normal" && config.difficulty, config.strictMode && "strict"].filter(Boolean) as string[]}
          save={save}
          onRetrySave={retry}
          showChart={config.showResultChart}
          showKeyStats={config.showKeyStats}
          signedIn={!!user}
        >
          <div className="results-actions">
            <button className="btn" onClick={() => restart(false)} data-testid="next-test">
              next test
            </button>
            <button className="btn btn-ghost" onClick={() => restart(true)} data-testid="retry-test">
              retry same text
            </button>
          </div>
          <p className="muted small center">
            {config.quickRestart === "tab" ? (
              <>
                <kbd>tab</kbd> next test
              </>
            ) : config.quickRestart === "enter" ? (
              <>
                <kbd>enter</kbd> next test
              </>
            ) : config.quickRestart === "esc" ? (
              <>
                <kbd>esc</kbd> next test
              </>
            ) : null}
          </p>
        </Results>
      )}

      <Modal open={langOpen} onClose={() => setLangOpen(false)} title="Language">
        <div className="option-list" role="listbox" aria-label="Languages">
          {LANGUAGES.map((l) => (
            <button
              key={l.id}
              role="option"
              aria-selected={l.id === config.language}
              className={`option${l.id === config.language ? " active" : ""}`}
              onClick={() => {
                set("language", l.id);
                setLangOpen(false);
              }}
            >
              <span>{l.name}</span>
              <span className="muted" dir={l.dir}>
                {l.nativeName}
              </span>
              {l.status === "beta" && <span className="beta">beta</span>}
            </button>
          ))}
        </div>
      </Modal>
      <CustomTextModal open={customOpen} onClose={() => setCustomOpen(false)} value={config.customText} onSave={(t) => update({ customText: t, mode: "custom" })} />
    </div>
  );
}

function Seg<T extends string | number>({ value, options, onChange, label, render }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string; render?: (v: T) => string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o)} className={o === value ? "active" : ""} aria-pressed={o === value} onClick={() => onChange(o)}>
          {render ? render(o) : String(o)}
        </button>
      ))}
    </div>
  );
}

function TestConfigBar({
  config,
  set,
  update,
  hidden,
  onCustomText,
  customTime,
  setCustomTime,
}: {
  config: Config;
  set: <K extends keyof Config>(k: K, v: Config[K]) => void;
  update: (p: Partial<Config>) => void;
  hidden: boolean;
  onCustomText: () => void;
  customTime: boolean;
  setCustomTime: (v: boolean) => void;
}) {
  const [customValue, setCustomValue] = useState("");
  const showPunct = config.mode === "time" || config.mode === "words" || config.mode === "practice";
  const isCustomTime = config.mode === "time" && !TIME_PRESETS.includes(config.time as (typeof TIME_PRESETS)[number]);
  const isCustomWords = config.mode === "words" && !WORD_PRESETS.includes(config.words as (typeof WORD_PRESETS)[number]);
  return (
    <div className={`config-bar${hidden ? " faded" : ""}`} aria-label="Test settings">
      {showPunct && (
        <div className="seg" role="group" aria-label="Text options">
          <button className={config.punctuation ? "active" : ""} aria-pressed={config.punctuation} onClick={() => set("punctuation", !config.punctuation)}>
            @ punctuation
          </button>
          <button className={config.numbers ? "active" : ""} aria-pressed={config.numbers} onClick={() => set("numbers", !config.numbers)}>
            # numbers
          </button>
        </div>
      )}
      <span className="divider" aria-hidden="true" />
      <Seg label="Test mode" value={config.mode} options={["time", "words", "quote", "custom", "practice"] as const} onChange={(m) => set("mode", m)} />
      <span className="divider" aria-hidden="true" />
      {config.mode === "time" && (
        <div className="seg" role="group" aria-label="Test duration in seconds">
          {TIME_PRESETS.map((t) => (
            <button key={t} className={config.time === t ? "active" : ""} aria-pressed={config.time === t} onClick={() => set("time", t)}>
              {t}
            </button>
          ))}
          <button className={isCustomTime ? "active" : ""} onClick={() => setCustomTime(!customTime)} aria-expanded={customTime}>
            {isCustomTime ? `${config.time}s` : "custom"}
          </button>
        </div>
      )}
      {config.mode === "words" && (
        <div className="seg" role="group" aria-label="Number of words">
          {WORD_PRESETS.map((w) => (
            <button key={w} className={config.words === w ? "active" : ""} aria-pressed={config.words === w} onClick={() => set("words", w)}>
              {w}
            </button>
          ))}
          <button className={isCustomWords ? "active" : ""} onClick={() => setCustomTime(!customTime)} aria-expanded={customTime}>
            {isCustomWords ? config.words : "custom"}
          </button>
        </div>
      )}
      {config.mode === "quote" && <Seg label="Quote length" value={config.quoteLength} options={["any", "short", "medium", "long"] as const} onChange={(q) => set("quoteLength", q)} />}
      {config.mode === "custom" && (
        <div className="seg">
          <button onClick={onCustomText}>✎ edit text</button>
        </div>
      )}
      {config.mode === "practice" && <span className="muted small">no timer · shift+enter to finish</span>}
      {customTime && (config.mode === "time" || config.mode === "words") && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Math.round(Number(customValue));
            if (config.mode === "time" && n >= 5 && n <= 3600) update({ time: n });
            else if (config.mode === "words" && n >= 1 && n <= 1000) update({ words: n });
            else return;
            setCustomTime(false);
          }}
        >
          <label>
            <span className="sr-only">{config.mode === "time" ? "Seconds (5–3600)" : "Words (1–1000)"}</span>
            <input
              type="number"
              autoFocus
              min={config.mode === "time" ? 5 : 1}
              max={config.mode === "time" ? 3600 : 1000}
              placeholder={config.mode === "time" ? "seconds" : "words"}
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
            />
          </label>
          <button className="btn btn-small">set</button>
        </form>
      )}
    </div>
  );
}

function CustomTextModal({ open, onClose, value, onSave }: { open: boolean; onClose: () => void; value: string; onSave: (t: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => {
    if (open) setText(value);
  }, [open, value]);
  return (
    <Modal open={open} onClose={onClose} title="Custom text">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          onSave(text.trim().slice(0, 10000));
          onClose();
        }}
      >
        <label className="field">
          <span>Text to type (up to 10,000 characters). Line breaks become spaces.</span>
          <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} maxLength={10000} />
        </label>
        <p className="muted small">Custom text results are saved to your history but never ranked.</p>
        <div className="row-end">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            cancel
          </button>
          <button className="btn" disabled={!text.trim()}>
            use this text
          </button>
        </div>
      </form>
    </Modal>
  );
}
