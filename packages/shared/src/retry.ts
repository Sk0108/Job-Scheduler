export type RetryStrategyName = "FIXED" | "LINEAR" | "EXPONENTIAL";

export interface RetryConfig {
  strategy: RetryStrategyName;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter?: boolean;
}

/**
 * Computes the delay (ms) before the next retry attempt.
 * `attempt` is 1-indexed: the delay returned here is applied after the
 * `attempt`-th failure, before scheduling the (attempt+1)-th try.
 */
export function computeRetryDelayMs(config: RetryConfig, attempt: number): number {
  const { strategy, baseDelayMs, maxDelayMs } = config;
  let delay: number;

  switch (strategy) {
    case "FIXED":
      delay = baseDelayMs;
      break;
    case "LINEAR":
      delay = baseDelayMs * attempt;
      break;
    case "EXPONENTIAL":
      delay = baseDelayMs * 2 ** (attempt - 1);
      break;
    default:
      delay = baseDelayMs;
  }

  delay = Math.min(delay, maxDelayMs);

  if (config.jitter) {
    // Full jitter within +/-25% to avoid thundering-herd retries.
    const jitterFactor = 0.75 + Math.random() * 0.5;
    delay = Math.round(delay * jitterFactor);
  }

  return Math.max(delay, 0);
}
