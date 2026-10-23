/**
 * Typing engine. Pure TypeScript, no DOM. The browser feeds it events; the server
 * replays the same event log through it to verify submitted results. Both sides
 * therefore compute statistics with exactly the same code.
 *
 * Text model: each word is an array of Unicode code points (Array.from). The user's
 * input for the current word is diffed against the previous input, so this works
 * with physical keyboards, mobile keyboards (autocorrect replaces whole words) and
 * IMEs (composition is applied once committed).
 *
 * Time model: every event carries `t`, the milliseconds since the first input.
 * The engine never runs its own timer. The caller decides when time is up and calls
 * `finish(t)` with the exact end time, so a throttled background tab cannot stretch
 * or shrink a test.
 */

export type TypingEvent =
  /** The current word's input field now contains `value` (no spaces). */
  | { t: number; k: "i"; v: string }
  /** Space: submit the current word. */
  | { t: number; k: "c" }
  /** Backspace with an empty current word: go back to the previous word. */
  | { t: number; k: "b" };

export interface EngineRules {
  /** Strict mode: wrong letters are rejected and a word can only be submitted when correct. */
  strict: boolean;
  /** off: normal; on: cannot go back to previous words; max: backspace disabled. */
  confidence: "off" | "on" | "max";
  /** Freedom mode: may go back to previous words even when they were correct. */
  freedom: boolean;
  /** normal; expert: fail on submitting a wrong word; master: fail on any wrong keystroke. */
  difficulty: "normal" | "expert" | "master";
  /** Bounded tests end when the last word is done. Time/practice tests are unbounded. */
  bounded: boolean;
}

export const DEFAULT_RULES: EngineRules = {
  strict: false,
  confidence: "off",
  freedom: false,
  difficulty: "normal",
  bounded: true,
};

/** Max extra letters beyond a word's length (keeps layout and payload sane). */
export const MAX_EXTRA = 20;

export interface Sample {
  /** Whole second this sample describes (1-based: second 1 covers 0..1000ms). */
  s: number;
  /** Net WPM so far (cumulative). */
  wpm: number;
  /** Raw WPM within this second only. */
  raw: number;
  /** Wrong keystrokes within this second. */
  err: number;
}

export interface KeyStat {
  hit: number;
  miss: number;
}

export interface ApplyResult {
  /** Whether the event changed anything. */
  changed: boolean;
  /** For input events: the value the input field should now contain. */
  value: string;
  /** A wrong keystroke happened (for sounds / indicators). */
  error: boolean;
}

export interface TestStats {
  wpm: number;
  rawWpm: number;
  accuracy: number;
  consistency: number;
  correctChars: number;
  incorrectChars: number;
  extraChars: number;
  missedChars: number;
  correctKeys: number;
  incorrectKeys: number;
  backspaces: number;
  durationMs: number;
  wordsCompleted: number;
  correctWords: number;
}

const cps = (s: string) => Array.from(s.normalize("NFC"));

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export class TypingEngine {
  readonly rules: EngineRules;
  /** Target words, each as code points. */
  words: string[][];
  /** What has been typed for each word, as code points. */
  typed: string[][];
  /** Whether each word has been submitted with a space. */
  committed: boolean[];
  index = 0;
  correctKeys = 0;
  incorrectKeys = 0;
  backspaces = 0;
  keyStats: Record<string, KeyStat> = {};
  /** Keystrokes (letters + spaces, not backspaces) per second bucket. */
  keysPerSecond: number[] = [];
  errorsPerSecond: number[] = [];
  samples: Sample[] = [];
  lastT = 0;
  started = false;
  finished = false;
  failed = false;
  endT: number | null = null;
  /** Number of events applied, used by UIs to cheaply detect changes. */
  version = 0;

  constructor(words: string[], rules: Partial<EngineRules> = {}) {
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.words = words.map(cps);
    this.typed = words.map(() => []);
    this.committed = words.map(() => false);
  }

  appendWords(words: string[]) {
    for (const w of words) {
      this.words.push(cps(w));
      this.typed.push([]);
      this.committed.push(false);
    }
    this.version++;
  }

  get currentTyped(): string {
    return (this.typed[this.index] ?? []).join("");
  }

  get wordCount(): number {
    return this.words.length;
  }

  /** Apply one event. Events with decreasing time are clamped to keep time monotonic. */
  apply(ev: TypingEvent): ApplyResult {
    const none: ApplyResult = { changed: false, value: this.currentTyped, error: false };
    if (this.finished) return none;
    if (!Number.isFinite(ev.t)) return none;
    const t = Math.max(ev.t, this.lastT, 0);
    this.sampleUntil(t);
    this.lastT = t;
    this.started = true;
    let res: ApplyResult;
    switch (ev.k) {
      case "i":
        res = this.input(typeof ev.v === "string" ? ev.v : "", t);
        break;
      case "c":
        res = this.commit(t);
        break;
      case "b":
        res = this.back();
        break;
      default:
        return none;
    }
    if (res.changed) this.version++;
    return res;
  }

  private bucket(t: number) {
    const b = Math.floor(t / 1000);
    while (this.keysPerSecond.length <= b) {
      this.keysPerSecond.push(0);
      this.errorsPerSecond.push(0);
    }
    return b;
  }

  private countKey(t: number, target: string | undefined, correct: boolean) {
    const b = this.bucket(t);
    this.keysPerSecond[b]++;
    const key = target ?? "extra";
    const stat = (this.keyStats[key] ??= { hit: 0, miss: 0 });
    if (correct) {
      this.correctKeys++;
      stat.hit++;
    } else {
      this.incorrectKeys++;
      this.errorsPerSecond[b]++;
      stat.miss++;
    }
  }

  private input(value: string, t: number): ApplyResult {
    if (value.includes(" ")) {
      // Callers split spaces into commit events; never store spaces inside a word.
      value = value.replace(/ /g, "");
    }
    const target = this.words[this.index];
    if (!target) return { changed: false, value: "", error: false };
    const prev = this.typed[this.index];
    const next = cps(value);
    let p = 0;
    while (p < prev.length && p < next.length && prev[p] === next[p]) p++;
    const removed = prev.length - p;
    if (removed > 0 && this.rules.confidence === "max") {
      return { changed: false, value: prev.join(""), error: false };
    }
    if (removed > 0) this.backspaces += removed;
    const accepted = prev.slice(0, p);
    let error = false;
    for (let i = p; i < next.length; i++) {
      if (accepted.length >= target.length + MAX_EXTRA) break;
      const ch = next[i];
      const want = target[accepted.length];
      const ok = ch === want;
      this.countKey(t, want, ok);
      if (!ok) {
        error = true;
        if (this.rules.difficulty === "master") {
          accepted.push(ch);
          this.typed[this.index] = accepted;
          this.fail(t);
          return { changed: true, value: accepted.join(""), error };
        }
        if (this.rules.strict) break; // rejected: the wrong letter is not entered
      }
      accepted.push(ch);
    }
    const changed = removed > 0 || accepted.length !== prev.length;
    this.typed[this.index] = accepted;
    // Bounded tests finish as soon as the last word is typed correctly.
    if (
      this.rules.bounded &&
      this.index === this.words.length - 1 &&
      accepted.length === target.length &&
      accepted.join("") === target.join("")
    ) {
      this.finishAt(t);
    }
    return { changed: changed || error, value: accepted.join(""), error };
  }

  private commit(t: number): ApplyResult {
    const typed = this.typed[this.index];
    const target = this.words[this.index];
    if (!target || typed.length === 0) return { changed: false, value: this.currentTyped, error: false };
    const correct = typed.join("") === target.join("");
    if (!correct && this.rules.strict) {
      this.countKey(t, " ", false);
      return { changed: true, value: this.currentTyped, error: true };
    }
    this.countKey(t, " ", correct);
    if (!correct && this.rules.difficulty !== "normal") {
      this.committed[this.index] = true;
      this.fail(t);
      return { changed: true, value: "", error: true };
    }
    this.committed[this.index] = true;
    this.index++;
    if (this.rules.bounded && this.index >= this.words.length) {
      this.index = this.words.length - 1;
      this.finishAt(t);
      return { changed: true, value: this.currentTyped, error: !correct };
    }
    return { changed: true, value: this.currentTyped, error: !correct };
  }

  canGoBack(): boolean {
    if (this.index === 0 || this.rules.confidence !== "off") return false;
    if (this.rules.freedom) return true;
    const prev = this.index - 1;
    return this.typed[prev].join("") !== this.words[prev].join("");
  }

  private back(): ApplyResult {
    if (this.typed[this.index].length > 0 || !this.canGoBack()) {
      return { changed: false, value: this.currentTyped, error: false };
    }
    this.index--;
    this.committed[this.index] = false;
    this.backspaces++;
    return { changed: true, value: this.currentTyped, error: false };
  }

  private fail(t: number) {
    this.failed = true;
    this.finishAt(t);
  }

  private finishAt(t: number) {
    if (this.finished) return;
    this.sampleUntil(t);
    this.lastT = t;
    this.endT = t;
    this.finished = true;
    this.pushFinalSample(t);
  }

  /** End the test at time t (timer expiry, manual stop). Safe to call twice. */
  finish(t: number) {
    if (this.finished) return;
    const end = Math.max(t, this.lastT, 0);
    this.finishAt(end);
  }

  /** Record one sample per elapsed whole second up to time t. */
  private sampleUntil(t: number) {
    while ((this.samples.length + 1) * 1000 <= t) {
      const s = this.samples.length + 1;
      this.samples.push(this.makeSample(s, s * 1000, 1000));
    }
  }

  private pushFinalSample(t: number) {
    const done = this.samples.length * 1000;
    const rest = t - done;
    // Only add a partial last second if it is long enough to be meaningful.
    if (rest >= 250 || this.samples.length === 0) {
      this.samples.push(this.makeSample(this.samples.length + 1, t, Math.max(rest, 1)));
    }
  }

  private makeSample(s: number, atMs: number, spanMs: number): Sample {
    const keys = this.keysPerSecond[s - 1] ?? 0;
    const err = this.errorsPerSecond[s - 1] ?? 0;
    return {
      s,
      wpm: round2(wpmFrom(this.countChars().correct, atMs)),
      raw: round2(wpmFrom(keys, spanMs)),
      err,
    };
  }

  /** Character counts on the current state of the text. */
  countChars() {
    let correct = 0;
    let incorrect = 0;
    let extra = 0;
    let missed = 0;
    let raw = 0;
    let correctWords = 0;
    const last = this.index;
    for (let i = 0; i <= last && i < this.words.length; i++) {
      const target = this.words[i];
      const typed = this.typed[i];
      const isCommitted = this.committed[i];
      if (!isCommitted && i === last) {
        // Word in progress: count matching prefix letters; errors so far.
        let prefixOk = true;
        for (let j = 0; j < typed.length; j++) {
          if (j >= target.length) extra++;
          else if (typed[j] !== target[j]) incorrect++;
          if (typed[j] !== target[j]) prefixOk = false;
        }
        raw += typed.length;
        if (prefixOk) correct += typed.length;
        if (prefixOk && typed.length === target.length) correctWords++;
        continue;
      }
      raw += typed.length + 1; // + the space that submitted it
      const ok = typed.join("") === target.join("");
      if (ok) {
        correct += target.length + 1;
        correctWords++;
      } else {
        for (let j = 0; j < Math.max(typed.length, target.length); j++) {
          if (j >= target.length) extra++;
          else if (j >= typed.length) missed++;
          else if (typed[j] !== target[j]) incorrect++;
        }
      }
    }
    return { correct, incorrect, extra, missed, raw, correctWords };
  }

  /** Live or final statistics at time t (defaults to the end time once finished). */
  stats(t?: number): TestStats {
    const at = this.endT ?? Math.max(t ?? this.lastT, 0);
    const c = this.countChars();
    const keys = this.correctKeys + this.incorrectKeys;
    return {
      wpm: round2(wpmFrom(c.correct, at)),
      rawWpm: round2(wpmFrom(c.raw, at)),
      accuracy: keys === 0 ? 0 : round2((this.correctKeys / keys) * 100),
      consistency: round2(consistency(this.samples.map((s) => s.raw))),
      correctChars: c.correct,
      incorrectChars: c.incorrect,
      extraChars: c.extra,
      missedChars: c.missed,
      correctKeys: this.correctKeys,
      incorrectKeys: this.incorrectKeys,
      backspaces: this.backspaces,
      durationMs: Math.round(at),
      wordsCompleted: this.committed.filter(Boolean).length + (this.finished && !this.failed && !this.committed[this.index] ? 1 : 0),
      correctWords: c.correctWords,
    };
  }

  /** Progress through a bounded test, 0..1. */
  progress(): number {
    if (this.finished && !this.failed) return 1;
    const total = this.words.length;
    if (total === 0) return 0;
    const target = this.words[this.index];
    const partial = target.length ? Math.min(this.typed[this.index].length / target.length, 1) : 0;
    return Math.min((this.index + partial) / total, 1);
  }
}

/** WPM where a "word" is five characters (spaces included). Safe for 0 elapsed time. */
export function wpmFrom(chars: number, ms: number): number {
  if (!(ms > 0) || !(chars > 0)) return 0;
  return chars / 5 / (ms / 60000);
}

/**
 * Consistency of per-second raw speed, 0..100.
 * cv = standard deviation / mean of the per-second raw WPM values.
 * consistency = 100 × (1 − tanh(cv + cv³/3 + cv⁵/5)). A perfectly steady typist
 * scores 100; erratic speed tends toward 0. Fewer than two samples → 0 (unknown).
 */
export function consistency(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return 0;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const cv = Math.sqrt(variance) / mean;
  const v = 100 * (1 - Math.tanh(cv + cv ** 3 / 3 + cv ** 5 / 5));
  return Math.max(0, Math.min(100, v));
}

/** Replay a complete event log. Used by the server and by tests. */
export function replay(
  words: string[],
  events: TypingEvent[],
  rules: Partial<EngineRules>,
  endT?: number,
): TypingEngine {
  const engine = new TypingEngine(words, rules);
  for (const ev of events) {
    if (engine.finished) break;
    if (endT !== undefined && ev.t > endT) break;
    engine.apply(ev);
  }
  if (endT !== undefined) engine.finish(endT);
  return engine;
}
