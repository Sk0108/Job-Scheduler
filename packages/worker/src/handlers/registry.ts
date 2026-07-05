import type { JobContext, JobHandler } from "./types";

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Aborted"));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    });
  });
}

function randomDelay(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}

/**
 * Demo job handlers. In a real deployment these would live in the
 * application code that owns each job type (call out to an email
 * provider's API, run a report query, hit a webhook, etc). The registry
 * pattern — job `type` string -> handler function — is the actual
 * extension point; everything else in the worker (claiming, retries,
 * timeouts, logging) is generic and type-agnostic.
 */
export const handlerRegistry: Record<string, JobHandler> = {
  "send-welcome-email": async (ctx) => {
    await ctx.log("info", `Sending welcome email to ${ctx.job.payload && (ctx.job.payload as any).to}`);
    await sleep(randomDelay(150, 400), ctx.signal);
    return { sent: true };
  },

  "send-followup-email": async (ctx) => {
    await ctx.log("info", "Sending follow-up email");
    await sleep(randomDelay(150, 400), ctx.signal);
    return { sent: true };
  },

  "send-newsletter": async (ctx) => {
    await ctx.log("info", "Sending newsletter issue");
    await sleep(randomDelay(100, 300), ctx.signal);
    return { sent: true };
  },

  "generate-monthly-report": async (ctx) => {
    await ctx.log("info", "Starting report generation", { month: (ctx.job.payload as any)?.month });
    await sleep(randomDelay(1500, 3500), ctx.signal);
    await ctx.log("info", "Report generation complete");
    return { reportUrl: `https://reports.example.com/${ctx.job.id}.pdf` };
  },

  "rollup-usage-stats": async (ctx) => {
    await ctx.log("info", "Rolling up usage stats");
    await sleep(randomDelay(500, 1200), ctx.signal);
    return { rowsProcessed: Math.floor(Math.random() * 10_000) };
  },

  "call-unreliable-webhook": async (ctx) => {
    const payload = ctx.job.payload as { url?: string; failAlways?: boolean };
    await ctx.log("info", `Calling webhook ${payload.url ?? "(no url)"}`);
    await sleep(randomDelay(100, 300), ctx.signal);
    if (payload.failAlways) {
      throw new Error("Bad Gateway: upstream webhook returned 502 Bad Gateway");
    }
    return { delivered: true };
  },
};

export function resolveHandler(jobType: string): JobHandler {
  const handler = handlerRegistry[jobType];
  if (!handler) {
    return async () => {
      throw new Error(`No handler registered for job type "${jobType}"`);
    };
  }
  return handler;
}
