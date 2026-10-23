import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `vite build --mode preview` makes a single self-contained page (no server) for quick demos.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: mode === "preview" ? { "import.meta.env.VITE_PREVIEW": JSON.stringify("1") } : {},
  build:
    mode === "preview"
      ? {
          outDir: "dist/preview",
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
