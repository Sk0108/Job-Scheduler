import { describe, expect, it } from "vitest";
import { summarizeFailure } from "./failure-summary";

describe("summarizeFailure", () => {
  it("classifies timeout errors", () => {
    const summary = summarizeFailure({
      jobType: "send-email",
      attempt: 2,
      maxRetries: 5,
      errorMessage: "Error: operation timed out after 30000ms",
    });
    expect(summary.category).toBe("timeout");
    expect(summary.isTransientGuess).toBe(true);
  });

  it("classifies auth errors as non-transient", () => {
    const summary = summarizeFailure({
      jobType: "sync-billing",
      attempt: 1,
      maxRetries: 3,
      errorMessage: "401 Unauthorized: invalid api key",
    });
    expect(summary.category).toBe("auth");
    expect(summary.isTransientGuess).toBe(false);
  });

  it("flags deterministic failures when the same error repeats", () => {
    const summary = summarizeFailure({
      jobType: "weird-job",
      attempt: 3,
      maxRetries: 3,
      errorMessage: "Cannot read properties of undefined",
      recentErrorMessages: ["Cannot read properties of undefined", "Cannot read properties of undefined"],
    });
    expect(summary.category).toBe("unknown");
    expect(summary.isTransientGuess).toBe(false);
  });
});
