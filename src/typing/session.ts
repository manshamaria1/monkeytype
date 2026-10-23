import { TypingEngine, type EngineRules, type TypingEvent } from "../../shared/engine";
import type { Submission } from "../../shared/results";
import { uuid } from "../lib/format";

export interface SessionOptions {
  words: string[];
  rules: EngineRules;
  /** Timed tests: the test ends exactly at this many ms after the first keystroke. */
  timeLimitMs?: number | null;
  /** Called to get more words when an unbounded test runs low. */
  extend?: () => string[];
}

export interface SessionHooks {
  onKey?: (error: boolean) => void;
  onFinish?: (session: TypingSession) => void;
  onEvent?: (ev: TypingEvent) => void;
}

/**
 * Browser-side wrapper around the engine: owns the clock (performance.now), the
 * event log that the server replays, word extension for timed tests, and change
 * notifications for React (useSyncExternalStore).
 */
export class TypingSession {
  readonly id = uuid();
  readonly engine: TypingEngine;
  readonly events: TypingEvent[] = [];
  startPerf: number | null = null;
  pasted = false;
  private listeners = new Set<() => void>();
  private finishNotified = false;
  private version = 0;

  constructor(
    readonly opts: SessionOptions,
    private hooks: SessionHooks = {},
  ) {
    this.engine = new TypingEngine(opts.words, opts.rules);
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;

  private notify() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /** Tell subscribers the engine changed outside input() (e.g. replayed events). */
  refresh() {
    this.notify();
  }

  get started() {
    return this.startPerf !== null;
  }
  get finished() {
    return this.engine.finished;
  }

  /** Pre-set the start time (multiplayer countdown). Input before it is ignored. */
  setStart(perf: number) {
    this.startPerf = perf;
  }

  elapsed(): number {
    if (this.startPerf === null) return 0;
    return Math.max(0, performance.now() - this.startPerf);
  }

  /** End timed tests whose time is up. Called by an interval and before each input. */
  checkTime(): boolean {
    const limit = this.opts.timeLimitMs;
    if (!limit || this.startPerf === null || this.engine.finished) return false;
    if (performance.now() - this.startPerf >= limit) {
      this.finishAt(limit);
      return true;
    }
    return false;
  }

  private beginIfNeeded(): boolean {
    if (this.startPerf === null) {
      this.startPerf = performance.now();
      this.notify();
    }
    return performance.now() >= this.startPerf;
  }

  private stamp(): number {
    return Math.round(performance.now() - (this.startPerf ?? performance.now()));
  }

  private push(ev: TypingEvent) {
    const r = this.engine.apply(ev);
    this.events.push(ev);
    this.hooks.onEvent?.(ev);
    if (r.changed) this.hooks.onKey?.(r.error);
    return r;
  }

  /**
   * The hidden input now contains `value`. Spaces submit words (a mobile keyboard
   * may insert "word " in one go). Returns the value the input should show.
   */
  input(value: string): string {
    if (this.engine.finished) return this.engine.currentTyped;
    if (!this.beginIfNeeded()) return "";
    if (this.checkTime()) return this.engine.currentTyped;
    const t = this.stamp();
    const parts = value.split(" ");
    for (let i = 0; i < parts.length; i++) {
      if (this.engine.finished) break;
      if (parts[i] !== this.engine.currentTyped) this.push({ t, k: "i", v: parts[i] });
      if (i < parts.length - 1 && !this.engine.finished) this.push({ t, k: "c" });
    }
    this.afterChange();
    return this.engine.currentTyped;
  }

  /** Backspace on an empty word: try to go back to the previous word. */
  back(): string {
    if (this.engine.finished || this.startPerf === null) return this.engine.currentTyped;
    if (this.checkTime()) return this.engine.currentTyped;
    if (!this.engine.canGoBack()) return "";
    this.push({ t: this.stamp(), k: "b" });
    this.afterChange();
    return this.engine.currentTyped;
  }

  private afterChange() {
    const e = this.engine;
    if (!e.rules.bounded && this.opts.extend && e.index > e.wordCount - 40) e.appendWords(this.opts.extend());
    if (e.finished) this.fireFinish();
    this.notify();
  }

  private finishAt(t: number) {
    this.engine.finish(t);
    this.fireFinish();
    this.notify();
  }

  /** Stop now (practice mode, manual end). */
  stop() {
    if (this.engine.finished || this.startPerf === null) return;
    this.finishAt(this.stamp());
  }

  private fireFinish() {
    if (this.finishNotified) return;
    this.finishNotified = true;
    this.hooks.onFinish?.(this);
  }

  toSubmission(meta: Omit<Submission, "clientId" | "words" | "events" | "durationMs" | "claimed" | "pasted" | "finishedAt">): Submission {
    const e = this.engine;
    const stats = e.stats();
    const words = e.rules.bounded
      ? e.words.map((w) => w.join(""))
      : e.words.slice(0, Math.min(e.index + 1, e.wordCount)).map((w) => w.join(""));
    return {
      ...meta,
      clientId: this.id,
      words,
      events: this.events,
      durationMs: Math.max(1, Math.round(e.endT ?? stats.durationMs)),
      claimed: { wpm: stats.wpm, rawWpm: stats.rawWpm, accuracy: stats.accuracy },
      pasted: this.pasted,
      finishedAt: Date.now(),
    };
  }
}
