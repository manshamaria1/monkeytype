import { describe, expect, it } from "vitest";
import { compareEntries, looksAutomated, periodStart, rankEntries, verifySubmission } from "../../shared/results";
import { WordGenerator, seededRng } from "../../shared/words";
import { dailyChallenge } from "../../shared/challenge";
import { makeSubmission, perfectWordsTest, typeText } from "../helpers/simulate";

const words = new WordGenerator({ language: "english" }, seededRng(7)).take(10);

describe("verifySubmission", () => {
  it("accepts an honest words test and recomputes the same numbers", () => {
    const sub = perfectWordsTest(words);
    const out = verifySubmission(sub);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.stats.wpm).toBeCloseTo(sub.claimed.wpm, 5);
      expect(out.result.stats.accuracy).toBe(100);
      expect(out.result.eligible).toBe(true);
    }
  });

  it("rejects tampered speed", () => {
    const sub = perfectWordsTest(words);
    sub.claimed.wpm += 30;
    expect(verifySubmission(sub)).toEqual({ ok: false, error: "Result does not match the keystroke log" });
  });

  it("rejects words that are not in the word list", () => {
    const fake = [...words.slice(0, 9), "zzzzqqq"];
    const sub = perfectWordsTest(fake);
    expect(verifySubmission(sub).ok).toBe(false);
  });

  it("rejects a words test whose count does not match mode2", () => {
    const sub = perfectWordsTest(words);
    sub.mode2 = "25";
    expect(verifySubmission(sub).ok).toBe(false);
  });

  it("rejects unfinished bounded tests", () => {
    const sub = makeSubmission({ words }, typeText(words.slice(0, 3).join(" ") + " "));
    sub.durationMs = 5000;
    expect(verifySubmission(sub).ok).toBe(false);
  });

  it("rejects events after the end and out-of-order events", () => {
    const sub = perfectWordsTest(words);
    sub.events = [...sub.events].reverse();
    expect(verifySubmission(sub).ok).toBe(false);
  });

  it("validates timed tests: exact duration, words reached only", () => {
    const gen = new WordGenerator({ language: "english" }, seededRng(3)).take(40);
    // The browser stops recording when time is up, so only events inside 15 s exist.
    const events = typeText(gen.join(" "), { minGap: 90, maxGap: 140 }).filter((e) => e.t <= 15000);
    const sub = makeSubmission({ words: gen, mode: "time", mode2: "15" }, events, 15000);
    const out = verifySubmission(sub);
    expect(out.ok).toBe(true);
    const bad = makeSubmission({ words: gen, mode: "time", mode2: "15" }, events, 12000);
    expect(verifySubmission(bad).ok).toBe(false);
    const late = makeSubmission({ words: gen, mode: "time", mode2: "15" }, [...events, { t: 15600, k: "c" }], 15000);
    expect(verifySubmission(late)).toEqual({ ok: false, error: "Keystroke after the end of the test" });
  });

  it("marks low accuracy, punctuation, paste and custom as not eligible", () => {
    const sloppy = makeSubmission({ words: words.slice(0, 2) }, typeText(`xx\b\b${words[0]} zz\b\b${words[1]}`));
    sloppy.mode2 = "2";
    const r1 = verifySubmission(sloppy);
    expect(r1.ok && r1.result.eligible).toBe(false);
    const pasted = perfectWordsTest(words);
    pasted.pasted = true;
    const r2 = verifySubmission(pasted);
    expect(r2.ok && r2.result.ineligibleReasons).toContain("Text was pasted");
    const custom = makeSubmission({ words: ["hello", "there"], mode: "custom", mode2: "custom" }, typeText("hello there"));
    const r3 = verifySubmission(custom);
    expect(r3.ok).toBe(true);
    expect(r3.ok && r3.result.eligible).toBe(false);
  });

  it("checks quote text and daily challenge text", () => {
    const q = makeSubmission({ words: ["Call", "me", "Ishmael."], mode: "quote", mode2: "en-3" }, typeText("Call me Ishmael."));
    expect(verifySubmission(q).ok).toBe(true);
    const wrongQuote = makeSubmission({ words: ["Call", "me", "Bob."], mode: "quote", mode2: "en-3" }, typeText("Call me Bob."));
    expect(verifySubmission(wrongQuote).ok).toBe(false);
    const ch = dailyChallenge("2026-01-01");
    const c = makeSubmission({ words: ch.words, mode: "challenge", mode2: "2026-01-01" }, typeText(ch.words.join(" ")));
    expect(verifySubmission(c).ok).toBe(true);
  });

  it("flags perfectly regular (scripted) keystroke timing", () => {
    const robotic = makeSubmission({ words }, typeText(words.join(" "), { minGap: 50, maxGap: 50 }));
    const out = verifySubmission(robotic);
    expect(out.ok && out.result.ineligibleReasons).toContain("Keystroke timing looks automated");
    expect(looksAutomated(typeText("a b c d e f g h i j k l m n o p q r s t", { minGap: 60, maxGap: 200 }))).toBe(false);
  });
});

describe("ranking", () => {
  it("orders by wpm, then accuracy, then earlier time", () => {
    const a = { userId: 1, wpm: 100, accuracy: 95, createdAt: 2 };
    const b = { userId: 2, wpm: 100, accuracy: 97, createdAt: 3 };
    const c = { userId: 3, wpm: 100, accuracy: 97, createdAt: 1 };
    const d = { userId: 4, wpm: 120, accuracy: 80, createdAt: 9 };
    expect([a, b, c, d].sort(compareEntries).map((e) => e.userId)).toEqual([4, 3, 2, 1]);
  });
  it("keeps only each user's best result", () => {
    const ranked = rankEntries([
      { userId: 1, wpm: 80, accuracy: 99, createdAt: 1 },
      { userId: 1, wpm: 90, accuracy: 90, createdAt: 2 },
      { userId: 2, wpm: 85, accuracy: 99, createdAt: 3 },
    ]);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]).toMatchObject({ userId: 1, wpm: 90, rank: 1 });
    expect(ranked[1]).toMatchObject({ userId: 2, rank: 2 });
  });
});

describe("periods", () => {
  const now = new Date("2026-10-23T15:30:00Z"); // a Friday
  it("computes UTC period starts", () => {
    expect(periodStart("daily", now)?.toISOString()).toBe("2026-10-23T00:00:00.000Z");
    expect(periodStart("weekly", now)?.toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(periodStart("monthly", now)?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(periodStart("alltime", now)).toBeNull();
  });
  it("weeks start on Monday even on Sunday", () => {
    expect(periodStart("weekly", new Date("2026-10-25T23:00:00Z"))?.toISOString()).toBe("2026-10-19T00:00:00.000Z");
  });
});
