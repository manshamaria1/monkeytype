import { Router } from "express";
import { z } from "zod";
import type pg from "pg";
import {
  clearSessionCookie,
  createSession,
  currentUser,
  hashPassword,
  randomToken,
  requireUser,
  setSessionCookie,
  sha256,
  verifyPassword,
} from "../auth";
import { tx } from "../db";
import { env } from "../env";
import { ah, HttpError, parseBody } from "../http";
import type { Mailer } from "../mailer";
import { rateLimit } from "../security";

export const usernameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_]{3,20}$/, "Username must be 3–20 letters, numbers or underscores");
const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(200, "Password is too long");

const registerSchema = z.object({ email: emailSchema, username: usernameSchema, password: passwordSchema });
const loginSchema = z.object({ login: z.string().trim().min(1, "Enter your email or username").max(254), password: z.string().min(1, "Enter your password").max(200) });

// A real hash, so that login timing does not reveal whether an account exists.
let dummyHash: Promise<string> | null = null;

async function issueEmailToken(db: pg.Pool, userId: number, kind: "verify" | "reset", hours: number) {
  const token = randomToken();
  await db.query(`UPDATE email_tokens SET used_at = now() WHERE user_id = $1 AND kind = $2 AND used_at IS NULL`, [userId, kind]);
  await db.query(
    `INSERT INTO email_tokens (token_hash, user_id, kind, expires_at) VALUES ($1, $2, $3, now() + make_interval(hours => $4))`,
    [sha256(token), userId, kind, hours],
  );
  return token;
}

export function authRoutes(db: pg.Pool, mailer: Mailer) {
  const r = Router();
  const authLimit = rateLimit({ name: "auth", windowMs: 60_000, max: 10 });
  const mailLimit = rateLimit({ name: "mail", windowMs: 15 * 60_000, max: 5 });

  r.post(
    "/register",
    authLimit,
    ah(async (req, res) => {
      const body = parseBody(registerSchema, req.body);
      const hash = await hashPassword(body.password);
      let userId: number;
      try {
        userId = await tx(db, async (c) => {
          const { rows } = await c.query(
            `INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3) RETURNING id`,
            [body.email, body.username, hash],
          );
          await c.query(`INSERT INTO profiles (user_id) VALUES ($1)`, [rows[0].id]);
          return rows[0].id as number;
        });
      } catch (e) {
        const err = e as { code?: string; constraint?: string };
        if (err.code === "23505") {
          throw new HttpError(409, err.constraint === "users_email_lower" ? "An account with this email already exists." : "This username is taken.");
        }
        throw e;
      }
      const token = await issueEmailToken(db, userId, "verify", 48);
      await mailer
        .send({
          to: body.email,
          subject: "Verify your Monkeytype email",
          text: `Welcome to Monkeytype, ${body.username}!\n\nConfirm your email address:\n${env.appUrl}/account/verify?token=${token}\n\nThis link expires in 48 hours.`,
        })
        .catch((e) => console.error("verification email failed", e));
      const session = await createSession(db, userId, req.headers["user-agent"]);
      setSessionCookie(res, session);
      res.status(201).json({ user: { id: userId, username: body.username, email: body.email, emailVerified: false } });
    }),
  );

  r.post(
    "/login",
    authLimit,
    ah(async (req, res) => {
      const body = parseBody(loginSchema, req.body);
      const { rows } = await db.query(
        `SELECT id, username, email, password_hash, email_verified_at IS NOT NULL AS verified
           FROM users WHERE lower(email) = lower($1) OR lower(username) = lower($1) LIMIT 1`,
        [body.login],
      );
      const user = rows[0];
      if (!user) {
        dummyHash ??= hashPassword("not-a-real-password");
        await verifyPassword(body.password, await dummyHash);
        throw new HttpError(401, "Incorrect email/username or password.");
      }
      if (!(await verifyPassword(body.password, user.password_hash))) {
        throw new HttpError(401, "Incorrect email/username or password.");
      }
      const session = await createSession(db, user.id, req.headers["user-agent"]);
      setSessionCookie(res, session);
      res.json({ user: { id: user.id, username: user.username, email: user.email, emailVerified: user.verified } });
    }),
  );

  r.post(
    "/logout",
    ah(async (req, res) => {
      if (req.user) await db.query(`DELETE FROM sessions WHERE id = $1`, [req.user.sessionId]);
      clearSessionCookie(res);
      res.json({ ok: true });
    }),
  );

  r.get("/me", (req, res) => {
    const u = req.user;
    res.json({ user: u ? { id: u.id, username: u.username, email: u.email, emailVerified: u.emailVerified } : null });
  });

  r.post(
    "/forgot",
    mailLimit,
    ah(async (req, res) => {
      const { email } = parseBody(z.object({ email: emailSchema }), req.body);
      const { rows } = await db.query(`SELECT id, username FROM users WHERE lower(email) = $1`, [email]);
      if (rows[0]) {
        const token = await issueEmailToken(db, rows[0].id, "reset", 1);
        await mailer.send({
          to: email,
          subject: "Reset your Monkeytype password",
          text: `Hi ${rows[0].username},\n\nReset your password here (valid for 1 hour):\n${env.appUrl}/account/reset?token=${token}\n\nIf you did not ask for this, you can ignore this email.`,
        });
      }
      // Same response either way so the endpoint cannot be used to discover accounts.
      res.json({ ok: true, message: "If an account exists for that email, a reset link has been sent." });
    }),
  );

  r.post(
    "/reset",
    authLimit,
    ah(async (req, res) => {
      const body = parseBody(z.object({ token: z.string().min(10).max(200), password: passwordSchema }), req.body);
      const hash = await hashPassword(body.password);
      const ok = await tx(db, async (c) => {
        const { rows } = await c.query(
          `UPDATE email_tokens SET used_at = now()
            WHERE token_hash = $1 AND kind = 'reset' AND used_at IS NULL AND expires_at > now()
            RETURNING user_id`,
          [sha256(body.token)],
        );
        if (!rows[0]) return false;
        await c.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, rows[0].user_id]);
        // Log out every existing session after a password reset.
        await c.query(`DELETE FROM sessions WHERE user_id = $1`, [rows[0].user_id]);
        return true;
      });
      if (!ok) throw new HttpError(400, "This reset link is invalid or has expired. Please request a new one.");
      res.json({ ok: true });
    }),
  );

  r.post(
    "/verify",
    ah(async (req, res) => {
      const body = parseBody(z.object({ token: z.string().min(10).max(200) }), req.body);
      const { rows } = await db.query(
        `UPDATE email_tokens SET used_at = now()
          WHERE token_hash = $1 AND kind = 'verify' AND used_at IS NULL AND expires_at > now()
          RETURNING user_id`,
        [sha256(body.token)],
      );
      if (!rows[0]) throw new HttpError(400, "This verification link is invalid or has expired.");
      await db.query(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`, [rows[0].user_id]);
      res.json({ ok: true });
    }),
  );

  r.post(
    "/resend-verification",
    requireUser,
    mailLimit,
    ah(async (req, res) => {
      const u = currentUser(req);
      if (u.emailVerified) return res.json({ ok: true });
      const token = await issueEmailToken(db, u.id, "verify", 48);
      await mailer.send({
        to: u.email,
        subject: "Verify your Monkeytype email",
        text: `Confirm your email address:\n${env.appUrl}/account/verify?token=${token}\n\nThis link expires in 48 hours.`,
      });
      res.json({ ok: true });
    }),
  );

  return r;
}
