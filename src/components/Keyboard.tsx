import { useSyncExternalStore } from "react";
import type { TypingSession } from "../typing/session";

const ROWS = ["`1234567890-=", "qwertyuiop[]\\", "asdfghjkl;'", "zxcvbnm,./"];
const SHIFTED: Record<string, string> = {
  "~": "`", "!": "1", "@": "2", "#": "3", $: "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0", _: "-", "+": "=",
  "{": "[", "}": "]", "|": "\\", ":": ";", '"': "'", "<": ",", ">": ".", "?": "/",
};

/** Which finger presses each key (touch typing on QWERTY). */
const FINGER: Record<string, string> = {};
const assign = (keys: string, finger: string) => [...keys].forEach((k) => (FINGER[k] = finger));
assign("`1qaz", "l-pinky");
assign("2wsx", "l-ring");
assign("3edc", "l-middle");
assign("45rtfgvb", "l-index");
assign("67yuhjnm", "r-index");
assign("8ik,", "r-middle");
assign("9ol.", "r-ring");
assign("0-=p[]\\;'/", "r-pinky");

export const FINGER_NAMES: Record<string, string> = {
  "l-pinky": "left pinky",
  "l-ring": "left ring finger",
  "l-middle": "left middle finger",
  "l-index": "left index finger",
  "r-index": "right index finger",
  "r-middle": "right middle finger",
  "r-ring": "right ring finger",
  "r-pinky": "right pinky",
  thumb: "thumb",
};

function baseKey(ch: string): { key: string; shift: boolean } {
  if (ch === " ") return { key: " ", shift: false };
  if (SHIFTED[ch]) return { key: SHIFTED[ch], shift: true };
  const lower = ch.toLowerCase();
  return { key: lower, shift: ch !== lower };
}

/** On-screen QWERTY keyboard that highlights the next key and which finger to use. */
export default function Keyboard({ session, focusKeys = "" }: { session: TypingSession; focusKeys?: string }) {
  useSyncExternalStore(session.subscribe, session.getVersion);
  const e = session.engine;
  const word = e.words[e.index] ?? [];
  const typed = e.typed[e.index]?.length ?? 0;
  const nextChar = session.finished ? "" : typed >= word.length ? " " : word[typed];
  const next = nextChar ? baseKey(nextChar) : null;
  const finger = next ? (next.key === " " ? "thumb" : FINGER[next.key]) : undefined;
  return (
    <div className="keyboard" aria-hidden="true">
      {ROWS.map((row, i) => (
        <div className="kb-row" key={i} style={{ paddingLeft: `${i * 0.6}em` }}>
          {[...row].map((k) => (
            <span
              key={k}
              className={`kb-key finger-${FINGER[k]}${next?.key === k ? " next" : ""}${focusKeys.includes(k) ? " focus" : ""}${"fj".includes(k) ? " bump" : ""}`}
            >
              {k}
            </span>
          ))}
        </div>
      ))}
      <div className="kb-row">
        <span className={`kb-key kb-shift${next?.shift ? " next" : ""}`}>shift</span>
        <span className={`kb-key kb-space${next?.key === " " ? " next" : ""}`}>space</span>
      </div>
      <p className="kb-hint">{finger ? `Next: "${nextChar === " " ? "space" : nextChar}" with your ${FINGER_NAMES[finger] ?? "finger"}${next?.shift ? " + shift (opposite pinky)" : ""}` : " "}</p>
    </div>
  );
}
