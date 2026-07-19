/**
 * extension/core/sessionBridge.js
 * ------------------------------------------------------------
 * Session-aware bridge for content script.
 *
 * Purpose:
 * - Extension joins socket as Chrome extension device.
 * - Knows whether session is active/ended.
 * - Lets content.js ask shouldMonitor().
 * - Receives voice/session/device events.
 * - Sends client state.
 *
 * Preserves:
 * - session active/ended logic
 * - overlay chat integration
 * - refocus timer integration
 * - voice status updates
 * - devices updates
 *
 * Fixes:
 * - Does not emit old duplicate "join".
 * - No infinite 1-second reconnect flood.
 * - Protects against wrong apiBaseUrl like localhost:8081/api.
 */

(function initSfaiSessionBridge(global) {
  const STATE = {
    socket: null,
    connected: false,
    deviceId: "",
    userId: "",
    apiBaseUrl: "",
    monitoringActive: false,
    sessionStatus: "unknown",
    voiceStatus: "idle",
    currentSession: null,
    joined: false,
  };

  const listeners = new Set();

  function clean(value = "") {
    return String(value || "").trim();
  }

  function apiBaseToSocketUrl(apiBaseUrl = "") {
    const raw = clean(apiBaseUrl)
      .replace(/\/api\/?$/, "")
      .replace(/\/+$/, "");

    /**
     * Safety:
     * localhost:8081 is Expo frontend server, not backend.
     */
    if (
      raw.includes("localhost:8081") ||
      raw.includes("127.0.0.1:8081") ||
      raw.includes(":19006")
    ) {
      return "http://localhost:3000";
    }

    return raw || "http://localhost:3000";
  }

  function emitLocal(eventName, payload = {}) {
    listeners.forEach((listener) => {
      try {
        listener({ eventName, payload });
      } catch {}
    });
  }

  async function persistState() {
    await chrome.storage.local.set({
      monitoringActive: Boolean(STATE.monitoringActive),
      sessionStatus: STATE.sessionStatus,
      socketStatus: STATE.connected ? "connected" : "disconnected",
      currentSession: STATE.currentSession || null,
    });
  }

  async function loadSettings() {
    const settings = await global.SFAI_API_CLIENT.getSettings();

    STATE.deviceId = settings.deviceId || "";
    STATE.userId = settings.userId || "";
    STATE.apiBaseUrl = settings.apiBaseUrl || "";
    STATE.monitoringActive = Boolean(settings.monitoringActive);
    STATE.sessionStatus = settings.sessionStatus || "unknown";
    STATE.currentSession = settings.currentSession || null;

    return settings;
  }

  async function setMonitoringActive(active, session = null) {
    STATE.monitoringActive = Boolean(active);
    STATE.sessionStatus = active ? "active" : "ended";
    STATE.currentSession = session || null;

    await persistState();

    global.SFAI_OVERLAY_CHAT?.setStatus?.(
      active ? "session active" : "session paused"
    );

    emitLocal("session-state", {
      monitoringActive: STATE.monitoringActive,
      sessionStatus: STATE.sessionStatus,
      session: STATE.currentSession,
    });
  }

  async function refreshSession() {
    const settings = await loadSettings();

    if (!settings.deviceId) return null;

    try {
      const data = await global.SFAI_API_CLIENT.getCurrentSession({
        deviceId: settings.deviceId,
        userId: settings.userId || "",
      });

      await setMonitoringActive(Boolean(data.monitoringActive), data.session);
      return data;
    } catch (error) {
      await persistState();
      return null;
    }
  }

  function joinSocket() {
    if (!STATE.socket || !STATE.connected || !STATE.deviceId) return;

    const payload = {
      deviceId: STATE.deviceId,
      userId: STATE.userId || "",
      deviceType: "extension",
      label: "Chrome extension",
      currentScreen: "browser-page",
      voiceStatus: STATE.voiceStatus || "idle",
      sessionStatus: STATE.sessionStatus || "unknown",
    };

    /**
     * Important:
     * Emit only modern join event.
     */
    STATE.socket.emit("study:join", payload);

    STATE.joined = true;
  }

  async function connect() {
    const settings = await loadSettings();

    if (!settings.deviceId || !settings.apiBaseUrl) return null;
    if (!global.io) return null;

    const socketUrl = apiBaseToSocketUrl(settings.apiBaseUrl);

    if (STATE.socket && STATE.connected && STATE.joined) {
      return STATE.socket;
    }

    if (STATE.socket) {
      try {
        STATE.socket.removeAllListeners?.();
        STATE.socket.off?.();
        STATE.socket.disconnect?.();
      } catch {}
    }

    STATE.socket = global.io(socketUrl, {
      path: "/socket.io",
      transports: ["polling", "websocket"],
      reconnection: true,

      /**
       * Important:
       * Do not retry forever every 1 second.
       */
      reconnectionAttempts: 6,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 15000,
      randomizationFactor: 0.5,
      timeout: 8000,
      forceNew: false,
    });

    STATE.socket.on("connect", async () => {
      STATE.connected = true;
      await persistState();
      joinSocket();
      await refreshSession();
      emitClientState();
    });

    STATE.socket.on("disconnect", async () => {
      STATE.connected = false;
      STATE.joined = false;
      await persistState();
    });

    STATE.socket.on("connect_error", async () => {
      STATE.connected = false;
      STATE.joined = false;
      await persistState();
    });

    STATE.socket.on("study:session-started", async (payload = {}) => {
      await setMonitoringActive(true, payload.session);
      emitClientState({ sessionStatus: "active" });
    });

    STATE.socket.on("study:session-ended", async (payload = {}) => {
      await setMonitoringActive(false, payload.session);
      emitClientState({ sessionStatus: "ended" });
    });

    STATE.socket.on("study:session_updated", async (payload = {}) => {
      await setMonitoringActive(Boolean(payload.monitoringActive), payload.session);
      emitClientState({
        sessionStatus: payload.monitoringActive ? "active" : "ended",
      });
    });

    STATE.socket.on("study:session_required", async () => {
      await setMonitoringActive(false, null);
      emitClientState({ sessionStatus: "ended" });
    });

    STATE.socket.on("study:update", async (payload = {}) => {
      const activityId =
        payload.activity?._id ||
        payload.activity?.id ||
        payload.popup?.activityId ||
        "";

      if (activityId) {
        await chrome.storage.local.set({ lastActivityId: activityId });
        global.SFAI_OVERLAY_CHAT?.setActiveActivityId?.(activityId);
      }

      await global.SFAI_REFOCUS_TIMER?.observeDecision?.(payload);
      emitLocal("study:update", payload);
    });

    STATE.socket.on("dashboard:update", (payload = {}) => {
      emitLocal("dashboard:update", payload);
    });

    STATE.socket.on("study:voice-status", (payload = {}) => {
      const status = payload.voiceStatus || payload.status || "voice";
      STATE.voiceStatus = status;
      global.SFAI_OVERLAY_CHAT?.setStatus?.(status);

      if (payload.status === "ai_thinking") {
        global.SFAI_OVERLAY_CHAT?.addAiMessage?.("Thinking...");
      }

      if (payload.reply) {
        global.SFAI_OVERLAY_CHAT?.addAiMessage?.(payload.reply);
      }

      emitClientState({ voiceStatus: status });
      emitLocal("study:voice-status", payload);
    });

    STATE.socket.on("study:voice-updated", (payload = {}) => {
      const ai = payload.ai || {};
      const reply = ai.reply || ai.voiceText || payload.reply || "";

      if (reply) {
        global.SFAI_OVERLAY_CHAT?.addAiMessage?.(reply);
      }

      const status = ai.finalDecisionMade ? "completed" : "speaking";
      STATE.voiceStatus = status;
      global.SFAI_OVERLAY_CHAT?.setStatus?.(status);

      emitClientState({ voiceStatus: status });
      emitLocal("study:voice-updated", payload);
    });

    STATE.socket.on("study:devices-updated", (payload = {}) => {
      emitLocal("study:devices-updated", payload);
    });

    return STATE.socket;
  }

  async function shouldMonitor() {
    const settings = await loadSettings();

    if (!settings.goal) return false;

    if (STATE.sessionStatus === "unknown") {
      await refreshSession();
    }

    return Boolean(STATE.monitoringActive);
  }

  function emitClientState(patch = {}) {
    if (!STATE.socket || !STATE.connected) return false;

    STATE.voiceStatus = patch.voiceStatus || STATE.voiceStatus || "idle";
    STATE.sessionStatus =
      patch.sessionStatus || STATE.sessionStatus || "unknown";

    STATE.socket.emit("study:client-state", {
      deviceId: STATE.deviceId,
      userId: STATE.userId || "",
      deviceType: "extension",
      label: "Chrome extension",
      currentScreen: "browser-page",
      voiceStatus: STATE.voiceStatus,
      sessionStatus: STATE.sessionStatus,
    });

    return true;
  }

  function on(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function getState() {
    return { ...STATE };
  }

  global.SFAI_SESSION_BRIDGE = {
    connect,
    refreshSession,
    shouldMonitor,
    setMonitoringActive,
    emitClientState,
    getState,
    on,
  };

  connect().catch(() => {});
})(window);