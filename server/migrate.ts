import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));

/** Apply pending SQL migrations in filename order. Each runs in its own transaction. */
export async function migrate(pool: pg.Pool, log = console.log): Promise<string[]> {
  // Serialise migrations across processes (e.g. several instances starting at once).
  const lock = await pool.connect();
  try {
    await lock.query("SELECT pg_advisory_lock(7274631)");
    return await runMigrations(pool, log);
  } finally {
    await lock.query("SELECT pg_advisory_unlock(7274631)").catch(() => {});
    lock.release();
  }
}

async function runMigrations(pool: pg.Pool, log: (msg: string) => void): Promise<string[]> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const dir = join(here, "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const done = new Set((await pool.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(readFileSync(join(dir, file), "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      applied.push(file);
      log(`migration applied: ${file}`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${file} failed: ${(e as Error).message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}
