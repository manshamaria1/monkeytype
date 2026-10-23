import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TypingEvent } from "../../shared/engine";

export interface RoomPlayer {
  seat: number;
  name: string;
  avatar: string;
  registered: boolean;
  connected: boolean;
  ready: boolean;
  host: boolean;
  progress: number;
  wpm: number;
  accuracy: number;
  finishMs: number | null;
  dnfReason: string | null;
  place: number | null;
  outcome: "win" | "loss" | "draw" | "dnf" | null;
}

export interface RoomState {
  code: string;
  state: "lobby" | "countdown" | "racing" | "finished";
  settings: { language: string; wordCount: number };
  words: string[];
  startAt: number | null;
  endReason: string | null;
  maxRaceMs: number;
  players: RoomPlayer[];
  you: number;
}

type Status = "connecting" | "open" | "reconnecting" | "closed";

const tokenKey = (code: string) => `mt.room.${code}`;

function storedToken(code: string): string | undefined {
  try {
    return sessionStorage.getItem(tokenKey(code)) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * WebSocket connection to the multiplayer server. Reconnects automatically and
 * rejoins the same seat using a per-tab token, so a refresh or brief network drop
 * does not lose your place in a race.
 */
export function useRoom(onResume: (events: TypingEvent[]) => void) {
  const [status, setStatus] = useState<Status>("connecting");
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const offsetRef = useRef(0); // serverNow - Date.now()
  const codeRef = useRef<string | null>(null);
  const pending = useRef<object[]>([]);
  const resumeRef = useRef(onResume);
  resumeRef.current = onResume;
  const closedByUs = useRef(false);

  const send = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    else pending.current.push(msg);
  }, []);

  useEffect(() => {
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    closedByUs.current = false;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setStatus("open");
        setError(null);
        ws.send(JSON.stringify({ type: "ping", t: Date.now() }));
        // Rejoin our seat after a reconnect.
        if (codeRef.current) ws.send(JSON.stringify({ type: "join", code: codeRef.current, token: storedToken(codeRef.current) }));
        for (const m of pending.current.splice(0)) ws.send(JSON.stringify(m));
        pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "ping", t: Date.now() })), 10000);
      };
      ws.onmessage = (e) => {
        let msg: { type: string; [k: string]: unknown };
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        switch (msg.type) {
          case "hello":
            setUser((msg.user as string) ?? null);
            offsetRef.current = (msg.serverNow as number) - Date.now();
            break;
          case "pong": {
            const now = Date.now();
            const rtt = now - (msg.t as number);
            offsetRef.current = (msg.serverNow as number) - (msg.t as number) - rtt / 2;
            break;
          }
          case "joined": {
            const code = msg.code as string;
            codeRef.current = code;
            try {
              sessionStorage.setItem(tokenKey(code), msg.token as string);
            } catch {
              /* ignore */
            }
            break;
          }
          case "state":
            setRoom(msg as unknown as RoomState);
            break;
          case "progress":
            setRoom((r) => (r ? { ...r, players: msg.players as RoomPlayer[] } : r));
            break;
          case "resume":
            resumeRef.current(msg.events as TypingEvent[]);
            break;
          case "error":
            setError(msg.message as string);
            break;
        }
      };
      ws.onclose = () => {
        clearInterval(pingTimer);
        if (closedByUs.current) return setStatus("closed");
        setStatus("reconnecting");
        attempt++;
        timer = setTimeout(connect, Math.min(8000, 500 * 2 ** attempt));
      };
    };
    connect();
    return () => {
      closedByUs.current = true;
      clearTimeout(timer);
      clearInterval(pingTimer);
      wsRef.current?.close();
    };
  }, []);

  /** Server time now, estimated from the measured clock offset. */
  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  const clearError = useCallback(() => setError(null), []);
  const actions = useMemo(
    () => ({
      create: (settings: RoomState["settings"], name?: string) => send({ type: "create", settings, name }),
      join: (code: string, name?: string) => send({ type: "join", code: code.toUpperCase(), name, token: storedToken(code.toUpperCase()) }),
      setReady: (ready: boolean) => send({ type: "ready", ready }),
      setSettings: (settings: RoomState["settings"]) => send({ type: "settings", settings }),
      start: () => send({ type: "start" }),
      rematch: () => send({ type: "rematch" }),
      sendEvents: (events: TypingEvent[]) => send({ type: "events", events }),
      leave: () => {
        send({ type: "leave" });
        codeRef.current = null;
        setRoom(null);
      },
    }),
    [send],
  );

  return { status, room, error, user, clearError, serverNow, ...actions };
}
