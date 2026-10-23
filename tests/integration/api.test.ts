import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type pg from "pg";
import type { Express } from "express";
import { freshDb, makeApp, newUser } from "../helpers/server";
import { makeSubmission, perfectWordsTest, typeText } from "../helpers/simulate";
import { seededRng, WordGenerator } from "../../shared/words";
import { DEFAULT_CONFIG } from "../../shared/config";
import type { Mailer } from "../../server/mailer";
import { setRateLimitsEnabled } from "../../server/security";

let pool: pg.Pool;
let app: Express;
let mailer: Mailer;

beforeAll(async () => {
  pool = await freshDb();
  ({ app, mailer } = makeApp(pool));
});
afterAll(async () => {
  await pool.end();
});

const words = (seed: number, n = 10) => new WordGenerator({ language: "english" }, seededRng(seed)).take(n);

describe("auth", () => {
  it("registers, reads the session, logs out", async () => {
    const { agent, username } = await newUser(app);
    const me = await agent.get("/api/auth/me");
    expect(me.body.user.username).toBe(username);
    await agent.post("/api/auth/logout").send({});
    expect((await agent.get("/api/auth/me")).body.user).toBeNull();
  });

  it("never stores plaintext passwords", async () => {
    const { username } = await newUser(app);
    const { rows } = await pool.query("SELECT password_hash FROM users WHERE username = $1", [username]);
    expect(rows[0].password_hash).toMatch(/^scrypt\$/);
    expect(rows[0].password_hash).not.toContain("correct horse");
  });

  it("rejects duplicates and bad input with clear messages", async () => {
    const { username } = await newUser(app);
    const dup = await request(app).post("/api/auth/register").send({ email: "other@example.com", username, password: "password123" });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/username is taken/i);
    const bad = await request(app).post("/api/auth/register").send({ email: "nope", username: "a", password: "x" });
    expect(bad.status).toBe(400);
  });

  it("logs in by username or email, rejects wrong password", async () => {
    const { username } = await newUser(app);
    expect((await request(app).post("/api/auth/login").send({ login: username, password: "correct horse" })).status).toBe(200);
    expect((await request(app).post("/api/auth/login").send({ login: `${username}@example.com`, password: "correct horse" })).status).toBe(200);
    const wrong = await request(app).post("/api/auth/login").send({ login: username, password: "wrong" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toMatch(/incorrect/i);
  });

  it("resets a forgotten password with a single-use emailed token", async () => {
    const { username, agent } = await newUser(app);
    const email = `${username}@example.com`;
    const r = await request(app).post("/api/auth/forgot").send({ email });
    expect(r.status).toBe(200);
    // Unknown emails get the same answer.
    expect((await request(app).post("/api/auth/forgot").send({ email: "nobody@example.com" })).body).toEqual(r.body);
    const mail = mailer.outbox!.filter((m) => m.to === email).pop()!;
    const token = /token=([\w-]+)/.exec(mail.text)![1];
    expect((await request(app).post("/api/auth/reset").send({ token, password: "new password 1" })).status).toBe(200);
    expect((await request(app).post("/api/auth/reset").send({ token, password: "another one 2" })).status).toBe(400);
    // Old sessions are revoked.
    expect((await agent.get("/api/auth/me")).body.user).toBeNull();
    expect((await request(app).post("/api/auth/login").send({ login: username, password: "new password 1" })).status).toBe(200);
  });

  it("verifies email with the token from the welcome mail", async () => {
    const { username, agent } = await newUser(app);
    const mail = mailer.outbox!.filter((m) => m.to === `${username}@example.com` && /Verify/.test(m.subject)).pop()!;
    const token = /token=([\w-]+)/.exec(mail.text)![1];
    expect((await request(app).post("/api/auth/verify").send({ token })).status).toBe(200);
    expect((await agent.get("/api/auth/me")).body.user.emailVerified).toBe(true);
  });

  it("blocks cross-site and non-JSON writes", async () => {
    const r = await request(app).post("/api/auth/login").set("Origin", "https://evil.example").send({ login: "x", password: "y" });
    expect(r.status).toBe(403);
    const form = await request(app).post("/api/auth/login").type("form").send("login=x&password=y");
    expect(form.status).toBe(415);
  });

  it("rate-limits repeated login attempts", async () => {
    setRateLimitsEnabled(true);
    try {
      const codes: number[] = [];
      for (let i = 0; i < 12; i++) codes.push((await request(app).post("/api/auth/login").send({ login: "nobody", password: "x" })).status);
      expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
      expect(codes[11]).toBe(429);
    } finally {
      setRateLimitsEnabled(false);
    }
  });

  it("sets security headers", async () => {
    const r = await request(app).get("/api/health");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(r.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("results", () => {
  it("requires sign-in to save", async () => {
    expect((await request(app).post("/api/results").send(perfectWordsTest(words(1)))).status).toBe(401);
  });

  it("saves a verified result once, sets a PB, unlocks first achievement", async () => {
    const { agent } = await newUser(app);
    const sub = perfectWordsTest(words(2));
    const r = await agent.post("/api/results").send(sub);
    expect(r.status).toBe(201);
    expect(r.body.isPb).toBe(true);
    expect(r.body.eligible).toBe(true);
    expect(r.body.newAchievements).toContain("first-test");
    const again = await agent.post("/api/results").send(sub);
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    const hist = await agent.get("/api/me/results");
    expect(hist.body.total).toBe(1);
    expect(hist.body.results[0].wpm).toBeCloseTo(sub.claimed.wpm, 2);
  });

  it("only replaces the PB with a faster result", async () => {
    const { agent } = await newUser(app);
    const w = words(3);
    const fast = perfectWordsTest(w, [60, 90], 3);
    const slow = perfectWordsTest(w, [150, 250], 4);
    expect((await agent.post("/api/results").send(fast)).body.isPb).toBe(true);
    const s = await agent.post("/api/results").send(slow);
    expect(s.body.isPb).toBe(false);
    const stats = await agent.get("/api/me/stats");
    expect(stats.body.records).toHaveLength(1);
    expect(stats.body.records[0].wpm).toBeCloseTo(fast.claimed.wpm, 2);
    expect(stats.body.totals.tests).toBe(2);
  });

  it("rejects tampered results with 422", async () => {
    const { agent } = await newUser(app);
    const sub = perfectWordsTest(words(4));
    sub.claimed.wpm = 250;
    const r = await agent.post("/api/results").send(sub);
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/does not match/);
  });

  it("keeps each user's history private", async () => {
    const a = await newUser(app);
    const b = await newUser(app);
    const saved = await a.agent.post("/api/results").send(perfectWordsTest(words(5)));
    expect((await b.agent.get(`/api/me/results/${saved.body.id}`)).status).toBe(404);
    expect((await a.agent.get(`/api/me/results/${saved.body.id}`)).status).toBe(200);
    expect((await b.agent.get("/api/me/results")).body.total).toBe(0);
    expect((await request(app).get("/api/me/results")).status).toBe(401);
  });

  it("imports offline results as unranked", async () => {
    const { agent } = await newUser(app);
    const r = await agent.post("/api/results/import").send({ results: [perfectWordsTest(words(6)), { junk: true }] });
    expect(r.body).toEqual({ imported: 1, skipped: 1 });
    const hist = await agent.get("/api/me/results");
    expect(hist.body.results[0].imported).toBe(true);
    expect(hist.body.results[0].leaderboard_eligible).toBe(false);
  });

  it("tracks lesson progress from lesson results", async () => {
    const { agent } = await newUser(app);
    const w = ["fjf", "jfj", "ff", "jj"];
    const sub = makeSubmission({ words: w, mode: "lesson", mode2: "fj" }, typeText(w.join(" "), { minGap: 150, maxGap: 250 }));
    const r = await agent.post("/api/results").send(sub);
    expect(r.body.lesson).toEqual({ passed: true, firstPass: true });
    const p = await agent.get("/api/me/lessons");
    expect(p.body.progress[0]).toMatchObject({ lesson_id: "fj", attempts: 1 });
    expect(p.body.progress[0].completed_at).not.toBeNull();
  });
});

describe("leaderboard", () => {
  beforeEach(async () => {
    await pool.query("TRUNCATE test_results, personal_records CASCADE");
  });

  it("ranks the best result per user by wpm, then accuracy", async () => {
    const a = await newUser(app);
    const b = await newUser(app);
    const c = await newUser(app);
    const w = words(10);
    await a.agent.post("/api/results").send(perfectWordsTest(w, [100, 140], 1));
    await a.agent.post("/api/results").send(perfectWordsTest(w, [60, 80], 2)); // a's best
    await b.agent.post("/api/results").send(perfectWordsTest(w, [70, 100], 3));
    // c: punctuation on -> not ranked
    const punct = new WordGenerator({ language: "english", punctuation: true }, seededRng(4)).take(10);
    const cp = makeSubmission({ words: punct, punctuation: true }, typeText(punct.join(" "), { minGap: 30, maxGap: 50 }));
    expect((await c.agent.post("/api/results").send(cp)).body.eligible).toBe(false);

    const lb = await request(app).get("/api/leaderboard?mode=words&mode2=10&language=english");
    expect(lb.status).toBe(200);
    expect(lb.body.entries.map((e: { username: string }) => e.username)).toEqual([a.username, b.username]);
    expect(lb.body.entries[0].rank).toBe(1);
    expect(lb.body.entries[0].is_pb).toBe(true);
    expect(lb.body.total).toBe(2);
    const rank = await b.agent.get("/api/leaderboard/rank?mode=words&mode2=10&language=english");
    expect(rank.body.entry).toMatchObject({ rank: 2, total: 2 });
    const none = await c.agent.get("/api/leaderboard/rank?mode=words&mode2=10&language=english");
    expect(none.body.entry).toBeNull();
  });

  it("filters by period, country and username search; paginates", async () => {
    const a = await newUser(app);
    const b = await newUser(app);
    const w = words(11);
    const ra = await a.agent.post("/api/results").send(perfectWordsTest(w, [60, 90], 5));
    await b.agent.post("/api/results").send(perfectWordsTest(w, [90, 120], 6));
    // Move a's result to 40 days ago: it stays on all-time but leaves the monthly board.
    await pool.query("UPDATE test_results SET created_at = now() - interval '40 days' WHERE id = $1", [ra.body.id]);
    const monthly = await request(app).get("/api/leaderboard?period=monthly&mode=words&mode2=10");
    expect(monthly.body.entries.map((e: { username: string }) => e.username)).toEqual([b.username]);
    const all = await request(app).get("/api/leaderboard?period=alltime&mode=words&mode2=10");
    expect(all.body.total).toBe(2);
    await b.agent.patch("/api/me/profile").send({ country: "pk" });
    const pk = await request(app).get("/api/leaderboard?mode=words&mode2=10&country=PK");
    expect(pk.body.entries).toHaveLength(1);
    expect(pk.body.entries[0].country).toBe("PK");
    const search = await request(app).get(`/api/leaderboard?mode=words&mode2=10&search=${a.username.slice(0, 6)}`);
    expect(search.body.entries.every((e: { username: string }) => e.username.startsWith(a.username.slice(0, 6)))).toBe(true);
    const p2 = await request(app).get("/api/leaderboard?mode=words&mode2=10&pageSize=1&page=2");
    expect(p2.body.entries).toHaveLength(1);
    expect(p2.body.entries[0].rank).toBe(2);
  });

  it("rejects boards that do not exist", async () => {
    expect((await request(app).get("/api/leaderboard?mode=time&mode2=45")).status).toBe(400);
    expect((await request(app).get("/api/leaderboard?language=klingon")).status).toBe(400);
  });

  it("returns an empty board, not an error, when there are no results", async () => {
    const r = await request(app).get("/api/leaderboard?period=daily&mode=time&mode2=120");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ entries: [], total: 0 });
  });
});

describe("account data", () => {
  it("stores and returns validated preferences", async () => {
    const { agent } = await newUser(app);
    expect((await agent.get("/api/me/preferences")).body.config).toBeNull();
    const config = { ...DEFAULT_CONFIG, theme: "midnight", time: 60 };
    expect((await agent.put("/api/me/preferences").send({ config })).status).toBe(200);
    expect((await agent.get("/api/me/preferences")).body.config).toMatchObject({ theme: "midnight", time: 60 });
    expect((await agent.put("/api/me/preferences").send({ config: { ...config, fontSize: 50 } })).status).toBe(400);
  });

  it("updates profile; usernames stay unique", async () => {
    const a = await newUser(app);
    const b = await newUser(app);
    expect((await a.agent.patch("/api/me/profile").send({ bio: "hello", avatar: "fox", country: "de" })).status).toBe(200);
    const pub = await request(app).get(`/api/users/${a.username}`);
    expect(pub.body).toMatchObject({ bio: "hello", avatar: "fox", country: "DE" });
    expect(pub.body.email).toBeUndefined();
    expect((await a.agent.patch("/api/me/profile").send({ username: b.username })).status).toBe(409);
    expect((await a.agent.patch("/api/me/profile").send({ avatar: "not-an-avatar" })).status).toBe(400);
  });

  it("changes password (needs the current one) and signs out other sessions", async () => {
    const { agent, username } = await newUser(app);
    const other = request.agent(app);
    await other.post("/api/auth/login").send({ login: username, password: "correct horse" });
    expect((await agent.post("/api/me/password").send({ current: "wrong", next: "brand new pw" })).status).toBe(403);
    expect((await agent.post("/api/me/password").send({ current: "correct horse", next: "brand new pw" })).status).toBe(200);
    expect((await other.get("/api/auth/me")).body.user).toBeNull();
    expect((await agent.get("/api/auth/me")).body.user.username).toBe(username);
  });

  it("exports everything and deletes the account with all data", async () => {
    const { agent, id } = await newUser(app);
    await agent.post("/api/results").send(perfectWordsTest(words(20)));
    const exp = await agent.get("/api/me/export");
    expect(exp.body.results).toHaveLength(1);
    expect(exp.body.profile.email).toContain("@example.com");
    expect((await agent.delete("/api/me").send({ password: "nope" })).status).toBe(403);
    expect((await agent.delete("/api/me").send({ password: "correct horse" })).status).toBe(200);
    const left = await pool.query("SELECT (SELECT count(*) FROM users WHERE id=$1)::int AS u, (SELECT count(*) FROM test_results WHERE user_id=$1)::int AS r", [id]);
    expect(left.rows[0]).toEqual({ u: 0, r: 0 });
  });

  it("saves goals and reports today's progress", async () => {
    const { agent } = await newUser(app);
    await agent.post("/api/results").send(perfectWordsTest(words(21)));
    await agent.put("/api/me/goals").send({ daily_tests: 3, daily_minutes: 5, target_wpm: 70 });
    const g = await agent.get("/api/me/goals");
    expect(g.body.goals).toEqual({ daily_tests: 3, daily_minutes: 5, target_wpm: 70 });
    expect(g.body.today.tests).toBe(1);
  });
});
