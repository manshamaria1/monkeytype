import { describe, expect, it } from "vitest";
import { LANGUAGES, getLanguage } from "../../shared/languages";
import { isValidGeneratedWord, seededRng, splitText, WordGenerator, pickQuote } from "../../shared/words";
import { replay } from "../../shared/engine";
import { LESSONS } from "../../shared/lessons";
import { dailyChallenge } from "../../shared/challenge";
import { typeText } from "../helpers/simulate";

describe.each(LANGUAGES.map((l) => [l.id, l] as const))("language %s", (_id, lang) => {
  it("has a usable, normalised word list", () => {
    expect(lang.words.length).toBeGreaterThanOrEqual(150);
    for (const w of lang.words) {
      expect(w).toBe(w.normalize("NFC"));
      expect(w).not.toMatch(/\s/);
    }
    expect(new Set(lang.words).size).toBe(lang.words.length);
  });

  it("generates words that pass server validation, with and without punctuation/numbers", () => {
    for (const opts of [
      { punctuation: false, numbers: false },
      { punctuation: true, numbers: true },
    ]) {
      const words = new WordGenerator({ language: lang.id, wordListSize: "full", ...opts }, seededRng(11)).take(300);
      for (const w of words) expect(isValidGeneratedWord(w, lang.id, opts), `${w}`).toBe(true);
    }
  });

  it("avoids immediate repeats", () => {
    const words = new WordGenerator({ language: lang.id, wordListSize: "small" }, seededRng(5)).take(200);
    for (let i = 1; i < words.length; i++) expect(words[i]).not.toBe(words[i - 1]);
  });

  it("can be typed perfectly through the engine (generated words and every quote)", () => {
    const words = new WordGenerator({ language: lang.id, punctuation: true }, seededRng(9)).take(30);
    const e = replay(words, typeText(words.join(" ")), { bounded: true });
    expect(e.finished).toBe(true);
    expect(e.stats().accuracy).toBe(100);
    for (const q of lang.quotes) {
      const qw = splitText(q.text);
      const qe = replay(qw, typeText(qw.join(" ")), { bounded: true });
      expect(qe.finished, q.id).toBe(true);
      expect(qe.stats().incorrectChars).toBe(0);
    }
  });

  it("uses the right text direction and punctuation", () => {
    expect(lang.dir).toBe(["urdu", "arabic"].includes(lang.id) ? "rtl" : "ltr");
    if (lang.id === "urdu") expect(lang.punctuation.question).toBe("؟");
    if (lang.id === "hindi") expect(lang.punctuation.period).toBe("।");
  });
});

describe("quotes and lessons", () => {
  it("picks quotes by length and avoids repeating the last one", () => {
    const q1 = pickQuote("english", "any", seededRng(1));
    const q2 = pickQuote("english", "any", seededRng(1), q1.id);
    expect(q2.id).not.toBe(q1.id);
    expect(pickQuote("english", "long").text.length).toBeGreaterThanOrEqual(250);
  });
  it("every lesson generates non-empty typeable text", () => {
    for (const l of LESSONS) {
      const words = l.generate(seededRng(2));
      expect(words.length, l.id).toBe(l.wordCount);
      for (const w of words) expect(w.length).toBeGreaterThan(0);
    }
  });
  it("daily challenge is deterministic per date", () => {
    expect(dailyChallenge("2026-10-23").words).toEqual(dailyChallenge("2026-10-23").words);
    expect(dailyChallenge("2026-10-23").words).not.toEqual(dailyChallenge("2026-10-24").words);
  });
  it("unknown language falls back to English", () => {
    expect(getLanguage("klingon").id).toBe("english");
  });
});
