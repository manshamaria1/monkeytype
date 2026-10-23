/**
 * WordPress plugin build (`vite build --mode wordpress`). The plugin's shortcode puts a
 * config object on window before the app script; the app then talks to the plugin's REST
 * API and uses WordPress for sign-in.
 */
export interface WpConfig {
  restUrl: string;
  nonce: string | null;
  ajaxUrl: string;
  user: { id: number; username: string; slug: string; email: string; emailVerified: boolean } | null;
  loginUrl: string;
  registerUrl: string | null;
  lostPasswordUrl: string;
  logoutUrl: string;
  profileUrl: string;
  privacyUrl: string | null;
  siteName: string;
  view: "full" | "test";
}

export const WP_BUILD = import.meta.env.VITE_WP === "1";
export const WP: WpConfig | null = WP_BUILD ? ((window as unknown as { TypingTestWP?: WpConfig }).TypingTestWP ?? null) : null;

let nonce: string | null = WP?.nonce ?? null;
export const wpNonce = () => nonce;

/** "/api/leaderboard?x=1" -> the plugin's REST URL (works with and without pretty permalinks). */
export function wpApiUrl(path: string): string {
  const base = WP!.restUrl;
  const rest = path.replace(/^\/api\//, "");
  const [p, q] = rest.split("?");
  const sep = base.includes("?") ? "&" : "?";
  return base + p + (q ? sep + q : "");
}

/** Nonces expire after a day; ask WordPress for a fresh one (cookie-authenticated). */
export async function refreshNonce(): Promise<boolean> {
  if (!WP) return false;
  try {
    const r = await fetch(`${WP.ajaxUrl}?action=rest-nonce`, { credentials: "same-origin" });
    if (!r.ok) return false;
    const text = (await r.text()).trim();
    if (!/^[a-f0-9]{6,}$/.test(text)) return false;
    nonce = text;
    return true;
  } catch {
    return false;
  }
}
