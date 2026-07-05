import type Redis from "ioredis";

export const EVENTS_CHANNEL = "jsp:events";

export type JobEventType =
  | "job.queued"
  | "job.claimed"
  | "job.started"
  | "job.completed"
  | "job.failed"
  | "job.retry_scheduled"
  | "job.dead_lettered"
  | "job.cancelled"
  | "worker.heartbeat"
  | "worker.registered"
  | "worker.offline"
  | "queue.updated";

export interface JsonEvent {
  type: JobEventType;
  projectId?: string;
  queueId?: string;
  jobId?: string;
  workerId?: string;
  data?: unknown;
  timestamp: string;
}

/**
 * Cross-process event bus. The worker/scheduler processes have no direct
 * connection to dashboard clients, so lifecycle events are published to
 * Redis and the API process (which does hold the Socket.IO server) relays
 * them to subscribed dashboards. This keeps the worker/scheduler fully
 * decoupled from the web layer — they'd function identically with zero
 * dashboard clients connected.
 */
export async function publishEvent(redis: Redis | undefined, event: Omit<JsonEvent, "timestamp">): Promise<void> {
  if (!redis) return;
  const full: JsonEvent = { ...event, timestamp: new Date().toISOString() };
  await redis.publish(EVENTS_CHANNEL, JSON.stringify(full));
}

export function subscribeEvents(redis: Redis, handler: (event: JsonEvent) => void): void {
  redis.subscribe(EVENTS_CHANNEL).catch((err) => {
    throw err;
  });
  redis.on("message", (channel, message) => {
    if (channel !== EVENTS_CHANNEL) return;
    try {
      handler(JSON.parse(message) as JsonEvent);
    } catch {
      // ignore malformed event payloads
    }
  });
}
