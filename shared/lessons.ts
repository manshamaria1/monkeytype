import { english } from "./languages/english";
import { seededRng, WordGenerator, type Rng } from "./words";

/**
 * Practice lessons (QWERTY, English). Each lesson generates fresh text every attempt.
 * A lesson is passed when an attempt reaches both passAccuracy and passWpm.
 */
export interface Lesson {
  id: string;
  title: string;
  category: "Basics" | "Rows" | "Words" | "Symbols" | "Accuracy";
  description: string;
  /** Finger-placement guidance shown before and during the lesson. */
  tip: string;
  /** Keys this lesson focuses on (highlighted on the on-screen keyboard). */
  keys: string;
  passAccuracy: number;
  passWpm: number;
  wordCount: number;
  generate: (rng: Rng) => string[];
}

/** Extra real words useful for early lessons (only letters from limited rows). */
const EXTRA_WORDS = `a as ask asks add adds all ad dad dads sad lad lads fad fads had has gas glad flask flasks glass lass salad alas shall half hall halls fall falls flag flags slag jag jags lash dash gash hash sash flash slash jak dal gall
we were wet set get jet let red tree free street sweet sweat great quiet quit quite write wrote tire tired tide ride hide side wide pride poet port sport report support pure your our out tour pour dust duet suit fruit equip type typed upper water`.split(/\s+/);

function wordsFrom(keys: string, minLen = 2): string[] {
  const allowed = new Set(keys);
  const all = [...new Set([...english.words, ...EXTRA_WORDS])];
  return all.filter((w) => w.length >= minLen && [...w].every((c) => allowed.has(c)));
}

function drill(keys: string, count: number, rng: Rng): string[] {
  const letters = [...keys].filter((c) => c !== " ");
  const real = wordsFrom(keys);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    if (real.length > 8 && rng() < 0.6) {
      out.push(real[Math.floor(rng() * real.length)]);
    } else {
      const len = 2 + Math.floor(rng() * 4);
      let w = "";
      for (let j = 0; j < len; j++) w += letters[Math.floor(rng() * letters.length)];
      out.push(w);
    }
  }
  return out;
}

const HOME = "asdfghjkl;";

export const LESSONS: Lesson[] = [
  { id: "fj", title: "Find F and J", category: "Basics", keys: "fj", passAccuracy: 90, passWpm: 10, wordCount: 20,
    description: "Your two index fingers rest on F and J. Feel the small bumps on these keys.",
    tip: "Rest your left index finger on F and right index finger on J. Your thumbs hover over the space bar.",
    generate: (r) => drill("fj", 20, r) },
  { id: "home-left", title: "Home row: left hand", category: "Basics", keys: "asdf", passAccuracy: 90, passWpm: 12, wordCount: 25,
    description: "A S D F with the left hand: pinky, ring, middle, index.",
    tip: "Left pinky on A, ring on S, middle on D, index on F. Keep your wrists relaxed and off the desk.",
    generate: (r) => drill("asdf", 25, r) },
  { id: "home-right", title: "Home row: right hand", category: "Basics", keys: "jkl;", passAccuracy: 90, passWpm: 12, wordCount: 25,
    description: "J K L ; with the right hand: index, middle, ring, pinky.",
    tip: "Right index on J, middle on K, ring on L, pinky on the semicolon.",
    generate: (r) => drill("jkl;", 25, r) },
  { id: "home-row", title: "Full home row", category: "Rows", keys: HOME, passAccuracy: 92, passWpm: 15, wordCount: 30,
    description: "All home-row keys including G and H, reached by stretching the index fingers.",
    tip: "Reach G with your left index finger and H with your right index finger, then return to F and J.",
    generate: (r) => drill("asdfghjkl", 30, r) },
  { id: "top-row", title: "Top row", category: "Rows", keys: "qwertyuiop", passAccuracy: 90, passWpm: 15, wordCount: 30,
    description: "Reach up to Q W E R T Y U I O P and come back to the home row.",
    tip: "Each finger moves straight up from its home key. Return to the home row after every key.",
    generate: (r) => drill("qwertyuiopasdfghjkl", 30, r) },
  { id: "bottom-row", title: "Bottom row", category: "Rows", keys: "zxcvbnm", passAccuracy: 90, passWpm: 15, wordCount: 30,
    description: "Reach down to Z X C V B N M.",
    tip: "Curl your fingers down slightly. Left index covers V and B, right index covers N and M.",
    generate: (r) => drill("zxcvbnmasdfghjkl", 30, r) },
  { id: "common-100", title: "100 most common words", category: "Words", keys: "", passAccuracy: 94, passWpm: 25, wordCount: 40,
    description: "The words you will type most often, from the top 100 English words.",
    tip: "Look at the screen, not your hands. Aim for an even rhythm rather than bursts.",
    generate: (r) => new WordGenerator({ language: "english", wordListSize: "small" }, r).take(40) },
  { id: "common-200", title: "200 common words", category: "Words", keys: "", passAccuracy: 94, passWpm: 30, wordCount: 50,
    description: "A wider vocabulary of common English words.",
    tip: "If you make a mistake, finish the word calmly; accuracy builds speed.",
    generate: (r) => new WordGenerator({ language: "english", wordListSize: "medium" }, r).take(50) },
  { id: "numbers", title: "Numbers", category: "Symbols", keys: "1234567890", passAccuracy: 90, passWpm: 15, wordCount: 25,
    description: "The number row, reached from the home row.",
    tip: "1 and 2 use the left pinky and ring finger; 5 and 6 are reached with the index fingers.",
    generate: (r) => drill("1234567890", 25, r) },
  { id: "punctuation", title: "Punctuation", category: "Symbols", keys: ",.?!;:", passAccuracy: 92, passWpm: 20, wordCount: 35,
    description: "Sentences with capitals, commas, full stops and question marks.",
    tip: "Use the opposite hand's pinky for Shift: right Shift for left-hand letters and vice versa.",
    generate: (r) => new WordGenerator({ language: "english", wordListSize: "small", punctuation: true }, r).take(35) },
  { id: "accuracy", title: "Accuracy training", category: "Accuracy", keys: "", passAccuracy: 98, passWpm: 20, wordCount: 40,
    description: "Slow down and aim for 98% accuracy or better. Speed is secondary.",
    tip: "Type at a pace where you almost never make mistakes. Use backspace sparingly.",
    generate: (r) => new WordGenerator({ language: "english", wordListSize: "medium" }, r).take(40) },
];

export function getLesson(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}

/** Words that exercise the given weak keys (letters the user misses most). */
export function weakKeyWords(keys: string[], count: number, rng: Rng = Math.random): string[] {
  const set = keys.map((k) => k.toLowerCase()).filter((k) => k.length === 1);
  if (set.length === 0) return new WordGenerator({ language: "english" }, rng).take(count);
  const candidates = english.words.filter((w) => set.some((k) => w.includes(k)));
  const pool = candidates.length >= 10 ? candidates : [...candidates, ...drill(set.join(""), 20, rng)];
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(pool[Math.floor(rng() * pool.length)]);
  return out;
}

export { seededRng };
