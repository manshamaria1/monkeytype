import { describe, expect, it } from "vitest";
import { consistency, replay, TypingEngine, wpmFrom, type TypingEvent } from "../../shared/engine";

/** Simulate a keyboard: letters extend the current input, space submits, \b deletes. */
function keys(text: string, startT = 0, step = 100): TypingEvent[] {
  const events: TypingEvent[] = [];
  let current = "";
  let t = startT;
  for (const ch of Array.from(text)) {
    if (ch === " ") {
      events.push({ t, k: "c" });
      current = "";
    } else if (ch === "\b") {
      if (current.length === 0) events.push({ t, k: "b" });
      else {
        current = Array.from(current).slice(0, -1).join("");
        events.push({ t, k: "i", v: current });
      }
    } else {
      current += ch;
      events.push({ t, k: "i", v: current });
    }
    t += step;
  }
  return events;
}

/** Like keys(), but tracks the engine-reported input value (needed after going back a word). */
function typeInto(engine: TypingEngine, text: string, startT = 0, step = 100) {
  let t = startT;
  for (const ch of Array.from(text)) {
    const cur = engine.currentTyped;
    if (ch === " ") engine.apply({ t, k: "c" });
    else if (ch === "\b") {
      if (cur.length === 0) engine.apply({ t, k: "b" });
      else engine.apply({ t, k: "i", v: Array.from(cur).slice(0, -1).join("") });
    } else engine.apply({ t, k: "i", v: cur + ch });
    t += step;
  }
  return t;
}

describe("wpm formula", () => {
  it("is characters / 5 / minutes", () => {
    expect(wpmFrom(50, 60000)).toBe(10);
    expect(wpmFrom(250, 30000)).toBe(100);
  });
  it("never divides by zero or goes negative", () => {
    expect(wpmFrom(10, 0)).toBe(0);
    expect(wpmFrom(10, -5)).toBe(0);
    expect(wpmFrom(0, 1000)).toBe(0);
    expect(wpmFrom(NaN, 1000)).toBe(0);
  });
});

describe("TypingEngine basics", () => {
  it("counts a perfect words test", () => {
    const e = replay(["hello", "world"], keys("hello world"), { bounded: true });
    expect(e.finished).toBe(true);
    const s = e.stats();
    // "hello " (6) + "world" (5) = 11 correct chars; 10 keystroke gaps of 100ms -> 1000 ms
    expect(s.correctChars).toBe(11);
    expect(s.durationMs).toBe(1000);
    expect(s.wpm).toBeCloseTo(wpmFrom(11, 1000), 2);
    expect(s.accuracy).toBe(100);
    expect(s.correctKeys).toBe(11);
    expect(s.incorrectKeys).toBe(0);
  });

  it("finishes a bounded test only when the last word is correct, or on space", () => {
    const e = new TypingEngine(["ab", "cd"], { bounded: true });
    typeInto(e, "ab cx");
    expect(e.finished).toBe(false);
    e.apply({ t: 9999, k: "c" });
    expect(e.finished).toBe(true);
    expect(e.stats().incorrectChars).toBe(1);
  });

  it("marks wrong, extra and missed characters", () => {
    const e = replay(["cat", "dog", "end"], keys("cxt dogs end"), { bounded: true });
    const s = e.stats();
    expect(e.finished).toBe(true);
    expect(s.incorrectChars).toBe(1); // x
    expect(s.extraChars).toBe(1); // s
    expect(s.correctChars).toBe(3); // only "end" is correct
    expect(s.incorrectKeys).toBe(4); // x, s, and the two spaces after wrong words
  });

  it("counts missed letters when a word is skipped early", () => {
    const e = replay(["house", "ok"], keys("ho ok"), { bounded: true });
    const s = e.stats();
    expect(s.missedChars).toBe(3);
    expect(s.correctChars).toBe(2); // "ok" (last word, no trailing space)
  });

  it("raw wpm counts all typed characters including errors", () => {
    const e = replay(["aaaa", "bbbb"], keys("axaa bbbb"), { bounded: true });
    const s = e.stats();
    expect(s.rawWpm).toBeGreaterThan(s.wpm);
    expect(s.rawWpm).toBeCloseTo(wpmFrom(9, 800), 2);
  });

  it("ignores space on an empty word", () => {
    const e = new TypingEngine(["a", "b"]);
    const r = e.apply({ t: 0, k: "c" });
    expect(r.changed).toBe(false);
    expect(e.index).toBe(0);
    expect(e.correctKeys + e.incorrectKeys).toBe(0);
  });
});

describe("backspace", () => {
  it("corrects letters, counts backspaces, keeps errors in accuracy", () => {
    const e = replay(["abc"], keys("abx\bc"), { bounded: true });
    expect(e.finished).toBe(true);
    const s = e.stats();
    expect(s.backspaces).toBe(1);
    expect(s.correctChars).toBe(3);
    expect(s.incorrectChars).toBe(0);
    // 4 correct keystrokes (a, b, c + ... ) a b c correct, x wrong -> 3/4
    expect(s.accuracy).toBe(75);
  });

  it("goes back to a previous incorrect word", () => {
    const e = new TypingEngine(["one", "two", "six"]);
    typeInto(e, "onx ");
    expect(e.index).toBe(1);
    typeInto(e, "\b\be ", 1000);
    expect(e.index).toBe(1);
    expect(e.typed[0].join("")).toBe("one");
  });

  it("cannot go back to a correct word unless freedom mode is on", () => {
    const e = new TypingEngine(["one", "two"]);
    typeInto(e, "one \b");
    expect(e.index).toBe(1);
    const f = new TypingEngine(["one", "two"], { freedom: true });
    typeInto(f, "one \b");
    expect(f.index).toBe(0);
  });

  it("confidence 'on' blocks going back, 'max' blocks all backspace", () => {
    const on = new TypingEngine(["one", "two"], { confidence: "on" });
    typeInto(on, "onx \b");
    expect(on.index).toBe(1);
    typeInto(on, "tx\b", 2000);
    expect(on.currentTyped).toBe("t");
    const max = new TypingEngine(["one"], { confidence: "max" });
    typeInto(max, "ox\b");
    expect(max.currentTyped).toBe("ox");
    expect(max.backspaces).toBe(0);
  });

  it("handles deleting a whole word at once (ctrl+backspace / autocorrect)", () => {
    const e = new TypingEngine(["hello"]);
    typeInto(e, "helx");
    e.apply({ t: 1000, k: "i", v: "" });
    expect(e.backspaces).toBe(4);
    e.apply({ t: 1100, k: "i", v: "hello" });
    expect(e.finished).toBe(true);
  });

  it("handles repeated characters without corrupting state", () => {
    const e = replay(["aaa", "aa"], keys("aaaa\b aa"), { bounded: true });
    expect(e.finished).toBe(true);
    expect(e.stats().correctChars).toBe(6);
  });
});

describe("strict mode and difficulty", () => {
  it("strict mode rejects wrong letters and wrong word submissions", () => {
    const e = new TypingEngine(["abc", "d"], { strict: true });
    typeInto(e, "abx");
    expect(e.currentTyped).toBe("ab");
    expect(e.incorrectKeys).toBe(1);
    e.apply({ t: 500, k: "c" });
    expect(e.index).toBe(0);
    typeInto(e, "c d", 600);
    expect(e.finished).toBe(true);
  });

  it("master fails on the first wrong key", () => {
    const e = new TypingEngine(["abc", "def"], { difficulty: "master" });
    typeInto(e, "abd");
    expect(e.failed).toBe(true);
    expect(e.finished).toBe(true);
  });

  it("expert fails when submitting a wrong word but allows corrections", () => {
    const e = new TypingEngine(["abc", "def"], { difficulty: "expert" });
    typeInto(e, "abd\bc ");
    expect(e.failed).toBe(false);
    typeInto(e, "dex ", 2000);
    expect(e.failed).toBe(true);
  });
});

describe("timing", () => {
  it("time tests end exactly at the given time and ignore later events", () => {
    const words = Array.from({ length: 50 }, () => "word");
    const events = keys(Array(50).fill("word").join(" "), 0, 120);
    const e = replay(words, events, { bounded: false }, 15000);
    expect(e.finished).toBe(true);
    expect(e.stats().durationMs).toBe(15000);
    // 15000 / 120 = 125 keystrokes fit (t = 0 .. 14880)
    expect(e.correctKeys).toBe(126);
  });

  it("finish() is idempotent (no duplicate completion)", () => {
    const e = new TypingEngine(["abc"], { bounded: false });
    typeInto(e, "ab");
    e.finish(1000);
    const first = e.stats();
    e.finish(5000);
    expect(e.stats()).toEqual(first);
    expect(e.apply({ t: 6000, k: "i", v: "abc" }).changed).toBe(false);
  });

  it("clamps out-of-order timestamps", () => {
    const e = new TypingEngine(["abc"]);
    e.apply({ t: 1000, k: "i", v: "a" });
    e.apply({ t: 500, k: "i", v: "ab" });
    expect(e.lastT).toBe(1000);
  });

  it("produces one sample per second and a speed timeline", () => {
    const words = Array.from({ length: 100 }, () => "go");
    const e = replay(words, keys(Array(100).fill("go").join(" "), 0, 200), { bounded: false }, 10000);
    expect(e.samples).toHaveLength(10);
    expect(e.samples[9].s).toBe(10);
    // steady typing -> 5 keys per second -> raw 60 wpm each second
    expect(e.samples[3].raw).toBe(60);
    expect(e.stats().consistency).toBeGreaterThan(95);
  });

  it("returns zeros before any input", () => {
    const e = new TypingEngine(["abc"]);
    const s = e.stats();
    expect(s.wpm).toBe(0);
    expect(s.rawWpm).toBe(0);
    expect(s.accuracy).toBe(0);
    expect(Number.isNaN(s.consistency)).toBe(false);
  });
});

describe("consistency", () => {
  it("is 100 for perfectly steady speed and lower for erratic speed", () => {
    expect(consistency([60, 60, 60])).toBe(100);
    expect(consistency([10, 120, 10, 120])).toBeLessThan(50);
    expect(consistency([60])).toBe(0);
    expect(consistency([0, 0])).toBe(0);
  });
});

describe("unicode", () => {
  it("compares by code point (combining marks, Devanagari)", () => {
    const e = replay(["नमस्ते", "दुनिया"], keys("नमस्ते दुनिया"), { bounded: true });
    expect(e.finished).toBe(true);
    expect(e.stats().accuracy).toBe(100);
  });
  it("handles RTL Arabic text", () => {
    const e = replay(["مرحبا", "بك"], keys("مرحبا بك"), { bounded: true });
    expect(e.finished).toBe(true);
    expect(e.stats().incorrectChars).toBe(0);
  });
  it("normalises decomposed input to NFC", () => {
    const e = new TypingEngine(["café"]);
    e.apply({ t: 0, k: "i", v: "café" });
    expect(e.finished).toBe(true);
  });
  it("handles emoji / astral characters as single code points", () => {
    const e = replay(["a😀b"], keys("a😀b"), { bounded: true });
    expect(e.finished).toBe(true);
    expect(e.stats().correctChars).toBe(3);
  });
});

describe("restart", () => {
  it("a new engine has no state from the previous one", () => {
    const a = new TypingEngine(["abc"]);
    typeInto(a, "ax");
    const b = new TypingEngine(["abc"]);
    expect(b.stats().incorrectKeys).toBe(0);
    expect(b.started).toBe(false);
    expect(b.index).toBe(0);
  });
});
