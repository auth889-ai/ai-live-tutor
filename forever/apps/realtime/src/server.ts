import { QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { WebSocket, WebSocketServer } from "ws";
import type { ForeverEvent } from "./events.js";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379/0";
const port = Number(process.env.FOREVER_REALTIME_PORT ?? 8010);

const server = new WebSocketServer({ port });
const clients = new Map<string, Set<WebSocket>>();
const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });

server.on("connection", (socket, request) => {
  const sessionId = new URL(request.url ?? "/", "http://localhost").searchParams.get("sessionId");
  if (!sessionId) {
    socket.close(1008, "sessionId is required");
    return;
  }

  const group = clients.get(sessionId) ?? new Set<WebSocket>();
  group.add(socket as WebSocket);
  clients.set(sessionId, group);

  socket.addEventListener("close", () => {
    group.delete(socket as WebSocket);
  });
});

const queueEvents = new QueueEvents("forever-generation", {
  connection: redis
});

queueEvents.on("progress", ({ data }) => {
  publish(data as ForeverEvent);
});

function publish(event: ForeverEvent) {
  const group = clients.get(event.sessionId);
  if (!group) return;

  const payload = JSON.stringify(event);
  for (const socket of group) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    }
  }
}

console.log(`Forever realtime gateway listening on ${port}`);
