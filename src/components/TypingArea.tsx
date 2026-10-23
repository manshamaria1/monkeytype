import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Config } from "../../shared/config";
import type { TypingSession } from "../typing/session";

/** Split a word into grapheme clusters, keeping each cluster's code-point range. */
const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

interface Cluster {
  text: string;
  start: number; // code point index
  end: number;
}

const clusterCache = new Map<string, Cluster[]>();
function clusters(word: string): Cluster[] {
  let c = clusterCache.get(word);
  if (c) return c;
  c = [];
  let i = 0;
  const parts = segmenter ? Array.from(segmenter.segment(word), (s) => s.segment) : Array.from(word);
  for (const p of parts) {
    const len = Array.from(p).length;
    c.push({ text: p, start: i, end: i + len });
    i += len;
  }
  if (clusterCache.size > 5000) clusterCache.clear();
  clusterCache.set(word, c);
  return c;
}

interface WordProps {
  target: string;
  typed: string;
  active: boolean;
  committed: boolean;
  indicateTypos: Config["indicateTypos"];
}

/** One word. Memoised: only the active word re-renders on a keystroke. */
const Word = memo(function Word({ target, typed, active, committed, indicateTypos }: WordProps) {
  const t = Array.from(target);
  const ty = Array.from(typed);
  const cs = clusters(target);
  const wrong = committed && typed !== target;
  return (
    <div className={`word${active ? " active" : ""}${wrong ? " error" : ""}`}>
      {cs.map((c) => {
        let state = "pending";
        let shown = c.text;
        let typedHere = "";
        if (ty.length > c.start) {
          let bad = false;
          for (let j = c.start; j < Math.min(c.end, ty.length); j++) if (ty[j] !== t[j]) bad = true;
          state = bad ? "incorrect" : "correct";
          if (bad) typedHere = ty.slice(c.start, Math.min(c.end, ty.length)).join("");
          if (bad && indicateTypos === "replace") shown = typedHere;
        } else if (committed) {
          state = "missed";
        }
        return (
          <span key={c.start} data-i={c.start} className={`letter ${state}`}>
            {shown}
            {state === "incorrect" && indicateTypos === "below" && <span className="typo-hint">{typedHere}</span>}
          </span>
        );
      })}
      {ty.length > t.length && (
        <span className="letter extra" data-extra="1">
          {ty.slice(t.length).join("")}
        </span>
      )}
    </div>
  );
});

interface Props {
  session: TypingSession;
  config: Config;
  dir?: "ltr" | "rtl";
  /** Disabled while a multiplayer countdown runs. */
  disabled?: boolean;
  autoFocus?: boolean;
  onPasteBlocked?: () => void;
  onRestartKey?: () => void;
}

export default function TypingArea({ session, config, dir = "ltr", disabled, autoFocus = true, onPasteBlocked, onRestartKey }: Props) {
  useSyncExternalStore(session.subscribe, session.getVersion);
  const engine = session.engine;
  const inputRef = useRef<HTMLInputElement>(null);
  const wordsRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const [focused, setFocused] = useState(false);
  const [shift, setShift] = useState(0);

  const focus = useCallback(() => inputRef.current?.focus({ preventScroll: true }), []);

  useEffect(() => {
    if (autoFocus && !disabled) focus();
  }, [session, autoFocus, disabled, focus]);

  // Keep the input element in sync with the engine (e.g. after a rejected key).
  const syncInput = (value: string) => {
    const el = inputRef.current;
    if (el && el.value !== value) el.value = value;
  };

  const process = () => {
    const el = inputRef.current;
    if (!el || composing.current || disabled) return;
    syncInput(session.input(el.value));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    if (e.key === "Backspace" && (e.currentTarget.value === "" || e.currentTarget.selectionEnd === 0) && !composing.current) {
      e.preventDefault();
      syncInput(session.back());
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (config.quickRestart === "enter") onRestartKey?.();
      return;
    }
    // Keep the text cursor at the end: the engine reads the whole field value.
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) e.preventDefault();
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (config.pasteMode === "block") {
      e.preventDefault();
      onPasteBlocked?.();
    } else {
      session.pasted = true;
    }
  };

  // Caret position and line scrolling, measured after each render.
  useLayoutEffect(() => {
    // The engine is the source of truth for the current word's text.
    const el = inputRef.current;
    if (el && !composing.current && el.value !== engine.currentTyped) el.value = engine.currentTyped;
    const inner = innerRef.current;
    const caret = caretRef.current;
    if (!inner) return;
    const wordEl = inner.children[engine.index] as HTMLElement | undefined;
    if (!wordEl) return;
    const lineH = wordEl.offsetHeight;
    const top = wordEl.offsetTop;
    const newShift = top > lineH * 1.5 ? top - lineH : 0;
    if (newShift !== shift) setShift(newShift);
    if (!caret) return;
    const typedLen = engine.typed[engine.index]?.length ?? 0;
    const letters = Array.from(wordEl.children) as HTMLElement[];
    let x: number;
    const rtl = dir === "rtl";
    const next = letters.find((l) => !l.dataset.extra && Number(l.dataset.i) >= typedLen);
    if (next) {
      x = rtl ? next.offsetLeft + next.offsetWidth : next.offsetLeft;
    } else {
      const last = letters[letters.length - 1];
      x = last ? (rtl ? last.offsetLeft : last.offsetLeft + last.offsetWidth) : wordEl.offsetLeft;
    }
    caret.style.transform = `translate(${x}px, ${top - newShift}px)`;
    caret.style.height = `${lineH}px`;
  });

  const typing = session.started && !session.finished;
  const smooth = { off: "0ms", slow: "150ms", medium: "100ms", fast: "60ms" }[config.smoothCaret];
  const words = engine.words;
  // Only render words up to a window after the current one; long timed tests keep growing.
  const visibleEnd = Math.min(words.length, engine.index + 120);

  return (
    <div
      className={`typing-area${focused || disabled ? "" : " blurred"}`}
      onMouseDown={(e) => {
        e.preventDefault();
        focus();
      }}
    >
      <input
        ref={inputRef}
        className="hidden-input"
        aria-label="Typing input"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        enterKeyHint="next"
        dir={dir}
        data-testid="typing-input"
        onInput={process}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onDrop={(e) => e.preventDefault()}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => {
          composing.current = false;
          process();
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <div className="words-viewport" ref={wordsRef} dir={dir} style={{ fontSize: "var(--font-size)" }}>
        <div className="words" ref={innerRef} style={{ transform: `translateY(${-shift}px)` }} data-testid="words">
          {words.slice(0, visibleEnd).map((w, i) => {
            const target = w.join("");
            const typed = i <= engine.index ? engine.typed[i].join("") : "";
            return (
              <Word
                key={i}
                target={target}
                typed={typed}
                active={i === engine.index}
                committed={engine.committed[i]}
                indicateTypos={config.indicateTypos}
              />
            );
          })}
        </div>
        {config.caretStyle !== "off" && !session.finished && (
          <div
            ref={caretRef}
            className={`caret caret-${config.caretStyle}${config.caretBlink && !typing ? " blink" : ""}`}
            style={{ transitionDuration: smooth }}
            aria-hidden="true"
          />
        )}
      </div>
      {!focused && !disabled && !session.finished && (
        <div className="focus-hint" aria-hidden="true">
          Click here or press any key to focus
        </div>
      )}
    </div>
  );
}
