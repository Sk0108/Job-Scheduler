import { describe, expect, it } from "vitest";
import { computeRetryDelayMs } from "./retry";

describe("computeRetryDelayMs", () => {
  it("returns a constant delay for FIXED strategy", () => {
    const delay = computeRetryDelayMs({ strategy: "FIXED", baseDelayMs: 1000, maxDelayMs: 60000 }, 5);
    expect(delay).toBe(1000);
  });

  it("scales linearly with attempt number for LINEAR strategy", () => {
    const cfg = { strategy: "LINEAR" as const, baseDelayMs: 1000, maxDelayMs: 60000 };
    expect(computeRetryDelayMs(cfg, 1)).toBe(1000);
    expect(computeRetryDelayMs(cfg, 3)).toBe(3000);
  });

  it("doubles per attempt for EXPONENTIAL strategy and respects the cap", () => {
    const cfg = { strategy: "EXPONENTIAL" as const, baseDelayMs: 1000, maxDelayMs: 5000 };
    expect(computeRetryDelayMs(cfg, 1)).toBe(1000);
    expect(computeRetryDelayMs(cfg, 2)).toBe(2000);
    expect(computeRetryDelayMs(cfg, 3)).toBe(4000);
    // 8000 would be the unclamped value for attempt 4; maxDelayMs caps it.
    expect(computeRetryDelayMs(cfg, 4)).toBe(5000);
  });

  it("keeps jittered delay within +/-25% of the base value", () => {
    const cfg = { strategy: "FIXED" as const, baseDelayMs: 1000, maxDelayMs: 60000, jitter: true };
    for (let i = 0; i < 50; i++) {
      const delay = computeRetryDelayMs(cfg, 1);
      expect(delay).toBeGreaterThanOrEqual(750);
      expect(delay).toBeLessThanOrEqual(1250);
    }
  });
});
