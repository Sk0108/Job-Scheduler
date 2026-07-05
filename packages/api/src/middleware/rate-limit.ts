import rateLimit from "express-rate-limit";

/** Generous global ceiling — protects the process from being overwhelmed, not a per-user quota. */
export const globalRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
});

/** Tighter window on auth endpoints to slow down credential-stuffing/brute-force attempts. */
export const authRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many auth attempts, try again shortly" } },
});

/** Stricter limit for job-creation endpoints, keyed by authenticated user so one tenant can't starve others. */
export const jobCreationRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId ?? req.ip ?? "anonymous",
});
