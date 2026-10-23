import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

/** An error whose message is safe to show to users. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) {
    const first = r.error.issues[0];
    const path = first?.path.join(".");
    throw new HttpError(400, path ? `${path}: ${first.message}` : first?.message ?? "Invalid request");
  }
  return r.data;
}

/** Wrap async route handlers so rejected promises reach the error handler. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);
