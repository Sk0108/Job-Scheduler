import { createServer } from "node:http";
import { createApp } from "./app";
import { config } from "./config";
import { logger } from "./logger";
import { initSocket, emitToProject } from "./lib/socket";
import { redisSub } from "./lib/redis";
import { subscribeEvents } from "@jsp/core";

/** Starts the HTTP/Socket.IO server. Returns a shutdown function that closes it. */
export function startApi(): () => Promise<void> {
  const app = createApp();
  const httpServer = createServer(app);
  initSocket(httpServer);

  // Relay lifecycle events published by the worker/scheduler processes (over Redis) to any
  // dashboard clients subscribed to that project's room over Socket.IO.
  subscribeEvents(redisSub, (event) => {
    if (!event.projectId) return;
    emitToProject(event.projectId, event.type, event);
  });

  httpServer.listen(config.port, () => {
    logger.info(`API listening on http://localhost:${config.port}`);
  });

  return () => new Promise((resolve) => httpServer.close(() => resolve()));
}

if (require.main === module) {
  const shutdown = startApi();
  function handleSignal(signal: string) {
    logger.info(`Received ${signal}, shutting down API server`);
    setTimeout(() => process.exit(1), 10_000).unref();
    void shutdown().then(() => process.exit(0));
  }
  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("SIGINT", () => handleSignal("SIGINT"));
}
