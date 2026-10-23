import { hashString, seededRng, WordGenerator } from "./words";

export interface DailyChallenge {
  date: string;
  title: string;
  description: string;
  words: string[];
  targetAccuracy: number;
}

const VARIANTS = [
  { title: "Common words sprint", description: "30 common words. Finish with at least 95% accuracy.", punctuation: false, numbers: false, size: "small" as const, count: 30, acc: 95 },
  { title: "Full sentences", description: "40 words with punctuation and capitals.", punctuation: true, numbers: false, size: "medium" as const, count: 40, acc: 92 },
  { title: "Numbers mix", description: "35 words mixed with numbers.", punctuation: false, numbers: true, size: "medium" as const, count: 35, acc: 92 },
  { title: "Big vocabulary", description: "40 words from the full word list.", punctuation: false, numbers: false, size: "full" as const, count: 40, acc: 94 },
];

export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Deterministic: every player gets the same text for a given UTC date. */
export function dailyChallenge(date: string): DailyChallenge {
  const seed = hashString("challenge:" + date);
  const variant = VARIANTS[seed % VARIANTS.length];
  const gen = new WordGenerator(
    { language: "english", wordListSize: variant.size, punctuation: variant.punctuation, numbers: variant.numbers },
    seededRng(seed),
  );
  return { date, title: variant.title, description: variant.description, words: gen.take(variant.count), targetAccuracy: variant.acc };
}
