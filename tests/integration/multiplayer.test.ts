import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type pg from "pg";
import WebSocket from "ws";
import { MultiplayerHub } from "../../server/multiplayer";
import { freshDb, makeApp, newUser } from "../helpers/server";
import { typeText } from "../helpers/simulate";

let pool: pg.Pool;
let server: Server;
let hub: MultiplayerHub;
let url: string;
let cookieA: string;
let userA: { id: number; username: string };

beforeAll(async () => {
  pool = await freshDb();
  const { app } = makeApp(pool);
  server = createServer(app);
  hub = new MultiplayerHub(pool, { countdownMs: 300, maxRaceMs: 20000, reconnectGraceMs: 600, emptyRoomTtlMs: 1000, progressIntervalMs: 50 });
  hub.attach(server);
  await new Promise<void>((r) => server.listen(0, r));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
  const u = await newUser(app);
  userA = { id: u.id, username: u.username };
  const res = await u.agent.get("/api/auth/me");
  cookieA = (res.request as unknown as { cookies?: string }).cookies ?? "";
  if (!cookieA) {
    // supertest agents keep cookies in a jar; read it directly.
    const jar = (u.agent as unknown as { jar: { getCookies: (o: object) => { name: string; value: string }[] } }).jar;
    cookieA = jar
      .getCookies({ domain: "127.0.0.1", path: "/", secure: false, script: false })
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }
});

afterAll(async () => {
  hub.close();
  await new Promise((r) => server.close(r));
  await pool.end();
});

interface Msg {
  type: string;
  [k: string]: unknown;
}

/** Small test client that records messages and can wait for a matching one. */
class Client {
  ws: WebSocket;
  msgs: Msg[] = [];
  private waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
  constructor(cookie?: string) {
    this.ws = new WebSocket(url, { headers: cookie ? { cookie } : {} });
    this.ws.on("message", (d) => {
      const m = JSON.parse(d.toString()) as Msg;
      this.msgs.push(m);
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.resolve(m), false) : true));
    });
  }
  open() {
    return new Promise<void>((r) => (this.ws.readyState === WebSocket.OPEN ? r() : this.ws.once("open", () => r())));
  }
  send(m: object) {
    this.ws.send(JSON.stringify(m));
  }
  wait(pred: (m: Msg) => boolean, timeout = 5000): Promise<Msg> {
    const found = this.msgs.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timed out waiting for message; last: " + JSON.stringify(this.msgs.slice(-3)))), timeout);
      this.waiters.push({ pred, resolve: (m) => (clearTimeout(t), resolve(m)) });
    });
  }
  close() {
    this.ws.close();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("multiplayer races", () => {
  it("runs a full race: create, join, ready, start, type, finish, persist", async () => {
    const a = new Client(cookieA);
    const b = new Client();
    await Promise.all([a.open(), b.open()]);
    await a.wait((m) => m.type === "hello");
    a.send({ type: "create", settings: { language: "english", wordCount: 10 } });
    const joinedA = await a.wait((m) => m.type === "joined");
    const code = joinedA.code as string;
    expect(code).toMatch(/^[A-Z2-9]{5}$/);

    b.send({ type: "join", code, name: "Bob" });
    await b.wait((m) => m.type === "joined");
    // Host cannot start until the other player is ready.
    a.send({ type: "start" });
    expect((await a.wait((m) => m.type === "error")).message).toMatch(/ready/);
    b.send({ type: "ready", ready: true });
    await a.wait((m) => m.type === "state" && (m.players as { ready: boolean }[]).some((p) => p.ready));
    a.send({ type: "start" });
    const countdown = await b.wait((m) => m.type === "state" && m.state === "countdown");
    const words = countdown.words as string[];
    expect(words).toHaveLength(10);
    // Both players receive the same text.
    expect((await a.wait((m) => m.type === "state" && m.state === "countdown")).words).toEqual(words);
    await a.wait((m) => m.type === "state" && m.state === "racing");

    // A types faster than B. Events are timed relative to the race start.
    const text = words.join(" ");
    // ~150 wpm vs ~100 wpm (the server marks speeds above 350 wpm as implausible).
    const evA = typeText(text, { minGap: 65, maxGap: 95, seed: 1 });
    const evB = typeText(text, { minGap: 100, maxGap: 140, seed: 2 });
    const send = async (c: Client, events: typeof evA) => {
      for (let i = 0; i < events.length; i += 20) {
        c.send({ type: "events", events: events.slice(i, i + 20) });
        await sleep(10);
      }
    };
    // Wait until the server clock has passed both players' last event times.
    await sleep(Math.max(evA.at(-1)!.t, evB.at(-1)!.t) + 50);
    await Promise.all([send(a, evA), send(b, evB)]);

    const fin = await a.wait((m) => m.type === "state" && m.state === "finished");
    const players = fin.players as { name: string; outcome: string; place: number; finishMs: number; wpm: number }[];
    const pa = players.find((p) => p.name === userA.username)!;
    const pb = players.find((p) => p.name === "Bob (guest)")!;
    expect(pa).toMatchObject({ place: 1, outcome: "win" });
    expect(pb).toMatchObject({ place: 2, outcome: "loss" });
    expect(pa.finishMs).toBeLessThan(pb.finishMs);
    expect(pa.wpm).toBeGreaterThan(pb.wpm);

    // Persisted: match + participants, and the registered winner gets the achievement.
    await sleep(300);
    const m = await pool.query("SELECT outcome, user_id, guest_name FROM match_participants ORDER BY place");
    expect(m.rows).toEqual([
      { outcome: "win", user_id: userA.id, guest_name: null },
      { outcome: "loss", user_id: null, guest_name: "Bob (guest)" },
    ]);
    const ach = await pool.query("SELECT 1 FROM user_achievements WHERE user_id = $1 AND achievement_id = 'match-win'", [userA.id]);
    expect(ach.rowCount).toBe(1);

    // Rematch returns to the lobby.
    a.send({ type: "rematch" });
    await b.wait((m) => m.type === "state" && m.state === "lobby" && (m.players as unknown[]).length === 2);
    a.close();
    b.close();
  });

  it("disqualifies events from the future (clock cheating) and impossible speeds", async () => {
    const a = new Client();
    const b = new Client();
    await Promise.all([a.open(), b.open()]);
    a.send({ type: "create", settings: { language: "english", wordCount: 10 }, name: "Ann" });
    const code = (await a.wait((m) => m.type === "joined")).code as string;
    b.send({ type: "join", code, name: "Ben" });
    await b.wait((m) => m.type === "joined");
    b.send({ type: "ready", ready: true });
    await sleep(50);
    a.send({ type: "start" });
    const st = await a.wait((m) => m.type === "state" && m.state === "racing");
    const words = st.words as string[];
    // Claim to have finished 20 seconds into a race that started moments ago.
    a.send({ type: "events", events: typeText(words.join(" "), { start: 20000, minGap: 10, maxGap: 20 }) });
    // Ben claims 1 ms per keystroke: thousands of wpm.
    b.send({ type: "events", events: typeText(words.join(" "), { minGap: 1, maxGap: 1 }) });
    const fin = await a.wait((m) => m.type === "state" && m.state === "finished", 8000);
    const players = fin.players as { name: string; outcome: string; dnfReason: string | null; finishMs: number | null }[];
    expect(players.find((p) => p.name === "Ann (guest)")).toMatchObject({ outcome: "dnf", dnfReason: "clock" });
    expect(players.find((p) => p.name === "Ben (guest)")).toMatchObject({ outcome: "dnf", dnfReason: "implausible" });
    a.close();
    b.close();
  });

  it("handles disconnect and reconnect with the seat token", async () => {
    const a = new Client();
    await a.open();
    a.send({ type: "create", settings: { language: "spanish", wordCount: 10 }, name: "Cara" });
    const joined = await a.wait((m) => m.type === "joined");
    a.close();
    await sleep(100);
    const again = new Client();
    await again.open();
    again.send({ type: "join", code: joined.code, token: joined.token });
    const re = await again.wait((m) => m.type === "joined");
    expect(re).toMatchObject({ seat: joined.seat, resumed: true });
    const state = await again.wait((m) => m.type === "state" && (m.players as { connected: boolean }[])[0]?.connected === true);
    expect((state.players as unknown[]).length).toBe(1);
    again.close();
  });

  it("validates input: unknown room, bad names, bad messages, abandoned rooms are removed", async () => {
    const c = new Client();
    await c.open();
    c.send({ type: "join", code: "ZZZZZ", name: "x" });
    expect((await c.wait((m) => m.type === "error")).message).toMatch(/not found/);
    c.msgs = [];
    c.send({ type: "create", settings: { language: "english", wordCount: 10 }, name: "<script>" });
    expect((await c.wait((m) => m.type === "error")).message).toMatch(/name/i);
    c.msgs = [];
    c.ws.send("not json");
    expect((await c.wait((m) => m.type === "error")).message).toBe("Invalid message");
    c.msgs = [];
    c.send({ type: "create", settings: { language: "english", wordCount: 10 }, name: "Dee" });
    const code = (await c.wait((m) => m.type === "joined")).code as string;
    expect(hub.rooms.has(code)).toBe(true);
    c.close();
    await sleep(2500);
    expect(hub.rooms.has(code)).toBe(false);
  });
});
