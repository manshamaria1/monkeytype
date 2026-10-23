/** Keystroke sounds synthesised with Web Audio (no audio files to load). */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, ms: number, type: OscillatorType, volume: number) {
  const a = audio();
  if (!a || volume <= 0) return;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const now = a.currentTime;
  gain.gain.setValueAtTime(volume * 0.25, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + ms / 1000);
  osc.connect(gain).connect(a.destination);
  osc.start(now);
  osc.stop(now + ms / 1000 + 0.01);
}

export type SoundKind = "off" | "click" | "beep" | "pop";

export function playKey(kind: SoundKind, volume: number) {
  switch (kind) {
    case "click":
      return tone(1800 + Math.random() * 300, 18, "square", volume * 0.5);
    case "beep":
      return tone(880, 45, "sine", volume);
    case "pop":
      return tone(420 + Math.random() * 60, 60, "triangle", volume);
  }
}

export function playError(volume: number) {
  tone(160, 110, "sawtooth", volume * 0.6);
}
