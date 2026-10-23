import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, sanitizeConfig } from "../../shared/config";
import { evaluateAchievements, longestStreak } from "../../shared/achievements";
import { computeOutcomes } from "../../server/multiplayer";

describe("config", () => {
  it("drops invalid values and unknown keys, keeps valid ones", () => {
    const c = sanitizeConfig({ time: 60, fontSize: 99, theme: "midnight", evil: "<script>", mode: "nope" });
    expect(c.time).toBe(60);
    expect(c.fontSize).toBe(DEFAULT_CONFIG.fontSize);
    expect(c.theme).toBe("midnight");
    expect(c.mode).toBe(DEFAULT_CONFIG.mode);
    expect("evil" in c).toBe(false);
  });
  it("handles garbage input", () => {
    expect(sanitizeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(sanitizeConfig("x")).toEqual(DEFAULT_CONFIG);
  });
});

describe("achievements", () => {
  const base = { tests: 0, bestWpm: 0, perfectTest: false, bestQualifiedAccuracy: 0, totalWords: 0, longestStreak: 0, lessonsCompleted: 0, matchWins: 0, challengesCompleted: 0 };
  it("unlocks nothing without activity", () => {
    expect(evaluateAchievements(base)).toEqual([]);
  });
  it("unlocks by real thresholds", () => {
    const ids = evaluateAchievements({ ...base, tests: 12, bestWpm: 61, totalWords: 1200, longestStreak: 3 });
    expect(ids).toEqual(expect.arrayContaining(["first-test", "tests-10", "wpm-40", "wpm-60", "words-1k", "streak-3"]));
    expect(ids).not.toContain("wpm-80");
  });
  it("computes day streaks", () => {
    expect(longestStreak(["2026-01-01", "2026-01-02", "2026-01-04", "2026-01-05", "2026-01-06"])).toBe(3);
    expect(longestStreak([])).toBe(0);
    expect(longestStreak(["2026-02-28", "2026-03-01"])).toBe(2);
  });
});

describe("race outcomes", () => {
  it("first finisher wins, others lose, unfinished are dnf", () => {
    const out = computeOutcomes([
      { id: "a", finishMs: 9000, progress: 1, wpm: 50 },
      { id: "b", finishMs: 7000, progress: 1, wpm: 60 },
      { id: "c", finishMs: null, progress: 0.5, wpm: 40 },
      { id: "d", finishMs: null, progress: 0.8, wpm: 30 },
    ]);
    const by = Object.fromEntries(out.map((o) => [o.id, o]));
    expect(by.b).toMatchObject({ place: 1, outcome: "win" });
    expect(by.a).toMatchObject({ place: 2, outcome: "loss" });
    expect(by.d).toMatchObject({ place: 3, outcome: "dnf" });
    expect(by.c).toMatchObject({ place: 4, outcome: "dnf" });
  });
  it("equal finish times share first place as a draw", () => {
    const out = computeOutcomes([
      { id: "a", finishMs: 5000, progress: 1, wpm: 50 },
      { id: "b", finishMs: 5000, progress: 1, wpm: 50 },
      { id: "c", finishMs: 6000, progress: 1, wpm: 40 },
    ]);
    expect(out.map((o) => [o.id, o.place, o.outcome])).toEqual([
      ["a", 1, "draw"],
      ["b", 1, "draw"],
      ["c", 3, "loss"],
    ]);
  });
});
