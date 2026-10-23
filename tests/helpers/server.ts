import pg from "pg";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../server/app";
import { createPool } from "../../server/db";
import { createMailer, type Mailer } from "../../server/mailer";
import { migrate } from "../../server/migrate";
import { setRateLimitsEnabled } from "../../server/security";

export const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgresql://monkey:monkey@localhost:5432/monkeytype_test";

/** Fresh schema in the test database (everything is dropped first). */
export async function freshDb(): Promise<pg.Pool> {
  if (!/test/.test(TEST_DB)) throw new Error("Refusing to wipe a database whose name does not contain 'test'");
  const pool = createPool(TEST_DB);
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(pool, () => {});
  return pool;
}

export function makeApp(pool: pg.Pool): { app: Express; mailer: Mailer } {
  setRateLimitsEnabled(false);
  const mailer = createMailer();
  return { app: createApp(pool, mailer), mailer };
}

let n = 0;
/** Register a user and return a cookie-carrying agent. */
export async function newUser(app: Express, name?: string) {
  const username = name ?? `user${++n}_${Date.now() % 100000}`;
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").send({ email: `${username}@example.com`, username, password: "correct horse" });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, username, id: res.body.user.id as number };
}
