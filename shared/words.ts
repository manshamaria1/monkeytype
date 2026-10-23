import { getLanguage, LANGUAGES, type LanguageData, type Quote } from "./languages";

export type Rng = () => number;

/** Small fast seeded PRNG (mulberry32). Deterministic for daily challenges and tests. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const WORD_LIST_SIZES = { small: 100, medium: 200, full: Infinity } as const;
export type WordListSize = keyof typeof WORD_LIST_SIZES;

export interface GenerateOptions {
  language: string;
  wordListSize?: WordListSize;
  punctuation?: boolean;
  numbers?: boolean;
}

/**
 * Stateful word generator. Avoids repeating a word within the last few words so short
 * lists do not produce "the the the". Punctuation follows simple sentence rules:
 * the first word of each sentence is capitalised (for scripts with case) and the
 * sentence ends with a period / question / exclamation mark.
 */
export class WordGenerator {
  private lang: LanguageData;
  private pool: string[];
  private recent: string[] = [];
  private sentenceStart = true;
  private sinceSentence = 0;
  private sentenceLength = 0;

  constructor(
    private opts: GenerateOptions,
    private rng: Rng = Math.random,
  ) {
    this.lang = getLanguage(opts.language);
    const size = WORD_LIST_SIZES[opts.wordListSize ?? "medium"];
    this.pool = this.lang.words.slice(0, Math.min(size, this.lang.words.length));
    this.newSentenceLength();
  }

  private newSentenceLength() {
    this.sentenceLength = 4 + Math.floor(this.rng() * 9);
    this.sinceSentence = 0;
  }

  private pick(): string {
    const avoid = Math.min(5, Math.max(0, this.pool.length - 1));
    for (let tries = 0; tries < 20; tries++) {
      const w = this.pool[Math.floor(this.rng() * this.pool.length)];
      if (!this.recent.includes(w) || tries === 19) {
        this.recent.push(w);
        if (this.recent.length > avoid) this.recent.shift();
        return w;
      }
    }
    return this.pool[0];
  }

  private number(): string {
    const digits = 1 + Math.floor(this.rng() * 4);
    let s = String(1 + Math.floor(this.rng() * 9));
    for (let i = 1; i < digits; i++) s += String(Math.floor(this.rng() * 10));
    return s;
  }

  next(): string {
    let word = this.opts.numbers && this.rng() < 0.12 ? this.number() : this.pick();
    if (!this.opts.punctuation) return word;
    const p = this.lang.punctuation;
    if (this.sentenceStart && this.lang.hasCase) {
      word = word.charAt(0).toLocaleUpperCase(this.lang.id === "english" ? "en" : undefined) + word.slice(1);
    }
    this.sinceSentence++;
    const endSentence = this.sinceSentence >= this.sentenceLength;
    let ender = "";
    if (endSentence) {
      const r = this.rng();
      ender = r < 0.75 ? p.period : r < 0.9 ? p.question : p.exclamation;
      this.newSentenceLength();
      this.sentenceStart = true;
      return word + ender;
    }
    const wasStart = this.sentenceStart;
    this.sentenceStart = false;
    const r = this.rng();
    if (r < 0.12) return word + p.comma;
    if (r < 0.15 && p.extra.length) return word + p.extra[Math.floor(this.rng() * p.extra.length)];
    if (r < 0.18 && !wasStart) return p.quotes[0] + word + p.quotes[1];
    return word;
  }

  take(n: number): string[] {
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(this.next());
    return out;
  }
}

export function quoteLengthGroup(q: Quote): "short" | "medium" | "long" {
  const n = q.text.length;
  return n < 100 ? "short" : n < 250 ? "medium" : "long";
}

export function pickQuote(language: string, length: "any" | "short" | "medium" | "long", rng: Rng = Math.random, excludeId?: string): Quote {
  const lang = getLanguage(language);
  let options = lang.quotes.filter((q) => length === "any" || quoteLengthGroup(q) === length);
  if (options.length === 0) options = lang.quotes;
  if (options.length > 1 && excludeId) options = options.filter((q) => q.id !== excludeId);
  return options[Math.floor(rng() * options.length)];
}

/** Split free text into words, collapsing whitespace. */
export function splitText(text: string): string[] {
  return text.normalize("NFC").split(/\s+/).filter(Boolean);
}

const PUNCT_EDGE = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

/**
 * Server-side check that a generated word could have come from the generator for
 * this language: either a number or a list word, with optional punctuation around it
 * and optional capitalisation.
 */
export function isValidGeneratedWord(word: string, language: string, opts: { punctuation: boolean; numbers: boolean }): boolean {
  const lang = getLanguage(language);
  let core = word.normalize("NFC");
  if (opts.punctuation) core = core.replace(PUNCT_EDGE, "");
  else if (/[\p{P}]/u.test(core) && !lang.words.includes(core)) return false;
  if (opts.numbers && /^[0-9]{1,4}$/.test(core)) return true;
  if (lang.words.includes(core)) return true;
  if (opts.punctuation && lang.hasCase) {
    const lower = core.charAt(0).toLocaleLowerCase() + core.slice(1);
    return lang.words.includes(lower);
  }
  return false;
}

export function allLanguageIds(): string[] {
  return LANGUAGES.map((l) => l.id);
}
