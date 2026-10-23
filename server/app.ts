import express from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";
import { loadUser } from "./auth";
import { HttpError } from "./http";
import type { Mailer } from "./mailer";
import { authRoutes } from "./routes/auth";
import { leaderboardRoutes } from "./routes/leaderboard";
import { meRoutes } from "./routes/me";
import { resultRoutes } from "./routes/results";
import { userRoutes } from "./routes/users";
import { csrfGuard, errorHandler, securityHeaders } from "./security";

export function createApp(db: pg.Pool, mailer: Mailer, opts: { staticDir?: string } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(securityHeaders);
  app.use("/api", express.json({ limit: "1mb" }), csrfGuard, loadUser(db));

  app.get("/api/health", async (_req, res) => {
    try {
      await db.query("SELECT 1");
      res.json({ ok: true, database: "up" });
    } catch {
      res.status(503).json({ ok: false, database: "down" });
    }
  });
  app.use("/api/auth", authRoutes(db, mailer));
  app.use("/api/results", resultRoutes(db));
  app.use("/api/leaderboard", leaderboardRoutes(db));
  app.use("/api/me", meRoutes(db));
  app.use("/api/users", userRoutes(db));
  app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found")));

  // In production the built client is served by the same process (single origin).
  if (opts.staticDir && existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir, { index: false, maxAge: "1h" }));
    app.use("/assets", express.static(join(opts.staticDir, "assets"), { immutable: true, maxAge: "1y" }));
    app.get(/^(?!\/api\/|\/ws).*/, (_req, res) => res.sendFile(join(opts.staticDir!, "index.html")));
  }
  app.use(errorHandler);
  return app;
}
