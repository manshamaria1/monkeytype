import { PREVIEW, PREVIEW_MESSAGE } from "./preview";
import { refreshNonce, WP, wpApiUrl, wpNonce } from "./wp";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** JSON fetch wrapper. Throws ApiError with a user-readable message on failure. */
/** URL for plain links (e.g. data export downloads). */
export function apiUrl(path: string): string {
  if (!WP) return path;
  const url = wpApiUrl(path);
  const n = wpNonce();
  return n ? `${url}${url.includes("?") ? "&" : "?"}_wpnonce=${n}` : url;
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}, retried = false): Promise<T> {
  // The preview build has no server: fail fast instead of hitting whatever hosts the page.
  if (PREVIEW) throw new ApiError(0, PREVIEW_MESSAGE);
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const nonce = WP ? wpNonce() : null;
  if (nonce) headers["X-WP-Nonce"] = nonce;
  let res: Response;
  try {
    res = await fetch(WP ? wpApiUrl(path) : path, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "Could not reach the server. Check your connection and try again.");
  }
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // A successful status with an unreadable body (e.g. a PHP warning printed into it) is an error,
      // never silently "no data".
      if (res.ok) throw new ApiError(502, "Unexpected response from the server. Please try again.");
      data = null;
    }
  }
  if (!res.ok) {
    const d = data as { error?: string; message?: string; code?: string } | null;
    // WordPress: an expired nonce makes every request fail; refresh it once and retry.
    if (WP && !retried && d?.code === "rest_cookie_invalid_nonce" && (await refreshNonce())) return api<T>(path, opts, true);
    const msg = d?.error ?? (WP ? d?.message?.replace(/<[^>]+>/g, "") : undefined) ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}
