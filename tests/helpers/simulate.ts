import { randomUUID } from "node:crypto";
import { replay, type EngineRules, type TypingEvent } from "../../shared/engine";
import { rulesFor, type Submission } from "../../shared/results";

/** Simulate a typist: letters, spaces and backspaces ("\b") with jittered timing. */
export function typeText(text: string, opts: { start?: number; minGap?: number; maxGap?: number; seed?: number } = {}): TypingEvent[] {
  let seed = opts.seed ?? 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const min = opts.minGap ?? 80;
  const max = opts.maxGap ?? 160;
  const events: TypingEvent[] = [];
  let current = "";
  let t = opts.start ?? 0;
  for (const ch of Array.from(text)) {
    if (ch === " ") {
      events.push({ t, k: "c" });
      current = "";
    } else if (ch === "\b") {
      if (!current) events.push({ t, k: "b" });
      else {
        current = Array.from(current).slice(0, -1).join("");
        events.push({ t, k: "i", v: current });
      }
    } else {
      current += ch;
      events.push({ t, k: "i", v: current });
    }
    t += Math.round(min + rand() * (max - min));
  }
  return events;
}

type Base = Omit<Submission, "clientId" | "events" | "durationMs" | "claimed" | "pasted">;

/** Build a submission whose claimed numbers are computed exactly like the browser does. */
export function makeSubmission(base: Partial<Base> & { words: string[] }, events: TypingEvent[], durationMs?: number): Submission {
  const full: Base = {
    mode: "words",
    mode2: String(base.words.length),
    language: "english",
    wordListSize: "medium",
    punctuation: false,
    numbers: false,
    difficulty: "normal",
    strictMode: false,
    confidenceMode: "off",
    freedomMode: false,
    ...base,
  };
  const rules: EngineRules = rulesFor(full);
  const engine = replay(full.words, events, rules, rules.bounded ? undefined : durationMs);
  const stats = engine.stats();
  return {
    ...full,
    clientId: randomUUID(),
    events,
    durationMs: rules.bounded ? Math.max(1, Math.round(engine.endT ?? stats.durationMs)) : durationMs!,
    claimed: { wpm: stats.wpm, rawWpm: stats.rawWpm, accuracy: stats.accuracy },
    pasted: false,
  };
}

/** A valid words-mode submission typed perfectly with the given keystroke gap range. */
export function perfectWordsTest(words: string[], gap: [number, number] = [80, 160], seed = 1): Submission {
  return makeSubmission({ words }, typeText(words.join(" "), { minGap: gap[0], maxGap: gap[1], seed }));
}
