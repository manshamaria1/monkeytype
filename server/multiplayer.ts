import { randomBytes } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type pg from "pg";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { TypingEngine, type TypingEvent } from "../shared/engine";
import { eventSchema } from "../shared/results";
import { isLanguage } from "../shared/languages";
import { WordGenerator } from "../shared/words";
import { readCookie, SESSION_COOKIE, userFromToken } from "./auth";
import { tx } from "./db";
import { updateAchievements } from "./services/results";
import { avatarEmoji } from "../shared/avatars";

/**
 * Real-time races over WebSockets.
 *
 * The server is the source of truth: it generates the text, decides when the race
 * starts, replays every player's keystroke events through the same TypingEngine as
 * single-player tests, and computes progress, speed, finish order and outcomes.
 * Clients only send keystroke events. Event timestamps are clamped to what the
 * server's clock allows, so a client cannot claim to have finished earlier than the
 * server could have observed.
 */

export interface HubOptions {
  countdownMs: number;
  maxRaceMs: number;
  reconnectGraceMs: number;
  emptyRoomTtlMs: number;
  progressIntervalMs: number;
}

const DEFAULTS: HubOptions = {
  countdownMs: 3000,
  maxRaceMs: 180_000,
  reconnectGraceMs: 30_000,
  emptyRoomTtlMs: 60_000,
  progressIntervalMs: 200,
};

const MAX_PLAYERS = 8;
/** Accept events up to this far ahead of the server clock (clock skew + jitter). */
const AHEAD_TOLERANCE_MS = 1500;
/** Events that arrive later than this are re-timed to (server elapsed - this). */
const BEHIND_TOLERANCE_MS = 3000;
const MAX_PLAUSIBLE_WPM = 350;

const settingsSchema = z.object({
  language: z.string().max(40).refine(isLanguage, "Unknown language"),
  wordCount: z.number().int().min(10).max(100),
});
type RoomSettings = z.infer<typeof settingsSchema>;

const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[\p{L}\p{N}_ .-]+$/u);

const clientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create"), settings: settingsSchema, name: z.string().optional() }),
  z.object({ type: z.literal("join"), code: z.string().max(10), name: z.string().optional(), token: z.string().max(64).optional() }),
  z.object({ type: z.literal("settings"), settings: settingsSchema }),
  z.object({ type: z.literal("ready"), ready: z.boolean() }),
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("rematch") }),
  z.object({ type: z.literal("events"), events: z.array(eventSchema).max(500) }),
  z.object({ type: z.literal("leave") }),
  z.object({ type: z.literal("ping"), t: z.number() }),
]);

type Outcome = "win" | "loss" | "draw" | "dnf";

interface Player {
  seat: number;
  userId: number | null;
  name: string;
  avatar: string;
  token: string;
  ws: WebSocket | null;
  connected: boolean;
  disconnectedAt: number | null;
  ready: boolean;
  engine: TypingEngine | null;
  events: TypingEvent[];
  finishMs: number | null;
  dnfReason: string | null;
  place: number | null;
  outcome: Outcome | null;
}

type RoomState = "lobby" | "countdown" | "racing" | "finished";

interface Room {
  code: string;
  dbId: number | null;
  hostSeat: number;
  settings: RoomSettings;
  state: RoomState;
  players: Player[];
  nextSeat: number;
  words: string[];
  startAt: number | null;
  endedAt: number | null;
  endReason: string | null;
  timers: NodeJS.Timeout[];
  progressTimer: NodeJS.Timeout | null;
  emptySince: number | null;
  dirty: boolean;
}

interface Conn {
  ws: WebSocket;
  userId: number | null;
  username: string | null;
  avatar: string;
  room: Room | null;
  player: Player | null;
  msgCount: number;
  msgWindow: number;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class MultiplayerHub {
  readonly opts: HubOptions;
  readonly rooms = new Map<string, Room>();
  private wss: WebSocketServer;
  private sweeper: NodeJS.Timeout;

  constructor(
    private db: pg.Pool,
    opts: Partial<HubOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
    this.sweeper = setInterval(() => this.sweep(), 1000);
    this.sweeper.unref();
  }

  attach(server: Server) {
    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname !== "/ws") return socket.destroy();
      this.wss.handleUpgrade(req, socket, head, (ws) => void this.onConnection(ws, req));
    });
  }

  close() {
    clearInterval(this.sweeper);
    for (const room of this.rooms.values()) this.clearTimers(room);
    for (const client of this.wss.clients) client.terminate();
    this.wss.close();
  }

  private async onConnection(ws: WebSocket, req: IncomingMessage) {
    const conn: Conn = { ws, userId: null, username: null, avatar: "monkey", room: null, player: null, msgCount: 0, msgWindow: Date.now() };
    // Buffer messages that arrive while the session lookup is running.
    const early: string[] = [];
    let ready = false;
    ws.on("message", (data) => {
      const text = data.toString();
      if (!ready) early.push(text);
      else this.onMessage(conn, text);
    });
    ws.on("close", () => this.onClose(conn));
    ws.on("error", () => {});
    try {
      const user = await userFromToken(this.db, readCookie(req.headers.cookie, SESSION_COOKIE));
      if (user) {
        conn.userId = user.id;
        conn.username = user.username;
        const { rows } = await this.db.query(`SELECT avatar FROM profiles WHERE user_id = $1`, [user.id]);
        conn.avatar = rows[0]?.avatar ?? "monkey";
      }
    } catch (e) {
      console.error("ws auth failed", e);
    }
    ready = true;
    this.send(ws, { type: "hello", user: conn.username, serverNow: Date.now() });
    for (const m of early) this.onMessage(conn, m);
  }

  private send(ws: WebSocket | null, msg: unknown) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  private error(conn: Conn, message: string) {
    this.send(conn.ws, { type: "error", message });
  }

  private onMessage(conn: Conn, text: string) {
    const now = Date.now();
    if (now - conn.msgWindow > 1000) {
      conn.msgWindow = now;
      conn.msgCount = 0;
    }
    if (++conn.msgCount > 60) return this.error(conn, "Too many messages");
    let parsed;
    try {
      parsed = clientMessage.safeParse(JSON.parse(text));
    } catch {
      return this.error(conn, "Invalid message");
    }
    if (!parsed.success) return this.error(conn, "Invalid message");
    const msg = parsed.data;
    switch (msg.type) {
      case "ping":
        return this.send(conn.ws, { type: "pong", t: msg.t, serverNow: Date.now() });
      case "create":
        return this.create(conn, msg.settings, msg.name);
      case "join":
        return this.join(conn, msg.code.toUpperCase(), msg.name, msg.token);
      case "leave":
        return this.leave(conn);
    }
    const room = conn.room;
    const player = conn.player;
    if (!room || !player) return this.error(conn, "Join a room first");
    switch (msg.type) {
      case "settings":
        if (player.seat !== room.hostSeat) return this.error(conn, "Only the host can change settings");
        if (room.state !== "lobby" && room.state !== "finished") return this.error(conn, "Settings are locked during a race");
        room.settings = msg.settings;
        for (const p of room.players) p.ready = false;
        return this.broadcastState(room);
      case "ready":
        if (room.state !== "lobby") return;
        player.ready = msg.ready;
        return this.broadcastState(room);
      case "start":
        return this.start(conn, room, player);
      case "rematch":
        if (player.seat !== room.hostSeat) return this.error(conn, "Only the host can start a rematch");
        if (room.state !== "finished") return;
        this.resetToLobby(room);
        return this.broadcastState(room);
      case "events":
        return this.onEvents(room, player, msg.events);
    }
  }

  private newCode(): string {
    for (;;) {
      const bytes = randomBytes(5);
      let code = "";
      for (const b of bytes) code += CODE_CHARS[b % CODE_CHARS.length];
      if (!this.rooms.has(code)) return code;
    }
  }

  private displayName(conn: Conn, requested?: string): string | null {
    if (conn.username) return conn.username;
    const parsed = nameSchema.safeParse(requested ?? "");
    return parsed.success ? `${parsed.data} (guest)` : null;
  }

  private create(conn: Conn, settings: RoomSettings, name?: string) {
    if (conn.room) this.leave(conn);
    const display = this.displayName(conn, name);
    if (!display) return this.error(conn, "Enter a name (letters and numbers, up to 20 characters)");
    const room: Room = {
      code: this.newCode(),
      dbId: null,
      hostSeat: 0,
      settings,
      state: "lobby",
      players: [],
      nextSeat: 0,
      words: [],
      startAt: null,
      endedAt: null,
      endReason: null,
      timers: [],
      progressTimer: null,
      emptySince: null,
      dirty: false,
    };
    this.rooms.set(room.code, room);
    this.db
      .query(`INSERT INTO rooms (code, host_user_id, settings) VALUES ($1, $2, $3) RETURNING id`, [room.code, conn.userId, JSON.stringify(settings)])
      .then((r) => (room.dbId = r.rows[0].id))
      .catch((e) => console.error("room insert failed", e));
    this.addPlayer(conn, room, display);
  }

  private addPlayer(conn: Conn, room: Room, display: string) {
    const player: Player = {
      seat: room.nextSeat++,
      userId: conn.userId,
      name: display,
      avatar: conn.avatar,
      token: randomBytes(16).toString("hex"),
      ws: conn.ws,
      connected: true,
      disconnectedAt: null,
      ready: false,
      engine: null,
      events: [],
      finishMs: null,
      dnfReason: null,
      place: null,
      outcome: null,
    };
    room.players.push(player);
    if (room.players.length === 1) room.hostSeat = player.seat;
    conn.room = room;
    conn.player = player;
    room.emptySince = null;
    this.send(conn.ws, { type: "joined", code: room.code, seat: player.seat, token: player.token });
    this.broadcastState(room);
  }

  private join(conn: Conn, code: string, name?: string, token?: string) {
    const room = this.rooms.get(code);
    if (!room) return this.error(conn, "Room not found. Check the code and try again.");
    // Reconnect to an existing seat.
    const existing = token ? room.players.find((p) => p.token === token) : undefined;
    if (existing) {
      if (conn.room && conn.room !== room) this.leave(conn);
      if (existing.ws && existing.ws !== conn.ws) existing.ws.close(4000, "Replaced by a new connection");
      existing.ws = conn.ws;
      existing.connected = true;
      existing.disconnectedAt = null;
      conn.room = room;
      conn.player = existing;
      room.emptySince = null;
      this.send(conn.ws, { type: "joined", code: room.code, seat: existing.seat, token: existing.token, resumed: true });
      if (room.state === "racing" || room.state === "countdown") {
        this.send(conn.ws, { type: "resume", events: existing.events });
      }
      return this.broadcastState(room);
    }
    if (conn.room === room) return this.broadcastState(room);
    if (room.state !== "lobby" && room.state !== "finished") return this.error(conn, "This race has already started. Wait for it to finish.");
    if (room.players.length >= MAX_PLAYERS) return this.error(conn, "This room is full.");
    if (conn.userId && room.players.some((p) => p.userId === conn.userId)) {
      return this.error(conn, "You are already in this room in another tab.");
    }
    const display = this.displayName(conn, name);
    if (!display) return this.error(conn, "Enter a name (letters and numbers, up to 20 characters)");
    if (conn.room) this.leave(conn);
    this.addPlayer(conn, room, display);
  }

  private leave(conn: Conn) {
    const room = conn.room;
    const player = conn.player;
    conn.room = null;
    conn.player = null;
    if (!room || !player) return;
    if (room.state === "racing" || room.state === "countdown") {
      // Leaving mid-race counts as not finishing.
      player.connected = false;
      player.ws = null;
      player.disconnectedAt = Date.now() - this.opts.reconnectGraceMs;
      if (!player.finishMs) player.dnfReason = "left";
      this.checkRaceEnd(room);
    } else {
      room.players = room.players.filter((p) => p !== player);
    }
    this.reassignHost(room);
    this.broadcastState(room);
  }

  private onClose(conn: Conn) {
    const player = conn.player;
    const room = conn.room;
    if (!player || !room || player.ws !== conn.ws) return;
    player.connected = false;
    player.ws = null;
    player.disconnectedAt = Date.now();
    this.reassignHost(room);
    this.broadcastState(room);
  }

  private reassignHost(room: Room) {
    const host = room.players.find((p) => p.seat === room.hostSeat);
    if (host && host.connected) return;
    const next = room.players.find((p) => p.connected);
    if (next) room.hostSeat = next.seat;
  }

  private start(conn: Conn, room: Room, player: Player) {
    if (player.seat !== room.hostSeat) return this.error(conn, "Only the host can start the race");
    if (room.state !== "lobby") return this.error(conn, "The race has already started");
    const active = room.players.filter((p) => p.connected);
    if (active.length < 2) return this.error(conn, "At least two players are needed to start a race");
    const notReady = active.filter((p) => !p.ready && p.seat !== room.hostSeat);
    if (notReady.length) return this.error(conn, `Waiting for ${notReady.map((p) => p.name).join(", ")} to be ready`);
    // Players who are disconnected at the start do not take part.
    room.players = active;
    room.words = new WordGenerator({ language: room.settings.language, wordListSize: "medium" }).take(room.settings.wordCount);
    room.startAt = Date.now() + this.opts.countdownMs;
    room.state = "countdown";
    for (const p of room.players) {
      p.engine = new TypingEngine(room.words, { bounded: true });
      p.events = [];
      p.finishMs = null;
      p.dnfReason = null;
      p.place = null;
      p.outcome = null;
    }
    room.timers.push(
      setTimeout(() => {
        room.state = "racing";
        this.broadcastState(room);
        room.progressTimer = setInterval(() => this.broadcastProgress(room), this.opts.progressIntervalMs);
      }, this.opts.countdownMs),
    );
    room.timers.push(setTimeout(() => this.endRace(room, "timeout"), this.opts.countdownMs + this.opts.maxRaceMs));
    this.broadcastState(room);
  }

  private onEvents(room: Room, player: Player, events: TypingEvent[]) {
    if ((room.state !== "racing" && room.state !== "countdown") || !player.engine || player.engine.finished || player.dnfReason) return;
    const elapsed = Date.now() - (room.startAt ?? 0);
    for (const raw of events) {
      if (raw.t > elapsed + AHEAD_TOLERANCE_MS) {
        player.dnfReason = "clock";
        break;
      }
      const ev = { ...raw, t: Math.max(raw.t, elapsed - BEHIND_TOLERANCE_MS) } as TypingEvent;
      player.engine.apply(ev);
      player.events.push(ev);
      if (player.engine.finished) break;
    }
    const engine = player.engine;
    if (engine.finished) {
      const stats = engine.stats();
      if (stats.wpm > MAX_PLAUSIBLE_WPM) player.dnfReason = "implausible";
      else if (engine.failed) player.dnfReason = "failed";
      else player.finishMs = Math.round(engine.endT ?? elapsed);
    }
    room.dirty = true;
    this.checkRaceEnd(room);
  }

  private isDone(room: Room, p: Player): boolean {
    if (p.finishMs !== null || p.dnfReason) return true;
    if (!p.connected && p.disconnectedAt !== null && Date.now() - p.disconnectedAt >= this.opts.reconnectGraceMs) return true;
    return false;
  }

  private checkRaceEnd(room: Room) {
    if (room.state !== "racing" && room.state !== "countdown") return;
    if (room.players.every((p) => this.isDone(room, p))) this.endRace(room, "all-finished");
  }

  /** Assign places and outcomes. Exported for unit tests via computeOutcomes. */
  private endRace(room: Room, reason: string) {
    if (room.state !== "racing" && room.state !== "countdown") return;
    this.clearTimers(room);
    room.state = "finished";
    room.endedAt = Date.now();
    room.endReason = reason;
    const elapsed = room.endedAt - (room.startAt ?? room.endedAt);
    for (const p of room.players) {
      if (p.engine && !p.engine.finished) p.engine.finish(Math.max(elapsed, p.engine.lastT));
    }
    computeOutcomes(
      room.players.map((p) => ({
        p,
        finishMs: p.dnfReason ? null : p.finishMs,
        progress: p.engine?.progress() ?? 0,
        wpm: p.engine?.stats().wpm ?? 0,
      })),
    ).forEach(({ p, place, outcome }) => {
      p.place = place;
      p.outcome = outcome;
    });
    this.broadcastState(room);
    void this.persist(room);
  }

  private async persist(room: Room) {
    try {
      if (!room.dbId) {
        const r = await this.db.query(`INSERT INTO rooms (code, settings) VALUES ($1, $2) RETURNING id`, [room.code, JSON.stringify(room.settings)]);
        room.dbId = r.rows[0].id;
      }
      await tx(this.db, async (c) => {
        const m = await c.query(
          `INSERT INTO matches (room_id, language, words, started_at, ended_at, end_reason) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [room.dbId, room.settings.language, JSON.stringify(room.words), new Date(room.startAt!), new Date(room.endedAt!), room.endReason],
        );
        for (const p of room.players) {
          const s = p.engine?.stats();
          await c.query(
            `INSERT INTO match_participants (match_id, seat, user_id, guest_name, place, outcome, finished, finish_ms, wpm, accuracy, progress)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [m.rows[0].id, p.seat, p.userId, p.userId ? null : p.name, p.place, p.outcome, p.finishMs !== null && !p.dnfReason, p.finishMs, s?.wpm ?? 0, s?.accuracy ?? 0, p.engine?.progress() ?? 0],
          );
        }
        for (const p of room.players) if (p.userId) await updateAchievements(c, p.userId);
      });
    } catch (e) {
      console.error("failed to save match", e);
    }
  }

  private resetToLobby(room: Room) {
    room.state = "lobby";
    room.words = [];
    room.startAt = null;
    room.endedAt = null;
    room.endReason = null;
    room.players = room.players.filter((p) => p.connected);
    for (const p of room.players) {
      p.ready = false;
      p.engine = null;
      p.events = [];
      p.finishMs = null;
      p.dnfReason = null;
      p.place = null;
      p.outcome = null;
    }
    this.reassignHost(room);
  }

  private clearTimers(room: Room) {
    for (const t of room.timers) clearTimeout(t);
    room.timers = [];
    if (room.progressTimer) clearInterval(room.progressTimer);
    room.progressTimer = null;
  }

  private playerView(room: Room, p: Player) {
    const stats = p.engine?.stats();
    return {
      seat: p.seat,
      name: p.name,
      avatar: avatarEmoji(p.avatar),
      registered: p.userId !== null,
      connected: p.connected,
      ready: p.ready,
      host: p.seat === room.hostSeat,
      progress: p.engine?.progress() ?? 0,
      wpm: stats?.wpm ?? 0,
      accuracy: stats?.accuracy ?? 0,
      finishMs: p.finishMs,
      dnfReason: p.dnfReason,
      place: p.place,
      outcome: p.outcome,
    };
  }

  private broadcastState(room: Room) {
    const base = {
      type: "state",
      code: room.code,
      state: room.state,
      settings: room.settings,
      words: room.state === "lobby" ? [] : room.words,
      startAt: room.startAt,
      endReason: room.endReason,
      maxRaceMs: this.opts.maxRaceMs,
      players: room.players.map((p) => this.playerView(room, p)),
    };
    for (const p of room.players) this.send(p.ws, { ...base, you: p.seat, serverNow: Date.now() });
    room.dirty = false;
  }

  private broadcastProgress(room: Room) {
    this.checkRaceEnd(room);
    if (room.state !== "racing" || !room.dirty) return;
    room.dirty = false;
    const msg = { type: "progress", players: room.players.map((p) => this.playerView(room, p)), serverNow: Date.now() };
    for (const p of room.players) this.send(p.ws, msg);
  }

  /** Periodic cleanup: drop stale lobby seats and abandoned rooms. */
  private sweep() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (room.state === "racing") this.checkRaceEnd(room);
      if (room.state === "lobby" || room.state === "finished") {
        const before = room.players.length;
        room.players = room.players.filter(
          (p) => p.connected || p.disconnectedAt === null || now - p.disconnectedAt < this.opts.reconnectGraceMs,
        );
        if (room.players.length !== before) {
          this.reassignHost(room);
          this.broadcastState(room);
        }
      }
      const anyone = room.players.some((p) => p.connected);
      if (anyone) room.emptySince = null;
      else if (room.emptySince === null) room.emptySince = now;
      else if (now - room.emptySince >= this.opts.emptyRoomTtlMs) {
        if (room.state === "racing" || room.state === "countdown") this.endRace(room, "abandoned");
        this.clearTimers(room);
        this.rooms.delete(room.code);
        if (room.dbId) this.db.query(`UPDATE rooms SET closed_at = now() WHERE id = $1`, [room.dbId]).catch(() => {});
      }
    }
  }
}

/**
 * Places: finishers by finish time (equal times share a place), then non-finishers by
 * progress. Outcomes: a sole first place wins, a shared first place is a draw, other
 * finishers lose, and anyone who did not finish gets "dnf".
 */
export function computeOutcomes<T extends { finishMs: number | null; progress: number; wpm: number }>(
  entries: T[],
): (T & { place: number; outcome: Outcome })[] {
  const finished = entries.filter((e) => e.finishMs !== null).sort((a, b) => a.finishMs! - b.finishMs!);
  const unfinished = entries.filter((e) => e.finishMs === null).sort((a, b) => b.progress - a.progress || b.wpm - a.wpm);
  const out: (T & { place: number; outcome: Outcome })[] = [];
  let place = 0;
  finished.forEach((e, i) => {
    if (i === 0 || e.finishMs !== finished[i - 1].finishMs) place = i + 1;
    out.push({ ...e, place, outcome: "loss" });
  });
  const firstCount = out.filter((e) => e.place === 1).length;
  for (const e of out) if (e.place === 1) e.outcome = firstCount > 1 ? "draw" : "win";
  unfinished.forEach((e, i) => out.push({ ...e, place: finished.length + i + 1, outcome: "dnf" }));
  return out;
}
