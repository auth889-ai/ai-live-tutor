/**
 * server/config/realtime.js
 * ------------------------------------------------------------
 * Central Socket.io manager for Feature 1 realtime study monitoring.
 *
 * This file supports both old and new imports:
 * - initRealtime(server)
 * - setupRealtime(io)
 * - emitStudyEvent(...)
 * - emitToDevice(...)
 * - emitDevicesUpdated(...)
 * - getConnectedClients(...)
 * - getConnectedDevices(...)
 *
 * Fixes:
 * - exports emitDevicesUpdated, required by services/study.service.js
 * - prevents duplicate room delivery
 * - dedupes connected devices
 * - supports device:<deviceId> and user:<userId> rooms
 * - supports coach message event and popup event delivery
 */

import { Server } from "socket.io";

let ioInstance = null;

const connectedClients = new Map();

function clean(value = "") {
  return String(value || "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function getPreviousJoinedAt(socketId) {
  return connectedClients.get(socketId)?.joinedAt || nowIso();
}

function normalizeJoinPayload(payload = {}) {
  return {
    deviceId: clean(payload.deviceId || payload.id || ""),
    userId: clean(payload.userId || ""),
    deviceType: clean(payload.deviceType || payload.type || payload.source || "unknown"),
    label: clean(payload.label || payload.name || payload.displayName || ""),
    currentScreen: clean(payload.currentScreen || payload.screen || "study-dashboard"),
    voiceStatus: clean(payload.voiceStatus || "idle"),
    sessionStatus: clean(payload.sessionStatus || "unknown"),
  };
}

function publicClient(socketId, state = {}) {
  return {
    socketId,
    deviceId: state.deviceId || "",
    userId: state.userId || "",
    deviceType: state.deviceType || "unknown",
    label: state.label || state.deviceType || "Device",
    source: state.source || state.deviceType || "socket",
    online: true,
    status: "online",
    currentScreen: state.currentScreen || "study-dashboard",
    voiceStatus: state.voiceStatus || "idle",
    sessionStatus: state.sessionStatus || "unknown",
    joinedAt: state.joinedAt || state.connectedAt || nowIso(),
    connectedAt: state.connectedAt || state.joinedAt || nowIso(),
    lastSeenAt: state.lastSeenAt || nowIso(),
  };
}

function dedupeClients(items = []) {
  const map = new Map();

  items.forEach((item) => {
    const key = `${item.deviceId || item.socketId}-${item.deviceType || "unknown"}`;
    const previous = map.get(key);

    if (!previous) {
      map.set(key, item);
      return;
    }

    const previousTime = new Date(previous.lastSeenAt || previous.joinedAt || 0).getTime();
    const currentTime = new Date(item.lastSeenAt || item.joinedAt || 0).getTime();

    if (currentTime >= previousTime) {
      map.set(key, item);
    }
  });

  return Array.from(map.values());
}

export function getConnectedClients({ deviceId = "", userId = "" } = {}) {
  const d = clean(deviceId);
  const u = clean(userId);

  const rows = Array.from(connectedClients.entries())
    .map(([socketId, state]) => publicClient(socketId, state))
    .filter((item) => {
      if (u && d) return item.userId === u || item.deviceId === d;
      if (u) return item.userId === u;
      if (d) return item.deviceId === d;
      return true;
    })
    .sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));

  return dedupeClients(rows);
}

export function getConnectedDevices(filter = {}) {
  const devices = getConnectedClients(filter);

  return {
    devices,
    onlineCount: devices.filter((d) => d.online).length,
    totalCount: devices.length,
  };
}

function emitRaw(eventName, payload = {}, { deviceId = "", userId = "" } = {}) {
  if (!ioInstance || !eventName) return false;

  const rooms = [];

  if (deviceId) rooms.push(`device:${deviceId}`);
  if (userId) rooms.push(`user:${userId}`);

  /**
   * Socket.io room union prevents duplicate delivery if one socket is in both rooms.
   */
  if (rooms.length) {
    ioInstance.to(rooms).emit(eventName, payload);
  } else {
    ioInstance.emit(eventName, payload);
  }

  return true;
}

/**
 * Compatible emitStudyEvent.
 *
 * Supports both call styles:
 * 1. emitStudyEvent("study:update", payload)
 * 2. emitStudyEvent({ deviceId, userId }, "study:update", payload)
 *
 * Important:
 * study.service.js must use:
 * emitStudyEvent({ deviceId, userId }, eventName, payload)
 *
 * Do NOT use:
 * emitStudyEvent(deviceId, eventName, payload)
 */
export function emitStudyEvent(arg1, arg2, arg3 = {}) {
  if (!ioInstance) return false;

  let target = {};
  let eventName = "";
  let payload = {};

  if (typeof arg1 === "string") {
    eventName = arg1;
    payload = arg2 || {};
    target = {};
  } else {
    target = arg1 || {};
    eventName = arg2;
    payload = arg3 || {};
  }

  if (!eventName) return false;

  const deviceId = clean(
    target.deviceId ||
      payload.deviceId ||
      payload.activity?.deviceId ||
      payload.data?.deviceId ||
      payload.session?.deviceId ||
      ""
  );

  const userId = clean(
    target.userId ||
      payload.userId ||
      payload.activity?.userId ||
      payload.data?.userId ||
      payload.session?.userId ||
      ""
  );

  const enriched = {
    ok: payload.ok ?? true,
    ...payload,
    deviceId: payload.deviceId || deviceId,
    userId: payload.userId || userId,
    eventName,
    emittedAt: nowIso(),
    at: payload.at || nowIso(),
  };

  return emitRaw(eventName, enriched, { deviceId, userId });
}

export function emitToDevice(deviceId, eventName, payload = {}) {
  return emitStudyEvent({ deviceId }, eventName, payload);
}

export function emitToUser(userId, eventName, payload = {}) {
  return emitStudyEvent({ userId }, eventName, payload);
}

/**
 * Required by server/services/study.service.js
 */
export function emitDevicesUpdated({ deviceId = "", userId = "" } = {}) {
  const payload = {
    ok: true,
    eventName: "study:devices-updated",
    at: nowIso(),
    emittedAt: nowIso(),
    ...getConnectedDevices({ deviceId, userId }),
  };

  emitRaw("study:devices-updated", payload, {
    deviceId: clean(deviceId),
    userId: clean(userId),
  });

  /**
   * Old dashboard compatibility.
   */
  emitRaw("devices:update", payload, {});

  return payload;
}

function registerClient(socket, payload = {}) {
  const join = normalizeJoinPayload(payload);

  const previous = connectedClients.get(socket.id) || {};

  const state = {
    ...previous,
    socketId: socket.id,
    deviceId: join.deviceId || previous.deviceId || "",
    userId: join.userId || previous.userId || "",
    deviceType: join.deviceType || previous.deviceType || "unknown",
    label: join.label || previous.label || join.deviceType || "Device",
    currentScreen: join.currentScreen || previous.currentScreen || "study-dashboard",
    voiceStatus: join.voiceStatus || previous.voiceStatus || "idle",
    sessionStatus: join.sessionStatus || previous.sessionStatus || "unknown",
    source: join.deviceType || previous.source || "socket",
    joinedAt: previous.joinedAt || getPreviousJoinedAt(socket.id),
    connectedAt: previous.connectedAt || previous.joinedAt || nowIso(),
    lastSeenAt: nowIso(),
  };

  connectedClients.set(socket.id, state);

  if (state.deviceId) socket.join(`device:${state.deviceId}`);
  if (state.userId) socket.join(`user:${state.userId}`);

  emitDevicesUpdated({
    deviceId: state.deviceId,
    userId: state.userId,
  });

  return state;
}

function attachSocketHandlers(io) {
  io.on("connection", (socket) => {
    const queryPayload = {
      deviceId: socket.handshake?.query?.deviceId,
      userId: socket.handshake?.query?.userId,
      deviceType: socket.handshake?.query?.deviceType,
      source: socket.handshake?.query?.source,
      label: socket.handshake?.query?.label,
    };

    if (queryPayload.deviceId || queryPayload.userId) {
      registerClient(socket, queryPayload);
    }

    socket.emit("study:socket-ready", {
      ok: true,
      socketId: socket.id,
      at: nowIso(),
    });

    const joinDevice = (payload = {}) => {
      const state = registerClient(socket, payload);

      socket.emit("study:joined", {
        ok: true,
        socketId: socket.id,
        client: publicClient(socket.id, state),
        ...publicClient(socket.id, state),
        at: nowIso(),
      });
    };

    socket.on("study:join", joinDevice);

    /**
     * Backward compatibility only.
     * New frontend/extension should emit only "study:join".
     */
    socket.on("join", joinDevice);

    socket.on("study:heartbeat", (payload = {}) => {
      const state = registerClient(socket, payload);

      socket.emit("study:heartbeat:ack", {
        ok: true,
        at: nowIso(),
        client: publicClient(socket.id, state),
      });
    });

    socket.on("study:client-state", (payload = {}) => {
      const previous = connectedClients.get(socket.id) || {};

      const state = registerClient(socket, {
        ...previous,
        ...payload,
        deviceId: payload.deviceId || previous.deviceId,
        userId: payload.userId || previous.userId,
        deviceType: payload.deviceType || previous.deviceType,
        label: payload.label || previous.label,
        currentScreen: payload.currentScreen || previous.currentScreen,
        voiceStatus: payload.voiceStatus || previous.voiceStatus,
        sessionStatus: payload.sessionStatus || previous.sessionStatus,
      });

      emitStudyEvent(
        { deviceId: state.deviceId, userId: state.userId },
        "study:client-state",
        publicClient(socket.id, state)
      );

      emitDevicesUpdated({
        deviceId: state.deviceId,
        userId: state.userId,
      });
    });

    /**
     * Optional frontend event:
     * Allows a dashboard/extension to send a coach message event through server.
     * The server simply rebroadcasts it to the user's device/user room.
     */
    socket.on("study:coach-message", (payload = {}) => {
      const previous = connectedClients.get(socket.id) || {};
      const deviceId = clean(payload.deviceId || previous.deviceId || "");
      const userId = clean(payload.userId || previous.userId || "");

      emitStudyEvent(
        { deviceId, userId },
        "study:coach-message",
        {
          ...payload,
          deviceId,
          userId,
          forwardedBy: socket.id,
          at: nowIso(),
        }
      );
    });

    socket.on("study:popup", (payload = {}) => {
      const previous = connectedClients.get(socket.id) || {};
      const deviceId = clean(payload.deviceId || previous.deviceId || "");
      const userId = clean(payload.userId || previous.userId || "");

      emitStudyEvent(
        { deviceId, userId },
        "study:popup",
        {
          ...payload,
          deviceId,
          userId,
          forwardedBy: socket.id,
          at: nowIso(),
        }
      );
    });

    socket.on("disconnect", () => {
      const previous = connectedClients.get(socket.id);
      connectedClients.delete(socket.id);

      if (previous) {
        emitStudyEvent(
          {
            deviceId: previous.deviceId,
            userId: previous.userId,
          },
          "study:device-offline",
          {
            socketId: socket.id,
            deviceId: previous.deviceId,
            userId: previous.userId,
            online: false,
            status: "offline",
            lastSeenAt: nowIso(),
          }
        );

        emitDevicesUpdated({
          deviceId: previous.deviceId,
          userId: previous.userId,
        });
      }
    });
  });
}

/**
 * Main initializer for server.js if your server creates HTTP server.
 */
export function initRealtime(server) {
  ioInstance = new Server(server, {
    cors: {
      origin: process.env.CLIENT_ORIGIN?.split(",") || "*",
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: false,
    },
    transports: ["polling", "websocket"],
  });

  attachSocketHandlers(ioInstance);

  return ioInstance;
}

/**
 * Compatibility initializer if server.js creates Socket.io itself.
 */
export function setupRealtime(io) {
  ioInstance = io;
  attachSocketHandlers(ioInstance);
  return ioInstance;
}

export function getIo() {
  return ioInstance;
}

export default {
  initRealtime,
  setupRealtime,
  emitStudyEvent,
  emitToDevice,
  emitToUser,
  emitDevicesUpdated,
  getConnectedClients,
  getConnectedDevices,
  getIo,
};