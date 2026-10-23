import { z } from "zod";

/**
 * Central configuration for the whole app. Every user-facing setting lives here,
 * with its default and validation. The client persists it in localStorage and,
 * for signed-in users, the server stores the same validated object.
 */

export const TIME_PRESETS = [15, 30, 60, 120] as const;
export const WORD_PRESETS = [10, 25, 50, 100] as const;

export const MODES = ["time", "words", "quote", "custom", "practice"] as const;
export type Mode = (typeof MODES)[number];

/** Modes that only exist for results (not selectable in the test bar). */
export const RESULT_MODES = [...MODES, "lesson", "challenge"] as const;
export type ResultMode = (typeof RESULT_MODES)[number];

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const customThemeSchema = z.object({
  bg: hexColor,
  main: hexColor,
  caret: hexColor,
  sub: hexColor,
  subAlt: hexColor,
  text: hexColor,
  error: hexColor,
  errorExtra: hexColor,
});
export type ThemeColors = z.infer<typeof customThemeSchema>;

export const configSchema = z.object({
  // test
  mode: z.enum(MODES),
  time: z.number().int().min(5).max(3600),
  words: z.number().int().min(1).max(1000),
  quoteLength: z.enum(["any", "short", "medium", "long"]),
  customText: z.string().max(10000),
  language: z.string().min(1).max(40),
  wordListSize: z.enum(["small", "medium", "full"]),
  difficulty: z.enum(["normal", "expert", "master"]),
  punctuation: z.boolean(),
  numbers: z.boolean(),
  strictMode: z.boolean(),
  // input behaviour
  confidenceMode: z.enum(["off", "on", "max"]),
  freedomMode: z.boolean(),
  pasteMode: z.enum(["block", "allow"]),
  quickRestart: z.enum(["tab", "esc", "enter", "off"]),
  repeatOnRestart: z.boolean(),
  // appearance
  theme: z.string().max(40),
  customTheme: customThemeSchema.nullable(),
  fontFamily: z.string().max(40),
  fontSize: z.number().min(1).max(4),
  caretStyle: z.enum(["line", "block", "underline", "outline", "off"]),
  smoothCaret: z.enum(["off", "slow", "medium", "fast"]),
  caretBlink: z.boolean(),
  indicateTypos: z.enum(["off", "below", "replace"]),
  focusMode: z.boolean(),
  reducedMotion: z.enum(["system", "on", "off"]),
  // live + results display
  liveWpm: z.boolean(),
  liveAccuracy: z.boolean(),
  timerStyle: z.enum(["text", "bar", "off"]),
  showResultChart: z.boolean(),
  showKeyStats: z.boolean(),
  // sound
  sound: z.enum(["off", "click", "beep", "pop"]),
  errorSound: z.boolean(),
  soundVolume: z.number().min(0).max(1),
});

export type Config = z.infer<typeof configSchema>;

export const DEFAULT_CONFIG: Config = {
  mode: "time",
  time: 30,
  words: 25,
  quoteLength: "any",
  customText: "The quick brown fox jumps over the lazy dog.",
  language: "english",
  wordListSize: "medium",
  difficulty: "normal",
  punctuation: false,
  numbers: false,
  strictMode: false,
  confidenceMode: "off",
  freedomMode: false,
  pasteMode: "block",
  quickRestart: "tab",
  repeatOnRestart: false,
  theme: "classic-dark",
  customTheme: null,
  fontFamily: "roboto-mono",
  fontSize: 1.75,
  caretStyle: "line",
  smoothCaret: "medium",
  caretBlink: true,
  indicateTypos: "off",
  focusMode: true,
  reducedMotion: "system",
  liveWpm: true,
  liveAccuracy: false,
  timerStyle: "text",
  showResultChart: true,
  showKeyStats: true,
  sound: "off",
  errorSound: false,
  soundVolume: 0.5,
};

/**
 * Merge an unknown (possibly old or partially invalid) stored object onto the
 * defaults, keeping only fields that validate. Used when loading localStorage,
 * imported settings files and server preferences.
 */
export function sanitizeConfig(input: unknown): Config {
  const out: Record<string, unknown> = { ...DEFAULT_CONFIG };
  if (input && typeof input === "object") {
    const shape = configSchema.shape as Record<string, z.ZodTypeAny>;
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      const field = shape[key];
      if (!field) continue;
      const parsed = field.safeParse(value);
      if (parsed.success) out[key] = parsed.data;
    }
  }
  return out as Config;
}

export const FONTS: { id: string; name: string; css: string; google?: string }[] = [
  { id: "roboto-mono", name: "Roboto Mono", css: "'Roboto Mono', monospace", google: "Roboto+Mono:wght@400;500" },
  { id: "jetbrains-mono", name: "JetBrains Mono", css: "'JetBrains Mono', monospace", google: "JetBrains+Mono:wght@400;500" },
  { id: "fira-code", name: "Fira Code", css: "'Fira Code', monospace", google: "Fira+Code:wght@400;500" },
  { id: "source-code-pro", name: "Source Code Pro", css: "'Source Code Pro', monospace", google: "Source+Code+Pro:wght@400;500" },
  { id: "ibm-plex-mono", name: "IBM Plex Mono", css: "'IBM Plex Mono', monospace", google: "IBM+Plex+Mono:wght@400;500" },
  { id: "system-mono", name: "System monospace", css: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
  { id: "lexend", name: "Lexend (sans)", css: "'Lexend Deca', sans-serif", google: "Lexend+Deca:wght@400;500" },
];

export function fontCss(id: string): string {
  return (FONTS.find((f) => f.id === id) ?? FONTS[0]).css;
}
