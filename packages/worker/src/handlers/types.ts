import type { Job } from "@jsp/db";

export interface JobContext {
  job: Job;
  signal: AbortSignal;
  log: (level: "debug" | "info" | "warn" | "error", message: string, metadata?: Record<string, unknown>) => Promise<void>;
}

export type JobHandler = (ctx: JobContext) => Promise<unknown>;
