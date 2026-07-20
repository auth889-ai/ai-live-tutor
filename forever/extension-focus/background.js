/**
 * extension/background.js
 * ------------------------------------------------------------
 * Study Focus AI — Chrome extension service worker.
 *
 * Responsibilities:
 * - Store deviceId, goal, backend API URL.
 * - Capture page signals from content.js.
 * - Send realtime signals to backend.
 * - Batch/queue signals safely.
 * - Receive backend popup response and forward popup to content tab.
 * - Provide late-popup guard:
 *   If Gemma responds late and user already returned to study page,
 *   do not show old non-study popup. Backend history is still saved.
 * - Migrate old ngrok API URL to localhost because ngrok credit finished.
 *
 * Fixed:
 * - DEFAULT apiBaseUrl = http://localhost:3001/api
 * - old ngrok URL in chrome.storage is migrated to localhost
 * - direct popup fallback from HTTP response
 * - socket failure does not block popup
 * - popup includes voiceText + chatMessage + suggestedAction + historyInsight
 */

/* global chrome, SFAI_API_CLIENT */

const DEFAULTS = {
  apiBaseUrl: "http://localhost:3001/api",
  signalIntervalMs: 20000,
  screenshotIntervalMs: 90000,
  batchMaxSize: 4,
  batchFlushMs: 6000,
  maxQueueSize: 40,
  duplicateWindowMs: 10000,
  deviceType: "extension",
  label: "Chrome extension",
};

const RUNTIME = {
  startedAt: Date.now(),
  signalQueue: [],
  flushing: false,
  lastSignalAtByTab: new Map(),
  lastSentSignatureByTab: new Map(),
  lastScreenshotAtByTab: new Map(),
  lastPopupTargetTabId: null,
  lastLatePopupSkipped: null,
  socketReady: false,
  currentSession: null,
};

function nowIso() {
  return new Date().toISOString();
}

function clean(value = "") {
  return String(value || "").trim();
}

function isOldNgrokUrl(url = "") {
  const value = String(url || "").toLowerCase();

  return (
    value.includes("ngrok-free.dev") ||
    value.includes("ngrok.io") ||
    value.includes("enjoyer-extrude-neurology") ||
    value.includes("localhost:3000") ||
    value.includes("127.0.0.1:3000")
  );
}

function cleanBaseUrl(url = "") {
  const value = clean(url || DEFAULTS.apiBaseUrl).replace(/\/+$/, "");

  if (!value || isOldNgrokUrl(value)) {
    return DEFAULTS.apiBaseUrl;
  }

  if (value.endsWith("/api")) {
    return value;
  }

  return `${value}/api`;
}

function joinUrl(baseUrl, path = "") {
  const base = cleanBaseUrl(baseUrl);
  const cleanPath = String(path || "").replace(/^\/+/, "");
  return `${base}/${cleanPath}`;
}

function randomId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `sfai-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function migrateOldNgrokUrlToLocalhost() {
  try {
    const data = await chrome.storage.local.get(["apiBaseUrl"]);
    const current = clean(data.apiBaseUrl || "");

    if (!current || isOldNgrokUrl(current)) {
      await chrome.storage.local.set({
        apiBaseUrl: DEFAULTS.apiBaseUrl,
      });

      console.log(
        "Study Focus AI: migrated old API URL to",
        DEFAULTS.apiBaseUrl
      );
    }
  } catch (error) {
    console.warn(
      "Study Focus AI: API URL migration failed:",
      error?.message || error
    );
  }
}

async function ensureDeviceId() {
  const data = await chrome.storage.local.get(["deviceId"]);

  if (data.deviceId) return data.deviceId;

  const deviceId = randomId();

  await chrome.storage.local.set({
    deviceId,
    createdAt: nowIso(),
  });

  return deviceId;
}

async function getSettings() {
  await migrateOldNgrokUrlToLocalhost();

  const deviceId = await ensureDeviceId();

  const data = await chrome.storage.local.get([
    "apiBaseUrl",
    "deviceId",
    "userId",
    "goal",
    "monitoringActive",
    "signalIntervalMs",
    "screenshotIntervalMs",
    "batchMaxSize",
    "batchFlushMs",
    "currentSession",
    "sessionStatus",
    "lastActivityId",
    "socketStatus",
    "offlineQueueCount",
  ]);

  return {
    apiBaseUrl: cleanBaseUrl(data.apiBaseUrl || DEFAULTS.apiBaseUrl),
    deviceId: data.deviceId || deviceId,
    userId: clean(data.userId || ""),
    goal: clean(data.goal || ""),
    monitoringActive: Boolean(data.monitoringActive),
    signalIntervalMs: Number(data.signalIntervalMs || DEFAULTS.signalIntervalMs),
    screenshotIntervalMs: Number(
      data.screenshotIntervalMs || DEFAULTS.screenshotIntervalMs
    ),
    batchMaxSize: Number(data.batchMaxSize || DEFAULTS.batchMaxSize),
    batchFlushMs: Number(data.batchFlushMs || DEFAULTS.batchFlushMs),
    currentSession: data.currentSession || null,
    sessionStatus: data.sessionStatus || "unknown",
    lastActivityId: data.lastActivityId || "",
    socketStatus:
      data.socketStatus || (RUNTIME.socketReady ? "connected" : "unknown"),
    offlineQueueCount: Number(
      data.offlineQueueCount || RUNTIME.signalQueue.length || 0
    ),
  };
}

async function saveSettings(patch = {}) {
  const next = { ...patch };

  if (next.apiBaseUrl !== undefined) {
    next.apiBaseUrl = cleanBaseUrl(next.apiBaseUrl || DEFAULTS.apiBaseUrl);
  }

  await chrome.storage.local.set(next);
  return getSettings();
}

function safeUrl(url = "") {
  try {
    const parsed = new URL(url);
    return parsed.href;
  } catch {
    return String(url || "");
  }
}

function getDomainFromUrl(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isHttpUrl(url = "") {
  return /^https?:\/\//i.test(String(url || ""));
}

function isInternalOrUnsupportedUrl(url = "") {
  const value = String(url || "");

  return (
    !isHttpUrl(value) ||
    value.startsWith("chrome://") ||
    value.startsWith("chrome-extension://") ||
    value.startsWith("edge://") ||
    value.startsWith("about:") ||
    value.includes("127.0.0.1:4040") ||
    value.includes("localhost:4040")
  );
}

function urlsSamePageBackground(a = "", b = "") {
  try {
    const ua = new URL(a);
    const ub = new URL(b);

    return (
      ua.origin === ub.origin &&
      ua.pathname === ub.pathname &&
      ua.search === ub.search
    );
  } catch {
    return String(a || "") === String(b || "");
  }
}

function makeSignalSignature(signal = {}) {
  const page = signal.page || {};
  const behavior = signal.behavior || {};

  return JSON.stringify({
    url: page.url || "",
    title: page.title || "",
    textLength: page.textLength || 0,
    scrollDepth: behavior.scrollDepth || 0,
    tabSwitches: behavior.tabSwitches || 0,
    isHidden: behavior.isHidden || false,
  });
}

function shouldSkipDuplicate(tabId, signal = {}, settings = {}) {
  const now = Date.now();
  const lastAt = RUNTIME.lastSignalAtByTab.get(tabId) || 0;
  const signature = makeSignalSignature(signal);
  const previousSignature = RUNTIME.lastSentSignatureByTab.get(tabId);

  const duplicateWindowMs = Number(
    settings.duplicateWindowMs || DEFAULTS.duplicateWindowMs
  );

  if (previousSignature === signature && now - lastAt < duplicateWindowMs) {
    return true;
  }

  RUNTIME.lastSignalAtByTab.set(tabId, now);
  RUNTIME.lastSentSignatureByTab.set(tabId, signature);

  return false;
}

async function requestJson(path, options = {}) {
  if (globalThis.SFAI_API_CLIENT?.requestJson) {
    return globalThis.SFAI_API_CLIENT.requestJson(path, options);
  }

  const settings = await getSettings();
  const base = cleanBaseUrl(options.apiBaseUrl || settings.apiBaseUrl);
  const url = joinUrl(base, path);

  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs || 300000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
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
        json.message || json.error || json.raw || `HTTP ${response.status}`
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

async function captureScreenshot(tabId, settings = {}) {
  if (!tabId) return null;

  const now = Date.now();
  const last = RUNTIME.lastScreenshotAtByTab.get(tabId) || 0;
  const interval = Number(
    settings.screenshotIntervalMs || DEFAULTS.screenshotIntervalMs
  );

  if (now - last < interval) {
    return null;
  }

  try {
    const tab = await chrome.tabs.get(tabId);

    if (!tab || isInternalOrUnsupportedUrl(tab.url)) {
      return null;
    }

    const imageBase64 = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "jpeg",
      quality: 55,
    });

    RUNTIME.lastScreenshotAtByTab.set(tabId, now);

    return {
      screenshotBase64: imageBase64,
      screenshotCapturedAt: nowIso(),
      hasScreenshot: true,
    };
  } catch (error) {
    console.info("Study Focus AI screenshot skipped:", error?.message || error);
    return null;
  }
}

function normalizePageSignal(raw = {}, tab = {}) {
  const page = raw.page || raw || {};
  const url = safeUrl(page.url || tab.url || "");
  const domain = page.domain || getDomainFromUrl(url);

  return {
    url,
    domain,
    title: page.title || tab.title || "",
    topic: page.topic || "",
    visibleText: page.visibleText || page.text || page.bodyText || "",
    text: page.text || page.visibleText || "",
    bodyText: page.bodyText || page.visibleText || "",
    headings: Array.isArray(page.headings) ? page.headings.slice(0, 20) : [],
    paragraphs: Array.isArray(page.paragraphs)
      ? page.paragraphs.slice(0, 20)
      : [],
    links: Array.isArray(page.links) ? page.links.slice(0, 20) : [],
    textLength: Number(page.textLength || page.visibleText?.length || 0),

    isBlank: Boolean(page.isBlank),
    isPdf: Boolean(page.isPdf || /\.pdf($|\?)/i.test(url)),
    isRestricted: Boolean(page.isRestricted),
    isSpa: Boolean(page.isSpa),
    hasIframes: Boolean(page.hasIframes),
  };
}

function normalizeBehavior(raw = {}) {
  const b = raw.behavior || raw || {};

  return {
    dwellMs: Number(b.dwellMs || b.durationMs || 0),
    durationMs: Number(b.durationMs || b.dwellMs || 0),
    scrollDepth: Number(b.scrollDepth || 0),
    scrollSpeed: Number(b.scrollSpeed || 0),
    tabSwitches: Number(b.tabSwitches || 0),
    idleMs: Number(b.idleMs || 0),
    typingCount: Number(b.typingCount || b.keyEvents || 0),
    mouseMoves: Number(b.mouseMoves || b.mouseEvents || 0),
    routeChanges: Number(b.routeChanges || 0),
    iframeCount: Number(b.iframeCount || 0),
    isHidden: Boolean(b.isHidden),
  };
}

async function buildSignalPayload(raw = {}, sender = {}) {
  const settings = await getSettings();
  const tab = sender?.tab || {};
  const screenshot = await captureScreenshot(tab.id, settings);

  const page = normalizePageSignal(raw, tab);
  const behavior = normalizeBehavior(raw);

  return {
    deviceId: settings.deviceId,
    userId: settings.userId,
    goal: raw.goal || settings.goal || "",
    sessionId:
      raw.sessionId ||
      settings.currentSession?._id ||
      settings.currentSession?.id ||
      "",
    source: "chrome-extension",
    deviceType: "extension",
    label: "Chrome extension",
    clientTime: nowIso(),
    extensionVersion: chrome.runtime.getManifest()?.version || "unknown",

    page: {
      ...page,
      ...(screenshot || {}),
    },

    behavior,

    raw: {
      url: page.url,
      tabId: tab.id,
      windowId: tab.windowId,
      senderFrameId: sender.frameId,
    },
  };
}

function extractPopupFromBackendData(data = {}) {
  if (!data) return null;

  if (data.popup) return data.popup;
  if (data.data?.popup) return data.data.popup;
  if (data.result?.popup) return data.result.popup;
  if (data.dashboard?.liveInterventionCard?.popup) {
    return data.dashboard.liveInterventionCard.popup;
  }

  return null;
}

function getPopupSourceUrl(data = {}) {
  const popup = extractPopupFromBackendData(data);

  return (
    popup?.page?.url ||
    data?.activity?.page?.url ||
    data?.data?.activity?.page?.url ||
    data?.dashboard?.liveInterventionCard?.page?.url ||
    ""
  );
}

async function rememberLatePopupSkipped(tabId, data = {}, currentUrl = "") {
  const popup = extractPopupFromBackendData(data);

  RUNTIME.lastLatePopupSkipped = {
    tabId,
    currentUrl,
    popupSourceUrl: getPopupSourceUrl(data),
    popupTitle: popup?.title || "",
    popupType: popup?.type || "",
    at: nowIso(),
  };

  try {
    await chrome.storage.local.set({
      lastLatePopupSkipped: RUNTIME.lastLatePopupSkipped,
    });
  } catch {}
}

async function safeSendPopupToTab(tabId, data) {
  const popup = extractPopupFromBackendData(data);

  if (!tabId || !popup?.shouldShow) return false;

  try {
    const targetTab = await chrome.tabs.get(tabId);
    const currentUrl = targetTab?.url || "";
    const popupSourceUrl = getPopupSourceUrl(data);

    /**
     * Important:
     * If Gemma is slow and user already returned to a different/study page,
     * do not show old non-study popup.
     * Backend still saves the history.
     */
    if (
      popupSourceUrl &&
      currentUrl &&
      !urlsSamePageBackground(popupSourceUrl, currentUrl)
    ) {
      await rememberLatePopupSkipped(tabId, data, currentUrl);

      console.info("Study Focus AI: blocked stale late popup.", {
        popupSourceUrl,
        currentUrl,
      });

      return false;
    }

    const coachMessage =
      data.coachMessage ||
      data.data?.coachMessage ||
      (popup.chatMessage
        ? {
            role: "assistant",
            type: "motivation",
            title: popup.title || "AI Coach",
            text: popup.chatMessage,
            voiceText: popup.voiceText || "",
            suggestedAction: popup.suggestedAction || "",
            historyInsight: popup.historyInsight || "",
            priority: popup.priority || "medium",
            pattern: popup.pattern || "",
            createdAt: nowIso(),
          }
        : null);

    await chrome.tabs.sendMessage(tabId, {
      type: "STUDY_POPUP",
      payload: {
        ...data,
        popup,
        coachMessage,
      },
    });

    console.log("Study Focus AI: popup sent to tab", {
      tabId,
      title: popup.title,
      type: popup.type,
      priority: popup.priority,
      pattern: popup.pattern,
    });

    return true;
  } catch (error) {
    console.info("Popup send to tab skipped:", error?.message || error);
    return false;
  }
}

async function saveLastActivity(data = {}) {
  const activityId =
    data?.activity?._id ||
    data?.activity?.id ||
    data?.data?.activity?._id ||
    data?.data?.activity?.id ||
    data?.activityId ||
    "";

  if (activityId) {
    await chrome.storage.local.set({ lastActivityId: activityId });
  }
}

async function sendSingleSignalToBackend(payload) {
  if (globalThis.SFAI_API_CLIENT?.sendSignal) {
    return globalThis.SFAI_API_CLIENT.sendSignal(payload);
  }

  return requestJson("/study/signal", {
    method: "POST",
    timeoutMs: 70000,
    body: payload,
  });
}

async function sendSignalDirect(raw = {}, sender = {}) {
  const settings = await getSettings();

  if (!settings.monitoringActive && !raw.force) {
    return {
      ok: true,
      skipped: true,
      reason: "monitoring_inactive",
    };
  }

  const tabId = sender?.tab?.id;

  if (sender?.tab?.url && isInternalOrUnsupportedUrl(sender.tab.url)) {
    return {
      ok: true,
      skipped: true,
      reason: "unsupported_url",
    };
  }

  const payload = await buildSignalPayload(raw, sender);

  if (!payload.goal) {
    return {
      ok: true,
      skipped: true,
      reason: "goal_required",
      monitoringActive: settings.monitoringActive,
    };
  }

  if (tabId && shouldSkipDuplicate(tabId, payload, settings)) {
    return {
      ok: true,
      skipped: true,
      reason: "duplicate_signal",
    };
  }

  RUNTIME.lastPopupTargetTabId = tabId || RUNTIME.lastPopupTargetTabId;

  const data = await sendSingleSignalToBackend(payload);

  await saveLastActivity(data);

  /**
   * Direct popup fallback:
   * If socket fails, popup still comes from HTTP response.
   */
  if (data?.popup?.shouldShow && tabId) {
    await safeSendPopupToTab(tabId, data);
  }

  return data;
}

function trimQueue(settings = {}) {
  const max = Number(settings.maxQueueSize || DEFAULTS.maxQueueSize);

  if (RUNTIME.signalQueue.length > max) {
    RUNTIME.signalQueue.splice(0, RUNTIME.signalQueue.length - max);
  }
}

async function enqueueSignal(raw = {}, sender = {}) {
  const settings = await getSettings();

  if (!settings.monitoringActive && !raw.force) {
    return {
      ok: true,
      skipped: true,
      reason: "monitoring_inactive",
    };
  }

  const payload = await buildSignalPayload(raw, sender);

  if (!payload.goal) {
    return {
      ok: true,
      skipped: true,
      reason: "goal_required",
    };
  }

  const tabId = sender?.tab?.id;

  if (tabId && shouldSkipDuplicate(tabId, payload, settings)) {
    return {
      ok: true,
      skipped: true,
      reason: "duplicate_signal",
    };
  }

  RUNTIME.lastPopupTargetTabId = tabId || RUNTIME.lastPopupTargetTabId;

  RUNTIME.signalQueue.push({
    payload,
    tabId,
    enqueuedAt: Date.now(),
  });

  trimQueue(settings);

  if (RUNTIME.signalQueue.length >= settings.batchMaxSize) {
    flushQueue();
  } else {
    scheduleFlush(settings.batchFlushMs);
  }

  return {
    ok: true,
    queued: true,
    size: RUNTIME.signalQueue.length,
  };
}

let flushTimer = null;

function scheduleFlush(delayMs = DEFAULTS.batchFlushMs) {
  if (flushTimer) return;

  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushQueue();
  }, Number(delayMs || DEFAULTS.batchFlushMs));
}

async function sendBatchToBackend(items = []) {
  if (!items.length) return null;

  const settings = await getSettings();

  if (items.length === 1) {
    return sendSingleSignalToBackend(items[0].payload);
  }

  if (globalThis.SFAI_API_CLIENT?.sendSignalBatch) {
    return globalThis.SFAI_API_CLIENT.sendSignalBatch({
      signals: items.map((item) => item.payload),
      deviceId: settings.deviceId,
      userId: settings.userId,
    });
  }

  return requestJson("/study/signals/batch", {
    method: "POST",
    timeoutMs: 70000,
    body: {
      deviceId: settings.deviceId,
      userId: settings.userId,
      source: "chrome-extension-batch",
      deviceType: "extension",
      label: "Chrome extension",
      signals: items.map((item) => item.payload),
    },
  });
}

async function flushQueue() {
  if (RUNTIME.flushing) return;

  if (!RUNTIME.signalQueue.length) return;

  RUNTIME.flushing = true;

  const items = RUNTIME.signalQueue.splice(0, RUNTIME.signalQueue.length);

  try {
    const result = await sendBatchToBackend(items);

    await saveLastActivity(result);

    const popupTargetTabId =
      items[items.length - 1]?.tabId || RUNTIME.lastPopupTargetTabId;

    if (result?.popup?.shouldShow && popupTargetTabId) {
      await safeSendPopupToTab(popupTargetTabId, result);
    }

    return result;
  } catch (error) {
    console.warn("Study Focus AI queue flush failed:", error?.message || error);

    /**
     * Push back recent items, but don't grow forever.
     */
    RUNTIME.signalQueue.unshift(...items.slice(-DEFAULTS.maxQueueSize));
    trimQueue();

    return {
      ok: false,
      message: error?.message || String(error),
    };
  } finally {
    RUNTIME.flushing = false;
  }
}

async function startSession({ goal = "", userId = "" } = {}) {
  const settings = await getSettings();

  const finalGoal = goal || settings.goal || "";
  if (!finalGoal) {
    throw new Error("Study goal is required before starting a session.");
  }

  const result = globalThis.SFAI_API_CLIENT?.startSession
    ? await globalThis.SFAI_API_CLIENT.startSession({
        goal: finalGoal,
        deviceId: settings.deviceId,
        userId: userId || settings.userId,
      })
    : await requestJson("/study/session/start", {
        method: "POST",
        body: {
          deviceId: settings.deviceId,
          userId: userId || settings.userId,
          goal: finalGoal,
          deviceType: "extension",
          source: "chrome-extension",
          label: "Chrome extension",
        },
      });

  const session = result?.session || result?.currentSession || result;

  await chrome.storage.local.set({
    goal: finalGoal,
    monitoringActive: true,
    currentSession: session || null,
    sessionStatus: "active",
  });

  return result;
}

async function endSession() {
  const settings = await getSettings();

  const result = globalThis.SFAI_API_CLIENT?.endSession
    ? await globalThis.SFAI_API_CLIENT.endSession({
        deviceId: settings.deviceId,
        userId: settings.userId,
      })
    : await requestJson("/study/session/end", {
        method: "POST",
        body: {
          deviceId: settings.deviceId,
          userId: settings.userId,
          deviceType: "extension",
          source: "chrome-extension",
          label: "Chrome extension",
        },
      });

  await chrome.storage.local.set({
    monitoringActive: false,
    currentSession: null,
    sessionStatus: "ended",
  });

  return result;
}

async function saveGoal(goal = "", userId = "") {
  const settings = await getSettings();
  const finalGoal = clean(goal);

  if (!finalGoal) {
    throw new Error("Goal cannot be empty.");
  }

  const result = globalThis.SFAI_API_CLIENT?.saveGoal
    ? await globalThis.SFAI_API_CLIENT.saveGoal({
        goal: finalGoal,
        deviceId: settings.deviceId,
        userId: userId || settings.userId,
      })
    : await requestJson("/study/goal", {
        method: "POST",
        body: {
          deviceId: settings.deviceId,
          userId: userId || settings.userId,
          goal: finalGoal,
          deviceType: "extension",
          source: "chrome-extension",
          label: "Chrome extension",
        },
      });

  await chrome.storage.local.set({
    goal: finalGoal,
    userId: userId || settings.userId || "",
  });

  return result;
}

async function getDashboard() {
  const settings = await getSettings();

  if (globalThis.SFAI_API_CLIENT?.getDashboard) {
    return globalThis.SFAI_API_CLIENT.getDashboard({
      deviceId: settings.deviceId,
      userId: settings.userId,
    });
  }

  return requestJson(`/study/dashboard/${encodeURIComponent(settings.deviceId)}`);
}

async function getCurrentSession() {
  const settings = await getSettings();

  const result = globalThis.SFAI_API_CLIENT?.getCurrentSession
    ? await globalThis.SFAI_API_CLIENT.getCurrentSession({
        deviceId: settings.deviceId,
        userId: settings.userId,
      })
    : await requestJson(
        `/study/session/current/${encodeURIComponent(settings.deviceId)}`
      );

  const session =
    result?.session || result?.currentSession || result?.activeSession || null;

  const active = Boolean(result?.monitoringActive || session);

  await chrome.storage.local.set({
    monitoringActive: active,
    currentSession: session,
    sessionStatus: active ? "active" : "ended",
    offlineQueueCount: RUNTIME.signalQueue.length,
    socketStatus: RUNTIME.socketReady
      ? "connected"
      : settings.socketStatus || "unknown",
  });

  return {
    ...(result || {}),
    deviceId: settings.deviceId,
    userId: settings.userId || "",
    monitoringActive: active,
    sessionStatus: active ? "active" : "ended",
    session,
    currentSession: session,
    offlineQueueCount: RUNTIME.signalQueue.length,
    socketStatus: RUNTIME.socketReady
      ? "connected"
      : settings.socketStatus || "unknown",
  };
}

async function sendVoiceReply(payload = {}) {
  if (globalThis.SFAI_API_CLIENT?.sendVoiceReply) {
    return globalThis.SFAI_API_CLIENT.sendVoiceReply(payload);
  }

  return requestJson("/study/voice-reply", {
    method: "POST",
    timeoutMs: 70000,
    body: payload,
  });
}

async function sendFeedback(payload = {}) {
  if (globalThis.SFAI_API_CLIENT?.sendFeedback) {
    return globalThis.SFAI_API_CLIENT.sendFeedback(payload);
  }

  return requestJson("/study/feedback", {
    method: "POST",
    body: payload,
  });
}

async function popupIgnored(payload = {}) {
  if (globalThis.SFAI_API_CLIENT?.popupIgnored) {
    return globalThis.SFAI_API_CLIENT.popupIgnored(payload);
  }

  return requestJson("/study/popup-ignored", {
    method: "POST",
    body: payload,
  });
}

async function notifyTabsSettingsChanged() {
  try {
    const tabs = await chrome.tabs.query({});

    await Promise.all(
      tabs
        .filter((tab) => tab.id && isHttpUrl(tab.url))
        .map((tab) =>
          chrome.tabs
            .sendMessage(tab.id, {
              type: "STUDY_SETTINGS_UPDATED",
            })
            .catch(() => null)
        )
    );
  } catch {}
}

/* -------------------------------------------------------------------------- */
/* Chrome lifecycle                                                            */
/* -------------------------------------------------------------------------- */

chrome.runtime.onInstalled.addListener(async () => {
  await migrateOldNgrokUrlToLocalhost();

  const deviceId = await ensureDeviceId();
  const settings = await getSettings();

  await chrome.storage.local.set({
    apiBaseUrl: cleanBaseUrl(settings.apiBaseUrl || DEFAULTS.apiBaseUrl),
    deviceId,
    signalIntervalMs: settings.signalIntervalMs || DEFAULTS.signalIntervalMs,
    screenshotIntervalMs:
      settings.screenshotIntervalMs || DEFAULTS.screenshotIntervalMs,
  });

  console.log("Study Focus AI installed/updated", {
    deviceId,
    apiBaseUrl: cleanBaseUrl(settings.apiBaseUrl),
  });
});

chrome.runtime.onStartup.addListener(async () => {
  await migrateOldNgrokUrlToLocalhost();
  await ensureDeviceId();
});

/* -------------------------------------------------------------------------- */
/* Message handling                                                            */
/* -------------------------------------------------------------------------- */

function normalizeMessageType(type = "") {
  const value = String(type || "").trim();

  const aliases = {
    GET_SETTINGS: "STUDY_GET_SETTINGS",
    SAVE_SETTINGS: "STUDY_SAVE_SETTINGS",
    SAVE_GOAL: "STUDY_SAVE_GOAL",
    START_STUDY_SESSION: "STUDY_START_SESSION",
    END_STUDY_SESSION: "STUDY_END_SESSION",
    GET_CURRENT_SESSION: "STUDY_GET_CURRENT_SESSION",
    GET_DASHBOARD: "STUDY_GET_DASHBOARD",
    SIGNAL: "STUDY_SIGNAL",
    SIGNAL_QUEUED: "STUDY_SIGNAL_QUEUED",
    FLUSH_QUEUE: "STUDY_FLUSH_QUEUE",
    VOICE_REPLY: "STUDY_VOICE_REPLY",
    FEEDBACK: "STUDY_FEEDBACK",
    POPUP_IGNORED: "STUDY_POPUP_IGNORED",
    CONTENT_READY: "STUDY_CONTENT_READY",
  };

  return aliases[value] || value;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const originalType = message?.type;
  const type = normalizeMessageType(originalType);
  const payload = message?.payload || {};

  (async () => {
    try {
      switch (type) {
        case "STUDY_GET_SETTINGS": {
          sendResponse({
            ok: true,
            data: await getSettings(),
          });
          break;
        }

        case "STUDY_SAVE_SETTINGS": {
          const data = await saveSettings(payload);
          await notifyTabsSettingsChanged();
          sendResponse({ ok: true, data });
          break;
        }

        case "STUDY_SAVE_GOAL": {
          const data = await saveGoal(payload.goal, payload.userId);
          await notifyTabsSettingsChanged();
          sendResponse({ ok: true, data });
          break;
        }

        case "STUDY_START_SESSION": {
          const data = await startSession(payload);
          await notifyTabsSettingsChanged();
          sendResponse({ ok: true, data });
          break;
        }

        case "STUDY_END_SESSION": {
          const data = await endSession();
          await notifyTabsSettingsChanged();
          sendResponse({ ok: true, data });
          break;
        }

        case "STUDY_GET_CURRENT_SESSION": {
          const data = await getCurrentSession();
          sendResponse({ ok: true, data });
          break;
        }

        case "STUDY_GET_DASHBOARD": {
          const data = await getDashboard();
          sendResponse({ ok: true, data });
          break;
        }

        case "EXTENSION_CLIENT_STATE": {
          const nextSocketStatus =
            message?.socketStatus || payload.socketStatus || "unknown";

          const nextMonitoringActive = Boolean(
            message?.monitoringActive ?? payload.monitoringActive
          );

          const nextSessionStatus =
            message?.sessionStatus || payload.sessionStatus || "unknown";

          RUNTIME.socketReady = nextSocketStatus === "connected";

          await chrome.storage.local.set({
            socketStatus: nextSocketStatus,
            monitoringActive: nextMonitoringActive,
            sessionStatus: nextSessionStatus,
            offlineQueueCount: RUNTIME.signalQueue.length,
          });

          sendResponse({
            ok: true,
            data: {
              socketStatus: nextSocketStatus,
              monitoringActive: nextMonitoringActive,
              sessionStatus: nextSessionStatus,
              offlineQueueCount: RUNTIME.signalQueue.length,
            },
          });
          break;
        }

        case "STUDY_SIGNAL": {
          const data = await sendSignalDirect(payload, sender);
          sendResponse({ ok: true, data });
          break;
        }

        case "STUDY_SIGNAL_QUEUED": {
          const data = await enqueueSignal(payload, sender);
          sendResponse({ ok: true, data });
          break;
        }

        case "STUDY_FLUSH_QUEUE": {
          const data = await flushQueue();
          sendResponse({ ok: true, data });
          break;
        }

        case "STUDY_VOICE_REPLY": {
          const settings = await getSettings();

          const data = await sendVoiceReply({
            ...payload,
            deviceId: payload.deviceId || settings.deviceId,
            userId: payload.userId || settings.userId,
          });

          await saveLastActivity(data);

          if (data?.popup?.shouldShow && sender?.tab?.id) {
            await safeSendPopupToTab(sender.tab.id, data);
          }

          sendResponse({ ok: true, data });
          break;
        }

        case "STUDY_FEEDBACK": {
          const settings = await getSettings();

          const data = await sendFeedback({
            ...payload,
            deviceId: payload.deviceId || settings.deviceId,
            userId: payload.userId || settings.userId,
          });

          sendResponse({ ok: true, data });
          break;
        }

        case "STUDY_POPUP_IGNORED": {
          const settings = await getSettings();

          const data = await popupIgnored({
            ...payload,
            deviceId: payload.deviceId || settings.deviceId,
            userId: payload.userId || settings.userId,
          });

          sendResponse({ ok: true, data });
          break;
        }

        case "STUDY_CONTENT_READY": {
          sendResponse({
            ok: true,
            data: {
              settings: await getSettings(),
              runtime: {
                startedAt: RUNTIME.startedAt,
                queueSize: RUNTIME.signalQueue.length,
                lastLatePopupSkipped: RUNTIME.lastLatePopupSkipped,
              },
            },
          });
          break;
        }

        default: {
          sendResponse({
            ok: false,
            message: `Unknown message type: ${originalType || type}`,
          });
          break;
        }
      }
    } catch (error) {
      console.warn("Background message failed:", error?.message || error);

      sendResponse({
        ok: false,
        message: error?.message || String(error),
      });
    }
  })();

  return true;
});

/* -------------------------------------------------------------------------- */
/* Tab events                                                                  */
/* -------------------------------------------------------------------------- */

chrome.tabs.onRemoved.addListener((tabId) => {
  RUNTIME.lastSignalAtByTab.delete(tabId);
  RUNTIME.lastSentSignatureByTab.delete(tabId);
  RUNTIME.lastScreenshotAtByTab.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab?.url && isHttpUrl(tab.url)) {
    RUNTIME.lastPopupTargetTabId = tabId;
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  RUNTIME.lastPopupTargetTabId = activeInfo.tabId;

  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (!tab || !isHttpUrl(tab.url)) return;

    chrome.tabs
      .sendMessage(activeInfo.tabId, {
        type: "STUDY_TAB_ACTIVATED",
        payload: {
          url: tab.url,
          title: tab.title || "",
          at: nowIso(),
        },
      })
      .catch(() => null);
  } catch {}
});

/* -------------------------------------------------------------------------- */
/* Periodic queue flush                                                        */
/* -------------------------------------------------------------------------- */

setInterval(() => {
  if (RUNTIME.signalQueue.length) {
    flushQueue();
  }
}, DEFAULTS.batchFlushMs);

/* -------------------------------------------------------------------------- */
/* Debug API                                                                   */
/* -------------------------------------------------------------------------- */

globalThis.__SFAI_BACKGROUND__ = {
  getSettings,
  saveSettings,
  startSession,
  endSession,
  saveGoal,
  getDashboard,
  sendSignalDirect,
  enqueueSignal,
  flushQueue,
  migrateOldNgrokUrlToLocalhost,
  runtime: RUNTIME,
};