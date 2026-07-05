/**
 * Heuristic, rule-based "AI failure summary" generator.
 *
 * This intentionally does not call an external LLM (no API key is
 * provisioned in this environment) but is structured as a drop-in seam:
 * swap the body of `summarizeFailure` for a call to your LLM provider of
 * choice using the same input/output contract, and every call site
 * (API route, dashboard) keeps working unchanged.
 */

export interface FailureSummaryInput {
  jobType: string;
  attempt: number;
  maxRetries: number;
  errorMessage?: string | null;
  errorStack?: string | null;
  recentErrorMessages?: string[];
}

export interface FailureSummary {
  category: string;
  headline: string;
  explanation: string;
  suggestedAction: string;
  isTransientGuess: boolean;
}

const PATTERNS: Array<{
  category: string;
  test: RegExp;
  headline: string;
  explanation: string;
  suggestedAction: string;
  transient: boolean;
}> = [
  {
    category: "timeout",
    test: /timeout|timed out|ETIMEDOUT|deadline exceeded/i,
    headline: "Job timed out during execution",
    explanation: "The handler did not finish within its allotted timeout window.",
    suggestedAction: "Increase the job's timeoutMs, or investigate why the handler is running slowly (downstream latency, large payload).",
    transient: true,
  },
  {
    category: "network",
    test: /ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENOTFOUND|network error|fetch failed/i,
    headline: "Network connectivity failure",
    explanation: "The job could not reach a downstream dependency (DNS, connection refused/reset).",
    suggestedAction: "Check the health of the downstream service and confirm network/firewall rules. Usually safe to retry.",
    transient: true,
  },
  {
    category: "http_5xx",
    test: /5\d\d|Internal Server Error|Bad Gateway|Service Unavailable/i,
    headline: "Downstream service returned a server error",
    explanation: "A dependency responded with a 5xx status, indicating it failed on its end.",
    suggestedAction: "Likely transient — verify the downstream provider's status page before escalating.",
    transient: true,
  },
  {
    category: "auth",
    test: /401|403|unauthorized|forbidden|invalid credentials|invalid api key/i,
    headline: "Authentication or authorization failure",
    explanation: "The job was rejected due to invalid or expired credentials/permissions.",
    suggestedAction: "Rotate or refresh the credential used by this job; retrying without a fix will fail identically every time.",
    transient: false,
  },
  {
    category: "validation",
    test: /validation|invalid payload|schema|required field|bad request|400/i,
    headline: "Payload validation error",
    explanation: "The job's input payload failed validation against the expected schema.",
    suggestedAction: "Fix the payload at the source — retries will not help until the data is corrected.",
    transient: false,
  },
  {
    category: "resource",
    test: /out of memory|OOM|ENOMEM|too many open files|EMFILE/i,
    headline: "Resource exhaustion on the worker",
    explanation: "The worker ran out of memory or file descriptors while processing this job.",
    suggestedAction: "Reduce job/batch size, raise worker resource limits, or lower queue concurrency.",
    transient: true,
  },
];

export function summarizeFailure(input: FailureSummaryInput): FailureSummary {
  const haystack = `${input.errorMessage ?? ""}\n${input.errorStack ?? ""}`;
  const match = PATTERNS.find((p) => p.test.test(haystack));

  const attemptsLine = `Attempt ${input.attempt} of ${input.maxRetries} for job type "${input.jobType}".`;

  if (match) {
    return {
      category: match.category,
      headline: match.headline,
      explanation: `${match.explanation} ${attemptsLine}`,
      suggestedAction: match.suggestedAction,
      isTransientGuess: match.transient,
    };
  }

  const recurring =
    input.recentErrorMessages &&
    input.recentErrorMessages.length >= 2 &&
    input.recentErrorMessages.every((m) => m === input.recentErrorMessages![0]);

  return {
    category: "unknown",
    headline: "Unclassified failure",
    explanation: recurring
      ? `${attemptsLine} The same error has repeated across attempts, suggesting a deterministic (non-transient) bug rather than a flaky dependency.`
      : `${attemptsLine} No known failure pattern matched; inspect the raw error and stack trace.`,
    suggestedAction: recurring
      ? "Investigate the handler code path for this job type before retrying further — repeating retries are unlikely to succeed."
      : "Review job logs manually; consider adding a pattern to the failure classifier if this recurs.",
    isTransientGuess: !recurring,
  };
}
