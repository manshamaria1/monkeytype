import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Config } from "../../shared/config";
import { playError, playKey } from "../lib/sound";
import { useUi } from "../state/ui";
import { TypingSession } from "./session";
import { buildSetup, testKey, type TestSetup } from "./setup";

/** Runs the timer check for a session and keeps time-based results honest. */
export function useSessionClock(session: TypingSession | null) {
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => session.checkTime(), 50);
    const onVis = () => session.checkTime();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [session]);
}

/** Warn before leaving the page while a test is running. */
export function useLeaveGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [active]);
}

export function useKeySounds(config: Config) {
  const ref = useRef(config);
  ref.current = config;
  return useCallback((error: boolean) => {
    const c = ref.current;
    if (error && c.errorSound) playError(c.soundVolume);
    else if (c.sound !== "off") playKey(c.sound, c.soundVolume);
  }, []);
}

/** Tracks whether the session is running, for focus mode and the leave guard. */
export function useSessionActivity(session: TypingSession | null) {
  const { setTypingActive } = useUi();
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!session) return;
    const update = () => {
      const a = session.started && !session.finished;
      setActive(a);
      setTypingActive(a);
    };
    update();
    const unsub = session.subscribe(update);
    return () => {
      unsub();
      setTypingActive(false);
    };
  }, [session, setTypingActive]);
  useLeaveGuard(active);
  return active;
}

export function useTypingTest(config: Config) {
  const [request, setRequest] = useState<{ repeat: { words: string[]; quote?: TestSetup["quote"] } | null }>({ repeat: null });
  const lastQuote = useRef<string | undefined>(undefined);
  const [finished, setFinished] = useState<TypingSession | null>(null);
  const onKey = useKeySounds(config);
  const key = testKey(config);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setup = useMemo(() => buildSetup(config, request.repeat, lastQuote.current), [key, request]);
  useEffect(() => {
    if (setup.quote) lastQuote.current = setup.quote.id;
  }, [setup]);

  const session = useMemo(() => new TypingSession(setup, { onKey, onFinish: (s) => setFinished(s) }), [setup, onKey]);

  useEffect(() => setFinished(null), [session]);
  useSessionClock(session);
  useSessionActivity(session);

  const restart = useCallback(
    (sameText = false) => setRequest({ repeat: sameText ? { words: setup.words, quote: setup.quote } : null }),
    [setup],
  );

  return { session, setup, finished: finished === session ? finished : null, restart };
}
