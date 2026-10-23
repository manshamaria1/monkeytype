import type { Config } from "../../shared/config";
import type { EngineRules } from "../../shared/engine";
import { getLanguage, type Quote } from "../../shared/languages";
import type { ResultMode } from "../../shared/config";
import { pickQuote, splitText, WordGenerator } from "../../shared/words";

export interface TestSetup {
  words: string[];
  rules: EngineRules;
  timeLimitMs: number | null;
  extend?: () => string[];
  mode: ResultMode;
  mode2: string;
  language: string;
  dir: "ltr" | "rtl";
  quote?: Quote;
}

export function rulesFromConfig(config: Config, bounded: boolean): EngineRules {
  return {
    strict: config.strictMode,
    confidence: config.confidenceMode,
    freedom: config.freedomMode,
    difficulty: config.difficulty,
    bounded,
  };
}

/** Build the text and rules for the main typing test from the current settings. */
export function buildSetup(config: Config, repeat?: { words: string[]; quote?: Quote } | null, lastQuoteId?: string): TestSetup {
  const lang = getLanguage(config.language);
  const gen = new WordGenerator({
    language: lang.id,
    wordListSize: config.wordListSize,
    punctuation: config.punctuation,
    numbers: config.numbers,
  });
  const base = { language: lang.id, dir: lang.dir };
  switch (config.mode) {
    case "time":
      return {
        ...base,
        words: repeat?.words ?? gen.take(100),
        extend: () => gen.take(50),
        rules: rulesFromConfig(config, false),
        timeLimitMs: config.time * 1000,
        mode: "time",
        mode2: String(config.time),
      };
    case "words":
      return { ...base, words: repeat?.words ?? gen.take(config.words), rules: rulesFromConfig(config, true), timeLimitMs: null, mode: "words", mode2: String(config.words) };
    case "quote": {
      const quote = repeat?.quote ?? pickQuote(lang.id, config.quoteLength, Math.random, lastQuoteId);
      return { ...base, words: splitText(quote.text), quote, rules: rulesFromConfig(config, true), timeLimitMs: null, mode: "quote", mode2: quote.id };
    }
    case "custom": {
      const words = splitText(config.customText);
      return {
        ...base,
        dir: /[֐-ࣿ]/.test(config.customText) ? "rtl" : "ltr",
        words: words.length ? words : ["type", "something", "in", "custom", "text"],
        rules: rulesFromConfig(config, true),
        timeLimitMs: null,
        mode: "custom",
        mode2: "custom",
      };
    }
    case "practice":
      return {
        ...base,
        words: repeat?.words ?? gen.take(100),
        extend: () => gen.take(50),
        rules: rulesFromConfig(config, false),
        timeLimitMs: null,
        mode: "practice",
        mode2: "practice",
      };
  }
}

/** Settings that change the test itself (changing them starts a new test). */
export function testKey(c: Config): string {
  return JSON.stringify([c.mode, c.time, c.words, c.quoteLength, c.customText, c.language, c.wordListSize, c.difficulty, c.punctuation, c.numbers, c.strictMode, c.confidenceMode, c.freedomMode]);
}
