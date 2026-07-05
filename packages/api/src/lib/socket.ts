import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { config } from "../config";
import { verifyAccessToken } from "./jwt";

let io: SocketIOServer | undefined;

export function initSocket(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: { origin: config.corsOrigin, credentials: true },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("Unauthorized"));
    try {
      verifyAccessToken(token);
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("subscribe:project", (projectId: string) => {
      socket.join(`project:${projectId}`);
    });
    socket.on("unsubscribe:project", (projectId: string) => {
      socket.leave(`project:${projectId}`);
    });
  });

  return io;
}

/** Broadcast a live-update event to every client watching a project's dashboard. */
export function emitToProject(projectId: string, event: string, payload: unknown): void {
  io?.to(`project:${projectId}`).emit(event, payload);
}

export function getIO(): SocketIOServer | undefined {
  return io;
}
