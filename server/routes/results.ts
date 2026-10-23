import { Router } from "express";
import { z } from "zod";
import type pg from "pg";
import { submissionSchema, verifySubmission } from "../../shared/results";
import { currentUser, requireUser } from "../auth";
import { ah, HttpError, parseBody } from "../http";
import { rateLimit } from "../security";
import { saveResult } from "../services/results";

export function resultRoutes(db: pg.Pool) {
  const r = Router();
  const limit = rateLimit({ name: "results", windowMs: 60_000, max: 40, key: (req) => String(req.user?.id ?? req.ip) });

  /** Verify a result without saving it (used for guests to show eligibility). */
  r.post(
    "/verify",
    limit,
    ah(async (req, res) => {
      const sub = parseBody(submissionSchema, req.body);
      const out = verifySubmission(sub);
      if (!out.ok) throw new HttpError(422, out.error);
      res.json({ eligible: out.result.eligible, ineligibleReasons: out.result.ineligibleReasons });
    }),
  );

  r.post(
    "/",
    requireUser,
    limit,
    ah(async (req, res) => {
      const user = currentUser(req);
      const sub = parseBody(submissionSchema, req.body);
      const out = verifySubmission(sub);
      if (!out.ok) throw new HttpError(422, out.error);
      const saved = await saveResult(db, user.id, sub, out.result);
      res.status(saved.duplicate ? 200 : 201).json({ ...saved, stats: out.result.stats });
    }),
  );

  /** Import results that were taken on this device before signing in. Never ranked. */
  r.post(
    "/import",
    requireUser,
    rateLimit({ name: "import", windowMs: 60_000, max: 5, key: (req) => String(req.user?.id) }),
    ah(async (req, res) => {
      const user = currentUser(req);
      const body = parseBody(z.object({ results: z.array(z.unknown()).max(100) }), req.body);
      let imported = 0;
      let skipped = 0;
      for (const raw of body.results) {
        const parsed = submissionSchema.safeParse(raw);
        if (!parsed.success) {
          skipped++;
          continue;
        }
        const out = verifySubmission(parsed.data);
        if (!out.ok) {
          skipped++;
          continue;
        }
        const saved = await saveResult(db, user.id, parsed.data, out.result, { imported: true });
        if (saved.duplicate) skipped++;
        else imported++;
      }
      res.json({ imported, skipped });
    }),
  );

  return r;
}
