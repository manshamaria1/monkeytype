import { build } from "esbuild";
import { cpSync } from "node:fs";

await build({
  entryPoints: ["server/index.ts", "server/migrate-cli.ts"],
  outdir: "dist/server",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  sourcemap: true,
});
cpSync("server/migrations", "dist/server/migrations", { recursive: true });
console.log("server built -> dist/server");
