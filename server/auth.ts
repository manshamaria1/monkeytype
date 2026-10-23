import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";
import type { Queryable } from "./db";
import { env } from "./env";
import { HttpError } from "./http";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

// scrypt parameters: N=2^15, r=8, p=1 (~32 MB, ~50-100 ms per hash).
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");

export const SESSION_COOKIE = "mt_session";
const SESSION_DAYS = 30;

export async function createSession(db: Queryable, userId: number, userAgent: string | undefined): Promise<string> {
  const token = randomToken();
  await db.query(
    `INSERT INTO sessions (id, user_id, expires_at, user_agent) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days', $3)`,
    [sha256(token), userId, (userAgent ?? "").slice(0, 200)],
  );
  return token;
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400 * 1000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export interface SessionUser {
  id: number;
  username: string;
  email: string;
  emailVerified: boolean;
  sessionId: string;
}

export async function userFromToken(db: Queryable, token: string | undefined): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  const id = sha256(token);
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.email, u.email_verified_at IS NOT NULL AS verified
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [id],
  );
  if (!rows[0]) return null;
  return { id: rows[0].id, username: rows[0].username, email: rows[0].email, emailVerified: rows[0].verified, sessionId: id };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser | null;
    }
  }
}

/** Attach req.user when a valid session cookie is present. */
export function loadUser(db: Queryable) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.user = await userFromToken(db, readCookie(req.headers.cookie, SESSION_COOKIE));
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function requireUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, "Please sign in to continue."));
  next();
}

export function currentUser(req: Request): SessionUser {
  if (!req.user) throw new HttpError(401, "Please sign in to continue.");
  return req.user;
}
