/**
 * Integration tests for the WordPress plugin's REST API against a running WordPress site.
 * Needs: WordPress with the plugin active at WP_URL (default http://localhost:8080), a page
 * containing [typing_test] at WP_PAGE, and users alice/bob (see docs/WORDPRESS.md).
 * Run: npx vitest run tests/wp   (skipped automatically when the site is not reachable)
 */
import { describe, expect, it, beforeAll } from "vitest";
import { perfectWordsTest, makeSubmission, typeText } from "../helpers/simulate";
import { seededRng, WordGenerator } from "../../shared/words";

const WP = process.env.WP_URL ?? "http://localhost:8080";
const PAGE = process.env.WP_PAGE ?? "/?page_id=5";
const api = (p: string) => `${WP}/?rest_route=/typing-test/v1/${p.replace("?", "&")}`;

let up = false;
try {
  up = (await fetch(api("leaderboard/rules"))).ok;
} catch {
  up = false;
}

interface Session {
  cookie: string;
  nonce: string;
}

async function login(user: string, pass: string): Promise<Session> {
  const res = await fetch(`${WP}/wp-login.php`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: "wordpress_test_cookie=WP%20Cookie%20check" },
    body: new URLSearchParams({ log: user, pwd: pass, testcookie: "1" }),
  });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => c.startsWith("wordpress_"))
    .join("; ");
  const html = await (await fetch(WP + PAGE, { headers: { Cookie: cookie } })).text();
  const nonce = /"nonce":"([a-f0-9]+)"/.exec(html)?.[1];
  if (!cookie || !nonce) throw new Error(`login failed for ${user}`);
  return { cookie, nonce };
}

async function call(s: Session | null, path: string, init: { method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (s) {
    headers.Cookie = s.cookie;
    headers["X-WP-Nonce"] = s.nonce;
  }
  const res = await fetch(api(path), { method: init.method ?? (init.body ? "POST" : "GET"), headers, body: init.body ? JSON.stringify(init.body) : undefined });
  return { status: res.status, body: await res.json() };
}

const words = (seed: number) => new WordGenerator({ language: "english" }, seededRng(seed)).take(10);

describe.skipIf(!up)("WordPress plugin API", () => {
  let alice: Session;
  let bob: Session;
  beforeAll(async () => {
    alice = await login("alice", "alicepass123");
    bob = await login("bob", "bobpass12345");
  });

  it("identifies the signed-in WordPress user", async () => {
    expect((await call(alice, "auth/me")).body.user.username).toBe("Alice");
    expect((await call(null, "auth/me")).body.user).toBeNull();
  });

  it("requires sign-in (and a valid nonce) to save", async () => {
    expect((await call(null, "results", { body: perfectWordsTest(words(1)) })).status).toBe(401);
    // Cookie without nonce is treated as signed out by WordPress.
    const noNonce = await fetch(api("results"), { method: "POST", headers: { "Content-Type": "application/json", Cookie: alice.cookie }, body: JSON.stringify(perfectWordsTest(words(1))) });
    expect(noNonce.status).toBe(401);
  });

  it("saves verified results once and rejects tampered ones", async () => {
    const sub = perfectWordsTest(words(100 + Date.now() % 1000));
    const r = await call(alice, "results", { body: sub });
    expect(r.status).toBe(201);
    expect(r.body.eligible).toBe(true);
    const again = await call(alice, "results", { body: sub });
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    const bad = perfectWordsTest(words(7));
    bad.claimed.wpm += 50;
    const t = await call(alice, "results", { body: bad });
    expect(t.status).toBe(422);
    expect(t.body.message).toMatch(/does not match/);
    const fake = perfectWordsTest([...words(8).slice(0, 9), "zzqqxx"]);
    expect((await call(alice, "results", { body: fake })).status).toBe(422);
  });

  it("keeps history private between users", async () => {
    const saved = await call(alice, "results", { body: perfectWordsTest(words(200 + (Date.now() % 1000))) });
    expect((await call(bob, `me/results/${saved.body.id}`)).status).toBe(404);
    expect((await call(alice, `me/results/${saved.body.id}`)).status).toBe(200);
    expect((await call(null, "me/results")).status).toBe(401);
  });

  it("ranks players and reports each user's rank", async () => {
    const w = words(300);
    await call(bob, "results", { body: perfectWordsTest(w, [150, 200], 3) });
    const lb = await call(null, "leaderboard?mode=words&mode2=10&language=english");
    expect(lb.status).toBe(200);
    const names = lb.body.entries.map((e: { username: string }) => e.username);
    expect(names).toContain("Alice");
    expect(names).toContain("Bob");
    expect(new Set(names).size).toBe(names.length); // one entry per player
    const wpms = lb.body.entries.map((e: { wpm: number }) => e.wpm);
    expect([...wpms].sort((a, b) => b - a)).toEqual(wpms);
    expect((await call(bob, "leaderboard/rank?mode=words&mode2=10")).body.entry.rank).toBeGreaterThan(0);
    expect((await call(null, "leaderboard?mode=time&mode2=45")).status).toBe(400);
  });

  it("does not rank punctuation tests", async () => {
    const pw = new WordGenerator({ language: "english", punctuation: true }, seededRng(9)).take(10);
    const sub = makeSubmission({ words: pw, punctuation: true }, typeText(pw.join(" "), { minGap: 90, maxGap: 160 }));
    const r = await call(alice, "results", { body: sub });
    expect(r.status).toBe(201);
    expect(r.body.eligible).toBe(false);
  });

  it("stores settings and profile fields with validation", async () => {
    expect((await call(alice, "me/preferences", { method: "PUT", body: { config: { theme: "forest", time: 60 } } })).status).toBe(200);
    expect((await call(alice, "me/preferences")).body.config.theme).toBe("forest");
    expect((await call(alice, "me/profile", { method: "PATCH", body: { avatar: "fox", country: "pk", bio: "hi" } })).status).toBe(200);
    expect((await call(alice, "me/profile", { method: "PATCH", body: { avatar: "<script>" } })).status).toBe(400);
    const pub = await call(null, "users/alice");
    expect(pub.body).toMatchObject({ username: "Alice", avatar: "fox", country: "PK", bio: "hi" });
    expect(pub.body.email).toBeUndefined();
  });

  it("multiplayer rejects unknown rooms and bad tokens", async () => {
    expect((await call(null, "mp/join", { body: { code: "ZZZZZ", name: "x" } })).status).toBe(404);
    const c = await call(null, "mp/create", { body: { settings: { language: "english", wordCount: 10 }, name: "Gina" } });
    expect(c.status).toBe(200);
    expect(c.body.state.players[0].name).toBe("Gina (guest)");
    expect((await call(null, "mp/state", { body: { code: c.body.code, token: "0".repeat(32) } })).status).toBe(403);
    expect((await call(null, "mp/create", { body: { settings: { language: "english", wordCount: 10 }, name: "<b>x</b>" } })).status).toBe(400);
  });
});
