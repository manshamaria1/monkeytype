import type { ThemeColors } from "./config";

/**
 * Built-in themes. All colours used by the UI come from these tokens (applied as CSS
 * custom properties), so a theme change updates every component at once.
 *   bg      page background        main     accent (logo, active buttons, stats)
 *   caret   typing caret           sub      pending text, secondary UI
 *   subAlt  panels / inputs        text     correctly typed text, body text
 *   error   wrong letters          errorExtra extra letters typed past the word
 */
export interface Theme extends ThemeColors {
  id: string;
  name: string;
  dark: boolean;
}

export const THEMES: Theme[] = [
  { id: "classic-dark", name: "Classic dark", dark: true, bg: "#323437", main: "#e2b714", caret: "#e2b714", sub: "#646669", subAlt: "#2c2e31", text: "#d1d0c5", error: "#ca4754", errorExtra: "#7e2a33" },
  { id: "classic-light", name: "Classic light", dark: false, bg: "#f4f1ea", main: "#b68b00", caret: "#b68b00", sub: "#8a8781", subAlt: "#e7e2d6", text: "#2b2a28", error: "#c0392b", errorExtra: "#8e2a20" },
  { id: "midnight", name: "Midnight", dark: true, bg: "#0f172a", main: "#38bdf8", caret: "#38bdf8", sub: "#64748b", subAlt: "#1e293b", text: "#e2e8f0", error: "#f87171", errorExtra: "#b91c1c" },
  { id: "forest", name: "Forest", dark: true, bg: "#1d2621", main: "#8fbf6a", caret: "#c6e48b", sub: "#5f7066", subAlt: "#25302a", text: "#dfe8d8", error: "#e06c5f", errorExtra: "#9b3d34" },
  { id: "arctic", name: "Arctic", dark: true, bg: "#2e3440", main: "#88c0d0", caret: "#eceff4", sub: "#7b869a", subAlt: "#3b4252", text: "#eceff4", error: "#bf616a", errorExtra: "#8c3e46" },
  { id: "vampire", name: "Vampire", dark: true, bg: "#282a36", main: "#bd93f9", caret: "#ff79c6", sub: "#7d84a8", subAlt: "#343746", text: "#f8f8f2", error: "#ff5555", errorExtra: "#b03a3a" },
  { id: "terminal", name: "Terminal", dark: true, bg: "#0b0f0b", main: "#39ff7a", caret: "#39ff7a", sub: "#3f6b4b", subAlt: "#121a13", text: "#c9f5d4", error: "#ff4d4d", errorExtra: "#a83232" },
  { id: "sunset", name: "Sunset", dark: true, bg: "#2b1e2f", main: "#ff9e64", caret: "#ffc777", sub: "#8a6f8c", subAlt: "#352638", text: "#f6e3dc", error: "#ff5d73", errorExtra: "#a83a4b" },
  { id: "carbon", name: "Carbon", dark: true, bg: "#161616", main: "#f66e0d", caret: "#f66e0d", sub: "#6b6b6b", subAlt: "#202020", text: "#eaeaea", error: "#e5484d", errorExtra: "#9e2f33" },
  { id: "paper", name: "Paper", dark: false, bg: "#eeeeee", main: "#444444", caret: "#444444", sub: "#9a9a9a", subAlt: "#dddddd", text: "#222222", error: "#d43c3c", errorExtra: "#972b2b" },
  { id: "lavender", name: "Lavender", dark: false, bg: "#f3effa", main: "#7c5cc4", caret: "#7c5cc4", sub: "#9d93b3", subAlt: "#e6dff3", text: "#2f2546", error: "#d0365b", errorExtra: "#8f2440" },
  { id: "sand", name: "Sand", dark: false, bg: "#efe6d2", main: "#a0522d", caret: "#a0522d", sub: "#9b8b6f", subAlt: "#e3d7bd", text: "#3b2f20", error: "#c2410c", errorExtra: "#7c2d12" },
  { id: "high-contrast", name: "High contrast", dark: true, bg: "#000000", main: "#ffff00", caret: "#ffff00", sub: "#a0a0a0", subAlt: "#1a1a1a", text: "#ffffff", error: "#ff6b6b", errorExtra: "#ff9999" },
];

export const CUSTOM_THEME_ID = "custom";

export function getTheme(id: string, custom: ThemeColors | null): Theme {
  if (id === CUSTOM_THEME_ID && custom) return { id, name: "Custom", dark: isDark(custom.bg), ...custom };
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

function isDark(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}
