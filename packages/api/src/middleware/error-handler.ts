import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "@jsp/db";
import { ApiError } from "../lib/errors";
import { logger } from "../logger";

/** Centralized error -> HTTP response translation. Every thrown error in a route funnels here via asyncHandler. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Request validation failed", details: err.flatten() },
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return res.status(409).json({
        error: { code: "CONFLICT", message: "A record with these unique fields already exists", details: err.meta },
      });
    }
    if (err.code === "P2025") {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Record not found" } });
    }
  }

  logger.error({ err, path: req.path, method: req.method }, "Unhandled error");
  return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` } });
}
