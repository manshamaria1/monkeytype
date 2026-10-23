import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TypingEvent } from "../../shared/engine";
import { api, ApiError } from "../lib/api";
import { WP } from "../lib/wp";
import type { RoomState } from "./useRoom";

type Status = "connecting" | "open" | "reconnecting" | "closed";

interface MpResponse {
  state?: RoomState & { serverNow: number; yourEvents?: TypingEvent[] };
  accepted?: number;
  code?: string;
  token?: string;
  resumed?: boolean;
}

const tokenKey = (code: string) => `mt.room.${code}`;
function storedToken(code: string): string | undefined {
  try {
    return sessionStorage.getItem(tokenKey(code)) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Multiplayer over plain HTTP for WordPress hosting (no WebSockets): the browser polls the
 * room about twice a second during a race and sends its keystrokes in small batches.
 * Same interface as useRoom, so the race screens are shared.
 */
export function usePollingRoom(onResume: (events: TypingEvent[]) => void) {
  const [status, setStatus] = useState<Status>("open");
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const offsetRef = useRef(0);
  // Full keystroke log of the current race and how much of it the server has confirmed.
  const log = useRef<TypingEvent[]>([]);
  const acked = useRef(0);
  const raceStart = useRef<number | null>(null);
  const resumeRef = useRef(onResume);
  resumeRef.current = onResume;
  const stateRef = useRef<RoomState["state"] | null>(null);

  const call = useCallback(async (op: string, body: Record<string, unknown>): Promise<MpResponse | null> => {
    const t0 = Date.now();
    try {
      const r = await api<MpResponse>(`/api/mp/${op}`, { body });
      const t1 = Date.now();
      setStatus("open");
      if (r.code && r.token) {
        codeRef.current = r.code;
        tokenRef.current = r.token;
        try {
          sessionStorage.setItem(tokenKey(r.code), r.token);
        } catch {
          /* ignore */
        }
      }
      if (typeof r.accepted === "number") acked.current = Math.min(r.accepted, log.current.length);
      if (r.state) {
        if (r.state.startAt !== raceStart.current) {
          // A new race (or back to the lobby): start a fresh log.
          raceStart.current = r.state.startAt;
          log.current = r.resumed && r.state.yourEvents ? [...r.state.yourEvents] : [];
          acked.current = log.current.length;
        }
        offsetRef.current = r.state.serverNow - (t0 + t1) / 2;
        stateRef.current = r.state.state;
        setRoom(r.state.you >= 0 ? r.state : null);
        if (r.resumed && r.state.yourEvents) resumeRef.current(r.state.yourEvents);
      }
      return r;
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 0 || err.status >= 500) setStatus("reconnecting");
      else {
        setError(err.message);
        // The room is gone or we were removed from it.
        if ((err.status === 404 || err.status === 403) && op !== "join" && op !== "create") {
          codeRef.current = tokenRef.current = null;
          setRoom(null);
        }
      }
      return null;
    }
  }, []);

  // Poll loop: faster during a race; sends queued keystrokes with the poll.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (stop) return;
      const code = codeRef.current;
      const token = tokenRef.current;
      if (code && token) {
        if (log.current.length > acked.current) {
          // Safe to retry: the server skips events it already has.
          const from = acked.current;
          await call("events", { code, token, from, events: log.current.slice(from, from + 400) });
        } else {
          await call("state", { code, token });
        }
      }
      const racing = stateRef.current === "racing" || stateRef.current === "countdown";
      timer = setTimeout(loop, racing ? 400 : 1500);
    };
    void loop();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [call]);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);
  const clearError = useCallback(() => setError(null), []);
  const action = useCallback(
    (a: string, extra: Record<string, unknown> = {}) => {
      if (codeRef.current && tokenRef.current) void call("action", { code: codeRef.current, token: tokenRef.current, action: a, ...extra });
    },
    [call],
  );

  const actions = useMemo(
    () => ({
      create: (settings: RoomState["settings"], name?: string) => void call("create", { settings, name }),
      join: (code: string, name?: string) => {
        const c = code.toUpperCase();
        void call("join", { code: c, name, token: storedToken(c) });
      },
      setReady: (ready: boolean) => action("ready", { ready }),
      setSettings: (settings: RoomState["settings"]) => action("settings", { settings }),
      start: () => action("start"),
      rematch: () => action("rematch"),
      sendEvents: (events: TypingEvent[]) => {
        log.current.push(...events);
      },
      leave: () => {
        action("leave");
        codeRef.current = tokenRef.current = null;
        setRoom(null);
      },
    }),
    [call, action],
  );

  return { status, room, error, user: WP?.user?.username ?? null, clearError, serverNow, ...actions };
}
