import type { NextFunction, Request, Response } from "express";
import { env } from "./env";
import { HttpError } from "./http";

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );
  if (env.isProd) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}

/**
 * CSRF protection for cookie-authenticated API calls: state-changing requests must be
 * JSON (which a cross-site HTML form cannot send) and, if an Origin header is present,
 * it must be this site. Session cookies are also SameSite=Lax.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers["x-forwarded-host"] ?? req.headers.host;
    let ok = false;
    try {
      const u = new URL(origin);
      ok = u.host === host || origin === env.appUrl;
    } catch {
      ok = false;
    }
    if (!ok) return next(new HttpError(403, "Cross-site request blocked"));
  }
  if (req.headers["content-length"] && req.headers["content-length"] !== "0" && !req.is("application/json")) {
    return next(new HttpError(415, "Requests must be JSON"));
  }
  next();
}

let limitsEnabled = true;
/** Integration tests turn limits off except in the test that checks them. */
export function setRateLimitsEnabled(v: boolean) {
  limitsEnabled = v;
}

/**
 * Fixed-window in-memory rate limiter. Fine for a single server process; with several
 * instances, replace the Map with a shared store (e.g. Redis).
 */
export function rateLimit(opts: { windowMs: number; max: number; key?: (req: Request) => string; name: string }) {
  const hits = new Map<string, { count: number; reset: number }>();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, opts.windowMs);
  timer.unref();
  return (req: Request, res: Response, next: NextFunction) => {
    if (!limitsEnabled) return next();
    const id = `${opts.name}:${opts.key ? opts.key(req) : req.ip}`;
    const now = Date.now();
    let entry = hits.get(id);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + opts.windowMs };
      hits.set(id, entry);
    }
    entry.count++;
    if (entry.count > opts.max) {
      res.setHeader("Retry-After", String(Math.ceil((entry.reset - now) / 1000)));
      return next(new HttpError(429, "Too many requests. Please wait a moment and try again."));
    }
    next();
  };
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  const e = err as { type?: string; status?: number };
  if (e?.type === "entity.too.large") return res.status(413).json({ error: "Request too large" });
  if (e?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON" });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our side. Please try again." });
}
