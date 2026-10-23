import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { DEFAULT_CONFIG, FONTS, fontCss, sanitizeConfig, type Config } from "../../shared/config";
import { getTheme } from "../../shared/themes";
import { api } from "../lib/api";
import { readJson, writeJson } from "../lib/storage";
import { useAuth } from "./auth";

const KEY = "mt.config";
/** When settings were last changed on this device (ms since epoch). */
const CHANGED_KEY = "mt.configChangedAt";

export type SyncStatus = "local" | "syncing" | "synced" | "error";

interface ConfigState {
  config: Config;
  set: <K extends keyof Config>(key: K, value: Config[K]) => void;
  update: (patch: Partial<Config>) => void;
  replace: (c: Config) => void;
  reset: () => void;
  sync: SyncStatus;
  /** Temporarily preview a theme without saving it (theme picker hover). */
  previewTheme: (id: string | null) => void;
}

const Ctx = createContext<ConfigState>(null as unknown as ConfigState);

/** Apply theme colours and typography as CSS custom properties on <html>. */
export function applyAppearance(config: Config, themeOverride?: string | null) {
  const theme = getTheme(themeOverride ?? config.theme, config.customTheme);
  const root = document.documentElement;
  const vars: Record<string, string> = {
    "--bg": theme.bg,
    "--main": theme.main,
    "--caret": theme.caret,
    "--sub": theme.sub,
    "--sub-alt": theme.subAlt,
    "--text": theme.text,
    "--error": theme.error,
    "--error-extra": theme.errorExtra,
    "--font": fontCss(config.fontFamily),
    "--font-size": `${config.fontSize}rem`,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.colorScheme = theme.dark ? "dark" : "light";
  root.dataset.theme = theme.dark ? "dark" : "light";
  const reduce =
    config.reducedMotion === "on" || (config.reducedMotion === "system" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  root.dataset.reducedMotion = reduce ? "true" : "false";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme.bg);
  loadFont(config.fontFamily);
}

const loadedFonts = new Set<string>();
function loadFont(id: string) {
  const font = FONTS.find((f) => f.id === id);
  if (!font?.google || loadedFonts.has(id)) return;
  loadedFonts.add(id);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
  document.head.appendChild(link);
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [config, setConfig] = useState<Config>(() => sanitizeConfig(readJson(KEY, DEFAULT_CONFIG)));
  const [preview, setPreview] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncStatus>("local");
  /** The user whose server settings have been loaded (uploads wait for this). */
  const loadedFor = useRef<number | null>(null);
  const requestedFor = useRef<number | null>(null);
  const skipNextUpload = useRef(false);

  useLayoutEffect(() => applyAppearance(config, preview), [config, preview]);

  // Persist locally. Changes that came from the server do not bump the local change time.
  const fromServer = useRef(false);
  const didMount = useRef(false);
  useEffect(() => {
    writeJson(KEY, config);
    if (fromServer.current) fromServer.current = false;
    else if (didMount.current) writeJson(CHANGED_KEY, Date.now());
    didMount.current = true;
  }, [config]);

  // On sign-in: the account's saved settings win; if it has none, upload this device's.
  useEffect(() => {
    if (!user) {
      loadedFor.current = null;
      requestedFor.current = null;
      setSync("local");
      return;
    }
    if (requestedFor.current === user.id) return;
    requestedFor.current = user.id;
    setSync("syncing");
    api<{ config: Config | null; updatedAt?: string }>("/api/me/preferences")
      .then(async (r) => {
        const localChanged = readJson<number>(CHANGED_KEY, 0);
        const serverChanged = r.updatedAt ? Date.parse(r.updatedAt) : 0;
        if (r.config && serverChanged >= localChanged) {
          // The account's settings are newer than this device's.
          skipNextUpload.current = true;
          fromServer.current = true;
          setConfig(sanitizeConfig(r.config));
        } else {
          await api("/api/me/preferences", { method: "PUT", body: { config } });
        }
        loadedFor.current = user.id;
        setSync("synced");
      })
      .catch(() => {
        loadedFor.current = user.id;
        setSync("error");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Upload changes (debounced) while signed in.
  useEffect(() => {
    if (!user || loadedFor.current !== user.id) return;
    if (skipNextUpload.current) {
      skipNextUpload.current = false;
      return;
    }
    setSync("syncing");
    let sent = false;
    const upload = (keepalive: boolean) => {
      if (sent) return;
      sent = true;
      if (keepalive) {
        // The page is going away: send without waiting for a response.
        void fetch("/api/me/preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config }),
          keepalive: true,
          credentials: "same-origin",
        }).catch(() => {});
        return;
      }
      api("/api/me/preferences", { method: "PUT", body: { config } })
        .then(() => setSync("synced"))
        .catch(() => setSync("error"));
    };
    const t = setTimeout(() => upload(false), 800);
    const onHide = () => upload(true);
    window.addEventListener("pagehide", onHide);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pagehide", onHide);
    };
  }, [config, user]);

  const set = useCallback(<K extends keyof Config>(key: K, value: Config[K]) => setConfig((c) => ({ ...c, [key]: value })), []);
  const update = useCallback((patch: Partial<Config>) => setConfig((c) => sanitizeConfig({ ...c, ...patch })), []);
  const replace = useCallback((c: Config) => setConfig(sanitizeConfig(c)), []);
  const reset = useCallback(() => setConfig(DEFAULT_CONFIG), []);

  return (
    <Ctx.Provider value={{ config, set, update, replace, reset, sync, previewTheme: setPreview }}>{children}</Ctx.Provider>
  );
}

export const useConfig = () => useContext(Ctx);
