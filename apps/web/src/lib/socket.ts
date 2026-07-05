import { io, type Socket } from "socket.io-client";
import { API_URL, getAccessToken } from "../api/client";

let socket: Socket | null = null;

function getSocket(): Socket {
  if (!socket) {
    socket = io(API_URL, { auth: { token: getAccessToken() }, autoConnect: false });
  }
  return socket;
}

/** Joins the given project's live-update room and returns an unsubscribe function. Reconnects with a fresh token each call. */
export function subscribeToProject(projectId: string, onEvent: (type: string, payload: unknown) => void): () => void {
  const s = getSocket();
  s.auth = { token: getAccessToken() };
  if (!s.connected) s.connect();
  s.emit("subscribe:project", projectId);

  const handler = (type: string) => (payload: unknown) => onEvent(type, payload);
  const events = [
    "job.queued",
    "job.claimed",
    "job.started",
    "job.completed",
    "job.failed",
    "job.retry_scheduled",
    "job.dead_lettered",
    "job.cancelled",
    "worker.heartbeat",
    "worker.registered",
    "worker.offline",
    "queue.updated",
  ];
  const handlers = events.map((e) => [e, handler(e)] as const);
  handlers.forEach(([e, h]) => s.on(e, h));

  return () => {
    handlers.forEach(([e, h]) => s.off(e, h));
    s.emit("unsubscribe:project", projectId);
  };
}
