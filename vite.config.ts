import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `--mode preview` (whole app, no server) and `--mode tool` (typing test only) build one self-contained page.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define:
    mode === "preview" || mode === "tool"
      ? { "import.meta.env.VITE_PREVIEW": JSON.stringify("1"), "import.meta.env.VITE_TOOL": JSON.stringify(mode === "tool" ? "1" : "0") }
      : mode === "wordpress"
        ? { "import.meta.env.VITE_WP": JSON.stringify("1") }
        : {},
  build:
    mode === "wordpress"
      ? {
          // One classic script + one stylesheet, enqueued by the WordPress plugin.
          outDir: "dist/wordpress",
          sourcemap: false,
          cssCodeSplit: false,
          modulePreload: false,
          assetsInlineLimit: 100_000_000,
          rolldownOptions: { output: { codeSplitting: false, format: "iife" } },
        }
      : mode === "preview" || mode === "tool"
      ? {
          outDir: `dist/${mode}`,
          sourcemap: false,
          cssCodeSplit: false,
          assetsInlineLimit: 100_000_000,
          rolldownOptions: { output: { codeSplitting: false } },
        }
      : { outDir: "dist/client", sourcemap: true },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20000,
  },
})) as any;
