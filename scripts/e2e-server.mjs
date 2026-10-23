// Starts the production build against a wiped end-to-end database (used by Playwright).
import pg from "pg";
import { spawn } from "node:child_process";

const url = process.env.E2E_DATABASE_URL ?? "postgresql://monkey:monkey@localhost:5432/monkeytype_e2e";
if (!/e2e/.test(url)) throw new Error("Refusing to wipe a database whose name does not contain 'e2e'");
const pool = new pg.Pool({ connectionString: url });
await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
await pool.end();
const child = spawn("node", ["dist/server/index.js"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url, PORT: process.env.E2E_PORT ?? "3100", APP_URL: "http://localhost:3100", NODE_ENV: "e2e" },
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
