import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";
import { createPool } from "./db";
import { env } from "./env";
import { createMailer } from "./mailer";
import { migrate } from "./migrate";
import { MultiplayerHub } from "./multiplayer";

const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  const db = createPool(env.databaseUrl);
  try {
    await migrate(db);
  } catch (e) {
    console.error(`Could not connect to or migrate the database at DATABASE_URL.\n${(e as Error).message}`);
    process.exit(1);
  }
  if (env.isProd && !env.smtpUrl) {
    console.warn("SMTP_URL is not set: password-reset and verification emails will only be written to the server log.");
  }
  // dist/server/index.js -> dist/client
  const staticDir = join(here, "..", "client");
  const app = createApp(db, createMailer(), { staticDir });
  const server = createServer(app);
  const hub = new MultiplayerHub(db);
  hub.attach(server);
  // Remove expired sessions and tokens once an hour.
  setInterval(() => {
    db.query(`DELETE FROM sessions WHERE expires_at < now()`).catch(() => {});
    db.query(`DELETE FROM email_tokens WHERE expires_at < now() - interval '7 days'`).catch(() => {});
  }, 3600_000).unref();
  server.listen(env.port, () => console.log(`Monkeytype server listening on http://localhost:${env.port}`));
  const shutdown = () => {
    hub.close();
    server.close(() => db.end().then(() => process.exit(0)));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

void main();
