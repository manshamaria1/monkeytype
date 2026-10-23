import { useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import CommandPalette from "./components/CommandPalette";
import TestPage from "./pages/TestPage";
import { AuthProvider } from "./state/auth";
import { ConfigProvider, useConfig } from "./state/config";
import { ToastProvider } from "./state/toast";
import { UiProvider, useUi } from "./state/ui";

/**
 * Typing test only: no accounts, leaderboards or multiplayer, no server needed.
 * Built with `npm run build:tool` into one HTML file that can go on any website.
 */
function Shell() {
  const ui = useUi();
  const { config } = useConfig();
  const hide = config.focusMode && ui.typingActive;
  // Esc (unless it is the restart key) or alt+shift+K opens themes & settings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      const esc = e.key === "Escape" && config.quickRestart !== "esc";
      if (esc || (e.altKey && e.shiftKey && e.code === "KeyK")) {
        e.preventDefault();
        ui.setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [config.quickRestart, ui]);
  return (
    <div className={`app tool${hide ? " focus-active" : ""}`}>
      <main className="main">
        <TestPage />
      </main>
      <footer className="footer">
        <button className="link-btn" onClick={() => ui.setPaletteOpen(true)}>
          themes & settings
        </button>
        <span>
          <kbd>tab</kbd> restart · <kbd>esc</kbd> themes & settings
        </span>
      </footer>
      <CommandPalette />
    </div>
  );
}

export default function ToolApp() {
  return (
    <MemoryRouter>
      <ToastProvider>
        <AuthProvider>
          <ConfigProvider>
            <UiProvider>
              <Shell />
            </UiProvider>
          </ConfigProvider>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}
