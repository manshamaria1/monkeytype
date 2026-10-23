import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TIME_PRESETS, WORD_PRESETS } from "../../shared/config";
import { LANGUAGES } from "../../shared/languages";
import { THEMES } from "../../shared/themes";
import { NAV_SHORTCUTS } from "../lib/shortcuts";
import { useConfig } from "../state/config";
import { useUi } from "../state/ui";
import Modal from "./Modal";

interface Command {
  id: string;
  label: string;
  group: string;
  run: () => void;
  preview?: () => void;
}

/** Searchable list of actions: navigation, test modes, themes, languages, toggles. */
export default function CommandPalette() {
  const ui = useUi();
  const { config, update, previewTheme } = useConfig();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const commands = useMemo<Command[]>(() => {
    const go = (patch: Parameters<typeof update>[0]) => () => {
      update(patch);
      navigate("/");
    };
    return [
      ...NAV_SHORTCUTS.map((s) => ({ id: "nav-" + s.path, label: `Go to ${s.label}`, group: "navigate", run: () => navigate(s.path) })),
      ...TIME_PRESETS.map((t) => ({ id: "time-" + t, label: `Time test ${t}s`, group: "test", run: go({ mode: "time", time: t }) })),
      ...WORD_PRESETS.map((w) => ({ id: "words-" + w, label: `Words test ${w}`, group: "test", run: go({ mode: "words", words: w }) })),
      { id: "quote", label: "Quote test", group: "test", run: go({ mode: "quote" }) },
      { id: "custom", label: "Custom text test", group: "test", run: go({ mode: "custom" }) },
      { id: "practice", label: "Practice mode (no timer)", group: "test", run: go({ mode: "practice" }) },
      { id: "punct", label: `${config.punctuation ? "Disable" : "Enable"} punctuation`, group: "test", run: go({ punctuation: !config.punctuation }) },
      { id: "nums", label: `${config.numbers ? "Disable" : "Enable"} numbers`, group: "test", run: go({ numbers: !config.numbers }) },
      { id: "focus", label: `${config.focusMode ? "Disable" : "Enable"} focus mode`, group: "settings", run: () => update({ focusMode: !config.focusMode }) },
      { id: "sound", label: `Sound: ${config.sound === "off" ? "turn on (click)" : "turn off"}`, group: "settings", run: () => update({ sound: config.sound === "off" ? "click" : "off" }) },
      { id: "shortcuts", label: "Show keyboard shortcuts", group: "help", run: () => ui.setShortcutsOpen(true) },
      ...(["normal", "expert", "master"] as const).map((d) => ({ id: "diff-" + d, label: `Difficulty: ${d}`, group: "test", run: go({ difficulty: d }) })),
      ...THEMES.map((t) => ({
        id: "theme-" + t.id,
        label: `Theme: ${t.name}`,
        group: "theme",
        run: () => update({ theme: t.id }),
        preview: () => previewTheme(t.id),
      })),
      ...LANGUAGES.map((l) => ({ id: "lang-" + l.id, label: `Language: ${l.name}`, group: "language", run: go({ language: l.id }) })),
    ];
  }, [config.punctuation, config.numbers, config.focusMode, config.sound, update, navigate, previewTheme, ui]);

  const filtered = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((c) => terms.every((t) => `${c.group} ${c.label}`.toLowerCase().includes(t)));
  }, [commands, q]);

  useEffect(() => {
    if (ui.paletteOpen) {
      setQ("");
      setSel(0);
    } else previewTheme(null);
  }, [ui.paletteOpen, previewTheme]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    filtered[sel]?.preview?.() ?? previewTheme(null);
    listRef.current?.children[sel]?.scrollIntoView({ block: "nearest" });
  }, [sel, filtered, previewTheme]);

  const close = () => ui.setPaletteOpen(false);
  const run = (c: Command | undefined) => {
    if (!c) return;
    close();
    previewTheme(null);
    c.run();
  };

  return (
    <Modal open={ui.paletteOpen} onClose={close} title="Command palette">
      <input
        className="palette-input"
        autoFocus
        placeholder="Type to search… (e.g. theme, 60, spanish)"
        aria-label="Search commands"
        aria-controls="palette-list"
        aria-activedescendant={filtered[sel] ? `cmd-${filtered[sel].id}` : undefined}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSel((s) => Math.min(filtered.length - 1, s + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSel((s) => Math.max(0, s - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            run(filtered[sel]);
          }
        }}
      />
      <ul className="palette-list" id="palette-list" role="listbox" ref={listRef}>
        {filtered.map((c, i) => (
          <li
            key={c.id}
            id={`cmd-${c.id}`}
            role="option"
            aria-selected={i === sel}
            className={i === sel ? "active" : ""}
            onMouseEnter={() => setSel(i)}
            onClick={() => run(c)}
          >
            <span className="muted small">{c.group}</span> {c.label}
          </li>
        ))}
        {filtered.length === 0 && <li className="muted">No matching commands.</li>}
      </ul>
    </Modal>
  );
}
