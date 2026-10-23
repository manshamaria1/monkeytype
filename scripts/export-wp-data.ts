// Exports the shared datasets as JSON for the WordPress plugin's PHP code,
// so PHP validates results against exactly the same words, quotes and rules as the browser.
import { writeFileSync } from "node:fs";
import { LANGUAGES } from "../shared/languages";
import { LESSONS } from "../shared/lessons";
import { ACHIEVEMENTS } from "../shared/achievements";
import { LEADERBOARD_RULES } from "../shared/results";
import { WORD_LIST_SIZES } from "../shared/words";
import { AVATARS } from "../shared/avatars";

const out = process.argv[2] ?? "wordpress/typing-test/data/data.json";
const data = {
  languages: Object.fromEntries(
    LANGUAGES.map((l) => [l.id, { words: l.words, hasCase: l.hasCase, quotes: Object.fromEntries(l.quotes.map((q) => [q.id, q.text])) }]),
  ),
  lessons: Object.fromEntries(LESSONS.map((l) => [l.id, { passAccuracy: l.passAccuracy, passWpm: l.passWpm }])),
  achievements: ACHIEVEMENTS.map((a) => ({ id: a.id, title: a.title, description: a.description, icon: a.icon })),
  leaderboard: { ...LEADERBOARD_RULES },
  wordListSizes: Object.fromEntries(Object.entries(WORD_LIST_SIZES).map(([k, v]) => [k, Number.isFinite(v) ? v : 1_000_000])),
  avatars: Object.fromEntries(AVATARS.map((a) => [a.id, a.emoji])),
};
writeFileSync(out, JSON.stringify(data));
console.log(`${out}: ${(JSON.stringify(data).length / 1024).toFixed(0)} KB`);
