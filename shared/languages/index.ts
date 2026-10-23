import type { LanguageData, Quote } from "./types";
import { english } from "./english";
import { spanish } from "./spanish";
import { french } from "./french";
import { german } from "./german";
import { portuguese } from "./portuguese";
import { hindi } from "./hindi";
import { urdu } from "./urdu";
import { punjabi } from "./punjabi";
import { arabic } from "./arabic";

export type { LanguageData, Quote };

/**
 * To add a language: create a file exporting LanguageData, add it here, and add a
 * case to tests/unit/languages.test.ts. Words and quotes are NFC-normalised below
 * so typed input (also normalised) compares reliably.
 */
const RAW: LanguageData[] = [english, spanish, french, german, portuguese, hindi, urdu, punjabi, arabic];

function normalise(lang: LanguageData): LanguageData {
  const words = [...new Set(lang.words.map((w) => w.normalize("NFC").trim()).filter(Boolean))];
  return {
    ...lang,
    words,
    quotes: lang.quotes.map((q) => ({ ...q, text: q.text.normalize("NFC").replace(/\s+/g, " ").trim() })),
  };
}

export const LANGUAGES: LanguageData[] = RAW.map(normalise);
const BY_ID = new Map(LANGUAGES.map((l) => [l.id, l]));

export function getLanguage(id: string): LanguageData {
  return BY_ID.get(id) ?? LANGUAGES[0];
}

export function isLanguage(id: string): boolean {
  return BY_ID.has(id);
}

export function findQuote(id: string): { quote: Quote; language: LanguageData } | null {
  for (const language of LANGUAGES) {
    const quote = language.quotes.find((q) => q.id === id);
    if (quote) return { quote, language };
  }
  return null;
}
