/** Single list used by the global key handler and the shortcuts reference panel. */
export const NAV_SHORTCUTS: { code: string; key: string; path: string; label: string }[] = [
  { code: "KeyH", key: "H", path: "/", label: "Typing test" },
  { code: "KeyL", key: "L", path: "/leaderboard", label: "Leaderboard" },
  { code: "KeyM", key: "M", path: "/multiplayer", label: "Multiplayer" },
  { code: "KeyT", key: "T", path: "/stats", label: "Statistics" },
  { code: "KeyP", key: "P", path: "/practice", label: "Practice & lessons" },
  { code: "KeyS", key: "S", path: "/settings", label: "Settings & themes" },
  { code: "KeyU", key: "U", path: "/profile", label: "Profile / account" },
  { code: "KeyA", key: "A", path: "/about", label: "About & help" },
];

export const DURATION_SHORTCUTS: { code: string; key: string; seconds: number }[] = [
  { code: "Digit1", key: "1", seconds: 15 },
  { code: "Digit2", key: "2", seconds: 30 },
  { code: "Digit3", key: "3", seconds: 60 },
  { code: "Digit4", key: "4", seconds: 120 },
];
