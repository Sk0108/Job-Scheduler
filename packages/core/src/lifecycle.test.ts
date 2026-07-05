import { describe, expect, it } from "vitest";
import { resolveRetryPolicy, SYSTEM_DEFAULT_RETRY_POLICY } from "./lifecycle";

describe("resolveRetryPolicy", () => {
  const job = { maxRetries: null, retryStrategy: null, baseDelayMs: null, maxDelayMs: null } as const;

  it("falls back to the system default when no job or queue policy is set", () => {
    expect(resolveRetryPolicy(job, null)).toEqual(SYSTEM_DEFAULT_RETRY_POLICY);
  });

  it("prefers the queue's default retry policy over the system default", () => {
    const queuePolicy = { strategy: "LINEAR" as const, maxRetries: 3, baseDelayMs: 2000, maxDelayMs: 60000, jitter: false };
    expect(resolveRetryPolicy(job, queuePolicy)).toEqual({
      strategy: "LINEAR",
      maxRetries: 3,
      baseDelayMs: 2000,
      maxDelayMs: 60000,
      jitter: false,
    });
  });

  it("lets per-job overrides win over the queue policy field-by-field", () => {
    const queuePolicy = { strategy: "LINEAR" as const, maxRetries: 3, baseDelayMs: 2000, maxDelayMs: 60000, jitter: false };
    const overridden = { maxRetries: 10, retryStrategy: "EXPONENTIAL" as const, baseDelayMs: null, maxDelayMs: null };
    expect(resolveRetryPolicy(overridden, queuePolicy)).toEqual({
      strategy: "EXPONENTIAL",
      maxRetries: 10,
      baseDelayMs: 2000,
      maxDelayMs: 60000,
      jitter: false,
    });
  });
});
