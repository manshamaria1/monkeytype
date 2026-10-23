import { createContext, useContext, useState, type ReactNode } from "react";

interface UiState {
  /** A typing test is in progress (used by focus mode to hide distractions). */
  typingActive: boolean;
  setTypingActive: (v: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (v: boolean) => void;
}

const Ctx = createContext<UiState>(null as unknown as UiState);

export function UiProvider({ children }: { children: ReactNode }) {
  const [typingActive, setTypingActive] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  return (
    <Ctx.Provider value={{ typingActive, setTypingActive, paletteOpen, setPaletteOpen, shortcutsOpen, setShortcutsOpen }}>
      {children}
    </Ctx.Provider>
  );
}

export const useUi = () => useContext(Ctx);
