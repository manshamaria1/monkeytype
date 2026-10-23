// Generates random typing sessions and the TypeScript results for them.
// tests/wp/parity.php replays the same sessions with the PHP engine and compares.
import { writeFileSync } from "node:fs";
import { replay, type TypingEvent } from "../../shared/engine";
import { verifySubmission, rulesFor, type Submission } from "../../shared/results";
import { seededRng, WordGenerator } from "../../shared/words";
import { LANGUAGES } from "../../shared/languages";
import { randomUUID } from "node:crypto";

const rng = seededRng(2024);
const pick = <T,>(a: readonly T[]) => a[Math.floor(rng() * a.length)];
const cases: unknown[] = [];

for (let n = 0; n < 400; n++) {
  const lang = pick(LANGUAGES).id;
  const mode = pick(["time", "words", "words", "practice", "custom"] as const);
  const punctuation = rng() < 0.3;
  const numbers = rng() < 0.2;
  const wordCount = pick([10, 25]);
  const words = new WordGenerator({ language: lang, punctuation, numbers, wordListSize: "medium" }, seededRng(n)).take(mode === "time" || mode === "practice" ? 60 : wordCount);
  const base = {
    mode,
    mode2: mode === "time" ? "15" : mode === "words" ? String(wordCount) : mode,
    language: lang,
    wordListSize: "medium" as const,
    punctuation,
    numbers,
    difficulty: pick(["normal", "normal", "normal", "expert", "master"] as const),
    strictMode: rng() < 0.15,
    confidenceMode: pick(["off", "off", "off", "on", "max"] as const),
    freedomMode: rng() < 0.2,
  };
  // Simulated typist with mistakes, backspaces, going back, and odd timing.
  const events: TypingEvent[] = [];
  let t = 0;
  let wi = 0;
  let cur = "";
  const limit = mode === "time" ? 15000 : Infinity;
  for (let step = 0; step < 2000 && wi < words.length && t <= limit; step++) {
    const target = Array.from(words[wi]);
    const r = rng();
    t += Math.round(30 + rng() * 250);
    if (r < 0.06 && cur.length) {
      cur = Array.from(cur).slice(0, -1).join("");
      events.push({ t, k: "i", v: cur });
    } else if (r < 0.08 && !cur.length) {
      events.push({ t, k: "b" });
    } else if (r < 0.12) {
      cur += pick(["x", "é", "ا", "न", "1", ","]);
      events.push({ t, k: "i", v: cur });
    } else if (Array.from(cur).length >= target.length || r < 0.14) {
      events.push({ t, k: "c" });
      cur = "";
      wi++;
    } else {
      cur += target[Array.from(cur).length] ?? "z";
      events.push({ t, k: "i", v: cur });
    }
  }
  const timed = mode === "time" || mode === "practice";
  const rules = rulesFor(base);
  const kept = mode === "time" ? events.filter((e) => e.t <= 15000) : events;
  const engine = replay(words, kept, rules, timed ? (mode === "time" ? 15000 : Math.max(1, kept.at(-1)?.t ?? 1)) : undefined);
  const stats = engine.stats();
  const sub: Submission = {
    ...base,
    clientId: randomUUID(),
    words,
    events: kept.length ? kept : [{ t: 0, k: "c" }],
    durationMs: Math.max(1, Math.round(engine.endT ?? stats.durationMs)),
    claimed: { wpm: stats.wpm, rawWpm: stats.rawWpm, accuracy: stats.accuracy },
    pasted: false,
  };
  const v = verifySubmission(sub);
  cases.push({
    sub,
    expected: {
      stats,
      samples: engine.samples,
      keyStats: engine.keyStats,
      failed: engine.failed,
      finished: engine.finished,
      verify: v.ok ? { ok: true, eligible: v.result.eligible, reasons: v.result.ineligibleReasons } : { ok: false, error: v.error },
    },
  });
}
writeFileSync(process.argv[2] ?? "/tmp/parity.json", JSON.stringify(cases));
console.log(`${cases.length} cases written`);
