/** Achievement definitions. Unlocks are evaluated on the server from stored activity. */
export interface AchievementContext {
  tests: number;
  bestWpm: number;
  /** Has a completed test of >= 25 words or >= 30 s with 100% accuracy. */
  perfectTest: boolean;
  /** Best accuracy on a test of >= 25 words or >= 30 s. */
  bestQualifiedAccuracy: number;
  totalWords: number;
  /** Longest run of consecutive UTC days with at least one completed test. */
  longestStreak: number;
  lessonsCompleted: number;
  matchWins: number;
  challengesCompleted: number;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  check: (c: AchievementContext) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first-test", title: "First steps", description: "Complete your first test.", icon: "🐒", check: (c) => c.tests >= 1 },
  { id: "tests-10", title: "Warming up", description: "Complete 10 tests.", icon: "🔥", check: (c) => c.tests >= 10 },
  { id: "tests-100", title: "Dedicated", description: "Complete 100 tests.", icon: "🏅", check: (c) => c.tests >= 100 },
  { id: "wpm-40", title: "Steady", description: "Reach 40 WPM.", icon: "🚶", check: (c) => c.bestWpm >= 40 },
  { id: "wpm-60", title: "Quick", description: "Reach 60 WPM.", icon: "🏃", check: (c) => c.bestWpm >= 60 },
  { id: "wpm-80", title: "Fast", description: "Reach 80 WPM.", icon: "🚴", check: (c) => c.bestWpm >= 80 },
  { id: "wpm-100", title: "Blazing", description: "Reach 100 WPM.", icon: "🚀", check: (c) => c.bestWpm >= 100 },
  { id: "wpm-130", title: "Lightning", description: "Reach 130 WPM.", icon: "⚡", check: (c) => c.bestWpm >= 130 },
  { id: "acc-98", title: "Careful", description: "Finish a 25+ word or 30+ second test with 98% accuracy.", icon: "🎯", check: (c) => c.bestQualifiedAccuracy >= 98 },
  { id: "acc-100", title: "Flawless", description: "Finish a 25+ word or 30+ second test with 100% accuracy.", icon: "💎", check: (c) => c.perfectTest },
  { id: "streak-3", title: "Habit", description: "Practise 3 days in a row.", icon: "📅", check: (c) => c.longestStreak >= 3 },
  { id: "streak-7", title: "Weekly rhythm", description: "Practise 7 days in a row.", icon: "🗓️", check: (c) => c.longestStreak >= 7 },
  { id: "streak-30", title: "Unstoppable", description: "Practise 30 days in a row.", icon: "🌟", check: (c) => c.longestStreak >= 30 },
  { id: "words-1k", title: "1,000 words", description: "Type 1,000 correct words in total.", icon: "📝", check: (c) => c.totalWords >= 1000 },
  { id: "words-10k", title: "10,000 words", description: "Type 10,000 correct words in total.", icon: "📚", check: (c) => c.totalWords >= 10000 },
  { id: "words-100k", title: "100,000 words", description: "Type 100,000 correct words in total.", icon: "🏛️", check: (c) => c.totalWords >= 100000 },
  { id: "lesson-1", title: "Student", description: "Pass your first lesson.", icon: "🎓", check: (c) => c.lessonsCompleted >= 1 },
  { id: "lesson-5", title: "Scholar", description: "Pass 5 lessons.", icon: "📖", check: (c) => c.lessonsCompleted >= 5 },
  { id: "challenge-1", title: "Challenger", description: "Complete a daily challenge.", icon: "🏁", check: (c) => c.challengesCompleted >= 1 },
  { id: "match-win", title: "Victory", description: "Win a multiplayer race.", icon: "🏆", check: (c) => c.matchWins >= 1 },
];

export function evaluateAchievements(ctx: AchievementContext): string[] {
  return ACHIEVEMENTS.filter((a) => a.check(ctx)).map((a) => a.id);
}

/** Longest run of consecutive days in a list of YYYY-MM-DD strings. */
export function longestStreak(days: string[]): number {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of sorted) {
    const t = Date.parse(d + "T00:00:00Z");
    run = prev !== null && t - prev === 86400000 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}
