import { useEffect, useMemo, useRef, useState } from "react";
import PreviewOnly from "../components/PreviewOnly";
import { PREVIEW } from "../lib/preview";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DEFAULT_RULES, type TypingEvent } from "../../shared/engine";
import { getLanguage, LANGUAGES } from "../../shared/languages";
import TypingArea from "../components/TypingArea";
import { fmt } from "../lib/format";
import { readJson, writeJson } from "../lib/storage";
import { useAuth } from "../state/auth";
import { useConfig } from "../state/config";
import { useToast } from "../state/toast";
import { TypingSession } from "../typing/session";
import { useRoom, type RoomPlayer, type RoomState } from "../typing/useRoom";
import { usePollingRoom } from "../typing/usePollingRoom";
import { WP_BUILD } from "../lib/wp";

// WordPress hosting has no WebSockets: rooms are polled over HTTP instead.
const useRoomTransport = WP_BUILD ? usePollingRoom : useRoom;
import { useKeySounds, useSessionActivity, useSessionClock } from "../typing/useTypingTest";

function MultiplayerPageInner() {
  const { code: urlCode } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const resumeRef = useRef<(e: TypingEvent[]) => void>(() => {});
  const mp = useRoomTransport((events) => resumeRef.current(events));
  const [name, setName] = useState(() => readJson<string>("mt.guestName", ""));
  const [joinCode, setJoinCode] = useState("");
  const [language, setLanguage] = useState("english");
  const [wordCount, setWordCount] = useState(25);
  const joinedUrl = useRef<string | null>(null);

  // Keep the URL in sync with the room so it can be shared as an invite link.
  useEffect(() => {
    if (mp.room && mp.room.code !== urlCode) navigate(`/multiplayer/${mp.room.code}`, { replace: true });
  }, [mp.room, urlCode, navigate]);

  // Opening an invite link joins the room (guests need a name first).
  useEffect(() => {
    if (!urlCode || mp.status !== "open" || mp.room || joinedUrl.current === urlCode) return;
    if (!user && !name.trim()) return;
    joinedUrl.current = urlCode;
    mp.join(urlCode, name.trim() || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlCode, mp.status, mp.room, user, name, mp.join]);

  useEffect(() => {
    if (mp.error) {
      toast("error", mp.error);
      if (!mp.room && urlCode) joinedUrl.current = null;
      mp.clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mp.error, mp.clearError, toast, urlCode]);

  const guestName = () => {
    const n = name.trim();
    writeJson("mt.guestName", n);
    return n || undefined;
  };

  if (mp.room) return <Room mp={mp} room={mp.room} resumeRef={resumeRef} />;

  return (
    <div className="page">
      <h1>Multiplayer</h1>
      <p className="muted">
        Race other people on the same text in real time. Results of signed-in players are saved to their race history.
        {!user && (
          <>
            {" "}
            You are playing as a guest: <Link to="/account/login">sign in</Link> to keep your race history.
          </>
        )}
      </p>
      <ConnectionStatus status={mp.status} />
      {!user && (
        <label className="field narrow-field">
          <span>Your name (guests)</span>
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="e.g. speedy" />
        </label>
      )}
      {urlCode && !user && !name.trim() && <p className="banner">Enter a name above to join room {urlCode}.</p>}
      <div className="two-col">
        <form
          className="card form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!user && !name.trim()) return toast("error", "Enter a name first.");
            mp.create({ language, wordCount }, guestName());
          }}
        >
          <h2>Create a room</h2>
          <label className="field">
            <span>Language</span>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Words</span>
            <select value={wordCount} onChange={(e) => setWordCount(Number(e.target.value))}>
              {[10, 25, 50, 100].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <button className="btn" disabled={mp.status !== "open"} data-testid="create-room">
            create room
          </button>
        </form>
        <form
          className="card form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!user && !name.trim()) return toast("error", "Enter a name first.");
            const c = joinCode.trim().toUpperCase();
            if (c.length < 4) return toast("error", "Enter the room code.");
            joinedUrl.current = c;
            mp.join(c, guestName());
          }}
        >
          <h2>Join with a code</h2>
          <label className="field">
            <span>Room code</span>
            <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} maxLength={8} placeholder="ABCDE" autoCapitalize="characters" />
          </label>
          <button className="btn" disabled={mp.status !== "open"}>
            join room
          </button>
        </form>
      </div>
      <details className="rules">
        <summary>How races work</summary>
        <ul>
          <li>Everyone types the same text. The server starts the race at the same moment for all players after a 3-second countdown.</li>
          <li>Your keystrokes are sent to the server, which re-calculates progress and speed itself. The first to finish the text wins; equal finish times are a draw.</li>
          <li>If you disconnect, you have 30 seconds to reconnect (just reload the page). Races end after 3 minutes; unfinished players are marked as not finished.</li>
        </ul>
      </details>
    </div>
  );
}

function ConnectionStatus({ status }: { status: string }) {
  if (status === "open") return null;
  return (
    <p className={`banner${status === "closed" ? " banner-error" : ""}`} role="status">
      {status === "connecting" && "Connecting to the multiplayer server…"}
      {status === "reconnecting" && "Connection lost. Reconnecting…"}
      {status === "closed" && "Disconnected from the multiplayer server."}
    </p>
  );
}

type Mp = ReturnType<typeof useRoom>;

function Room({ mp, room, resumeRef }: { mp: Mp; room: RoomState; resumeRef: React.MutableRefObject<(e: TypingEvent[]) => void> }) {
  const { config } = useConfig();
  const toast = useToast();
  const me = room.players.find((p) => p.seat === room.you);
  const lang = getLanguage(room.settings.language);
  const onKey = useKeySounds(config);
  const buffer = useRef<TypingEvent[]>([]);
  const [now, setNow] = useState(Date.now());

  // One session per race (identified by its start time).
  const session = useMemo(() => {
    if (!room.startAt || room.words.length === 0 || room.state === "lobby") return null;
    const s = new TypingSession({ words: room.words, rules: DEFAULT_RULES }, { onKey, onEvent: (ev) => buffer.current.push(ev) });
    // Translate the server's start time into this page's performance clock.
    s.setStart(performance.now() + (room.startAt - mp.serverNow()));
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.startAt]);

  // After a reconnect the server sends back our accepted events; replay them.
  resumeRef.current = (events) => {
    if (!session || session.events.length >= events.length) return;
    for (const ev of events.slice(session.events.length)) {
      session.engine.apply(ev);
      session.events.push(ev);
    }
    session.refresh();
  };

  useSessionClock(session);
  useSessionActivity(room.state === "racing" ? session : null);

  // Send keystrokes in small batches.
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => {
      if (buffer.current.length) mp.sendEvents(buffer.current.splice(0));
    }, 100);
    return () => clearInterval(id);
  }, [session, mp.sendEvents]);

  useEffect(() => {
    if (room.state !== "countdown" && room.state !== "racing") return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [room.state]);

  const countdown = room.startAt ? Math.ceil((room.startAt - mp.serverNow()) / 1000) : 0;
  void now;
  const inviteUrl = WP_BUILD ? `${location.origin}${location.pathname}${location.search}#/multiplayer/${room.code}` : `${location.origin}/multiplayer/${room.code}`;
  const connectedCount = room.players.filter((p) => p.connected).length;
  const sorted = room.state === "finished" ? [...room.players].sort((a, b) => (a.place ?? 99) - (b.place ?? 99)) : room.players;

  return (
    <div className="page room" data-testid="room">
      <div className="page-head">
        <h1>
          Room <span className="room-code" data-testid="room-code">{room.code}</span>
        </h1>
        <span className="row-gap">
          <button
            className="btn btn-small btn-ghost"
            onClick={() =>
              navigator.clipboard
                ?.writeText(inviteUrl)
                .then(() => toast("success", "Invite link copied. Send it to the people you want to race."))
                .catch(() => toast("info", inviteUrl))
            }
          >
            copy invite link
          </button>
          <button className="btn btn-small btn-ghost" onClick={mp.leave}>
            leave room
          </button>
        </span>
      </div>
      <ConnectionStatus status={mp.status} />
      <p className="muted small">
        {lang.name} · {room.settings.wordCount} words · {room.players.length} player{room.players.length === 1 ? "" : "s"}
      </p>

      <ol className="race-track" aria-label="Players">
        {sorted.map((p) => (
          <PlayerRow key={p.seat} p={p} you={p.seat === room.you} state={room.state} />
        ))}
      </ol>

      {room.state === "lobby" && me && (
        <div className="lobby-actions">
          {me.host ? (
            <>
              <HostSettings room={room} mp={mp} />
              <button className="btn" onClick={mp.start} disabled={connectedCount < 2} data-testid="start-race">
                start race
              </button>
              {connectedCount < 2 && <p className="muted small">Waiting for at least one more player. Share the invite link or code.</p>}
            </>
          ) : (
            <button className="btn" onClick={() => mp.setReady(!me.ready)} data-testid="ready">
              {me.ready ? "not ready" : "I'm ready"}
            </button>
          )}
        </div>
      )}

      {(room.state === "countdown" || room.state === "racing") && session && (
        <div className="race">
          {countdown > 0 && (
            <div className="countdown" aria-live="assertive" data-testid="countdown">
              {countdown}
            </div>
          )}
          <TypingArea key={room.startAt} session={session} config={config} dir={lang.dir} disabled={countdown > 0} autoFocus={countdown <= 0} />
          {session.finished && <p className="center muted">Finished! Waiting for the other players…</p>}
        </div>
      )}

      {room.state === "finished" && (
        <div className="race-results" data-testid="race-results">
          <h2>{me?.outcome === "win" ? "🏆 You won!" : me?.outcome === "draw" ? "🤝 Draw!" : me?.outcome === "dnf" ? "Not finished" : `You placed #${me?.place}`}</h2>
          {room.endReason === "timeout" && <p className="muted">The race reached its time limit.</p>}
          {me?.host ? (
            <button className="btn" onClick={mp.rematch} data-testid="rematch">
              race again
            </button>
          ) : (
            <p className="muted">Waiting for the host to start another race.</p>
          )}
        </div>
      )}
    </div>
  );
}

function PlayerRow({ p, you, state }: { p: RoomPlayer; you: boolean; state: RoomState["state"] }) {
  return (
    <li className={`racer${you ? " you" : ""}${p.connected ? "" : " offline"}`}>
      <div className="racer-name">
        <span aria-hidden="true">{p.avatar}</span> {p.name}
        {you && " (you)"}
        {p.host && <span className="tag">host</span>}
        {!p.connected && <span className="tag tag-err">disconnected</span>}
        {state === "lobby" && !p.host && <span className={`tag${p.ready ? " tag-win" : ""}`}>{p.ready ? "ready" : "not ready"}</span>}
      </div>
      {state !== "lobby" && (
        <>
          <div className="racer-bar" role="progressbar" aria-valuenow={Math.round(p.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${p.name} progress`}>
            <div style={{ width: `${p.progress * 100}%` }} />
          </div>
          <div className="racer-stats">
            {fmt(p.wpm)} wpm
            {state === "finished" && (
              <>
                {" "}
                · {fmt(p.accuracy)}% · <span className={`tag tag-${p.outcome}`}>{p.outcome === "dnf" ? "not finished" : `#${p.place} ${p.outcome}`}</span>
                {p.finishMs !== null && !p.dnfReason && <span className="muted"> {(p.finishMs / 1000).toFixed(2)}s</span>}
              </>
            )}
          </div>
        </>
      )}
    </li>
  );
}

function HostSettings({ room, mp }: { room: RoomState; mp: Mp }) {
  return (
    <div className="row-gap">
      <label className="field-inline">
        <span>language</span>
        <select value={room.settings.language} onChange={(e) => mp.setSettings({ ...room.settings, language: e.target.value })}>
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field-inline">
        <span>words</span>
        <select value={room.settings.wordCount} onChange={(e) => mp.setSettings({ ...room.settings, wordCount: Number(e.target.value) })}>
          {[10, 25, 50, 100].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

export default function MultiplayerPage() {
  if (PREVIEW) return <PreviewOnly feature="Multiplayer" />;
  return <MultiplayerPageInner />;
}
