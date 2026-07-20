/**
 * extension/core/apiClient.js
 * ------------------------------------------------------------
 * Shared backend API client for extension background/content/popup.
 *
 * Full fixed local/no-ngrok version.
 * - Default API URL is http://localhost:3000/api.
 * - Old ngrok URLs saved in Chrome storage are migrated to localhost.
 * - Keeps all existing Feature 1 APIs: goal/session/signal/batch/voice/feedback/dashboard.
 */

(function initSfaiApiClient(global) {
  const DEFAULT_API_BASE_URL = "http://localhost:3000/api";

  function clean(value = "") {
    return String(value || "").trim();
  }

  function isOldNgrokUrl(url = "") {
    const value = clean(url).toLowerCase();
    return (
      value.includes("ngrok-free.dev") ||
      value.includes("ngrok.io") ||
      value.includes("enjoyer-extrude-neurology")
    );
  }

  function cleanBaseUrl(url = "") {
    const value = clean(url || DEFAULT_API_BASE_URL).replace(/\/+$/, "");

    if (!value || isOldNgrokUrl(value)) {
      return DEFAULT_API_BASE_URL;
    }

    return value.endsWith("/api") ? value : `${value}/api`;
  }

  function buildQuery(params = {}) {
    const search = new URLSearchParams();

    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && clean(value)) {
        search.set(key, String(value));
      }
    });

    const text = search.toString();
    return text ? `?${text}` : "";
  }

  async function migrateOldApiBaseUrl() {
    try {
      const data = await chrome.storage.local.get(["apiBaseUrl"]);
      const current = clean(data.apiBaseUrl || "");

      if (!current || isOldNgrokUrl(current)) {
        await chrome.storage.local.set({ apiBaseUrl: DEFAULT_API_BASE_URL });
        console.log("Study Focus AI: migrated API URL to", DEFAULT_API_BASE_URL);
      }
    } catch (error) {
      console.warn(
        "Study Focus AI: API URL migration failed:",
        error?.message || error
      );
    }
  }

  async function getSettings() {
    await migrateOldApiBaseUrl();

    const data = await chrome.storage.local.get([
      "apiBaseUrl",
      "deviceId",
      "userId",
      "goal",
      "monitoringActive",
      "sessionStatus",
      "socketStatus",
      "currentSession",
      "lastActivityId",
    ]);

    return {
      ...data,
      apiBaseUrl: cleanBaseUrl(data.apiBaseUrl || DEFAULT_API_BASE_URL),
      userId: data.userId || "",
      goal: data.goal || "",
      monitoringActive: Boolean(data.monitoringActive),
      sessionStatus: data.sessionStatus || "unknown",
    };
  }

  async function requestJson(path, options = {}) {
    const settings = await getSettings();
    const base = cleanBaseUrl(options.apiBaseUrl || settings.apiBaseUrl);
    const cleanPath = String(path || "").startsWith("/")
      ? String(path || "")
      : `/${path}`;
    const url = `${base}${cleanPath}`;

    const controller = new AbortController();
    const timeoutMs = Number(options.timeoutMs || 22000);
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: options.method || "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      const text = await response.text();

      let json = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { ok: false, raw: text };
      }

      if (!response.ok || json.ok === false) {
        throw new Error(
          json.message ||
            json.error ||
            json.raw ||
            `Request failed: ${response.status}`
        );
      }

      return json.data ?? json;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function saveGoal({ goal, deviceId, userId = "" }) {
    const settings = await getSettings();
    const finalDeviceId = deviceId || settings.deviceId;
    const finalUserId = userId || settings.userId || "";

    return requestJson("/study/goal", {
      method: "POST",
      body: {
        deviceId: finalDeviceId,
        userId: finalUserId,
        goal,
        deviceType: "extension",
        source: "chrome-extension",
        label: "Chrome extension",
      },
    });
  }

  async function startSession({ goal = "", deviceId, userId = "" } = {}) {
    const settings = await getSettings();
    const finalDeviceId = deviceId || settings.deviceId;
    const finalUserId = userId || settings.userId || "";
    const finalGoal = goal || settings.goal || "";

    return requestJson("/study/session/start", {
      method: "POST",
      body: {
        deviceId: finalDeviceId,
        userId: finalUserId,
        goal: finalGoal,
        deviceType: "extension",
        source: "chrome-extension",
        label: "Chrome extension",
        reason: "Started from Chrome extension.",
      },
    });
  }

  async function endSession({ deviceId, userId = "" } = {}) {
    const settings = await getSettings();
    const finalDeviceId = deviceId || settings.deviceId;
    const finalUserId = userId || settings.userId || "";

    return requestJson("/study/session/end", {
      method: "POST",
      body: {
        deviceId: finalDeviceId,
        userId: finalUserId,
        deviceType: "extension",
        source: "chrome-extension",
        label: "Chrome extension",
        reason: "Ended from Chrome extension.",
      },
    });
  }

  async function getCurrentSession({ deviceId, userId = "" } = {}) {
    const settings = await getSettings();
    const finalDeviceId = deviceId || settings.deviceId;
    const finalUserId = userId || settings.userId || "";
    const query = buildQuery({ userId: finalUserId });

    return requestJson(
      `/study/session/current/${encodeURIComponent(finalDeviceId)}${query}`
    );
  }

  async function sendSignal(signal) {
    return requestJson("/study/signal", {
      method: "POST",
      timeoutMs: 70000,
      body: signal,
    });
  }

  async function sendSignalBatch({ signals = [], deviceId, userId = "" } = {}) {
    const settings = await getSettings();

    return requestJson("/study/signals/batch", {
      method: "POST",
      timeoutMs: 70000,
      body: {
        deviceId: deviceId || settings.deviceId,
        userId: userId || settings.userId || "",
        source: "chrome-extension-batch",
        deviceType: "extension",
        label: "Chrome extension",
        signals,
      },
    });
  }

  async function sendVoiceReply({
    activityId,
    message,
    screenshotBase64 = null,
    deviceId,
    userId = "",
  }) {
    const settings = await getSettings();

    return requestJson("/study/voice-reply", {
      method: "POST",
      timeoutMs: 70000,
      body: {
        deviceId: deviceId || settings.deviceId,
        userId: userId || settings.userId || "",
        activityId,
        message,
        voiceAnswer: message,
        screenshotBase64,
        source: "extension",
        deviceType: "extension",
      },
    });
  }

  async function sendFeedback({
    activityId,
    userAnswer,
    correctedType,
    reason = "",
    deviceId,
    userId = "",
  }) {
    const settings = await getSettings();

    return requestJson("/study/feedback", {
      method: "POST",
      body: {
        deviceId: deviceId || settings.deviceId,
        userId: userId || settings.userId || "",
        activityId,
        userAnswer,
        correctedType,
        reason,
      },
    });
  }

  async function popupIgnored({
    activityId,
    reason = "User ignored extension popup.",
    deviceId,
    userId = "",
  }) {
    const settings = await getSettings();

    return requestJson("/study/popup-ignored", {
      method: "POST",
      body: {
        deviceId: deviceId || settings.deviceId,
        userId: userId || settings.userId || "",
        activityId,
        reason,
      },
    });
  }

  async function getConversations({
    deviceId,
    userId = "",
    sessionId = "",
    activityId = "",
    limit = 20,
  } = {}) {
    const settings = await getSettings();
    const finalDeviceId = deviceId || settings.deviceId;
    const query = buildQuery({
      userId: userId || settings.userId || "",
      sessionId,
      activityId,
      limit,
    });

    return requestJson(
      `/study/conversations/${encodeURIComponent(finalDeviceId)}${query}`
    );
  }

  async function getDashboard({ deviceId, userId = "" } = {}) {
    const settings = await getSettings();
    const finalDeviceId = deviceId || settings.deviceId;
    const query = buildQuery({ userId: userId || settings.userId || "" });

    return requestJson(
      `/study/dashboard/${encodeURIComponent(finalDeviceId)}${query}`
    );
  }

  migrateOldApiBaseUrl();

  global.SFAI_API_CLIENT = {
    DEFAULT_API_BASE_URL,
    clean,
    isOldNgrokUrl,
    cleanBaseUrl,
    buildQuery,
    migrateOldApiBaseUrl,
    getSettings,
    requestJson,
    saveGoal,
    startSession,
    endSession,
    getCurrentSession,
    sendSignal,
    sendSignalBatch,
    sendVoiceReply,
    sendFeedback,
    popupIgnored,
    getConversations,
    getDashboard,
  };
})(globalThis);