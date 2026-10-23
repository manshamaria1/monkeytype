import { createPool } from "./db";
import { env } from "./env";
import { migrate } from "./migrate";

// `npm run migrate`: apply pending migrations and exit.
const pool = createPool(env.databaseUrl);
migrate(pool)
  .then((a) => console.log(a.length ? `${a.length} migration(s) applied` : "database is up to date"))
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
