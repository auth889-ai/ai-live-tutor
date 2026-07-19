/**
 * extension/core/popupSession.js
 * ------------------------------------------------------------
 * Full fixed popup session controller.
 *
 * Fixes:
 * - Reads backend current-session envelope: { monitoringActive, session }
 * - Reads Chrome local storage fallback if socket/content script is not running
 * - Uses modern STUDY_* message names, while background also supports old aliases
 * - Does not show PAUSED only because socket is unknown
 */

(function initSfaiPopupSession(global) {
  let initialized = false;

  function $(id) {
    return document.getElementById(id);
  }

  async function sendMessage(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
  }

  async function getLocalState() {
    try {
      return await chrome.storage.local.get([
        "monitoringActive",
        "sessionStatus",
        "currentSession",
        "socketStatus",
        "offlineQueueCount",
        "deviceId",
      ]);
    } catch {
      return {};
    }
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function setSessionStatus(status, active) {
    setText("sessionStatus", status || "unknown");

    const badge = $("sessionBadge");
    if (badge) {
      badge.textContent = active ? "ACTIVE" : "PAUSED";
      badge.className = active ? "badge active" : "badge paused";
    }
  }

  async function refresh() {
    const localBefore = await getLocalState();
    const res = await sendMessage({ type: "STUDY_GET_CURRENT_SESSION" });
    const localAfter = await getLocalState();
    const local = { ...localBefore, ...localAfter };

    if (!res?.ok) {
      const localActive = Boolean(local.monitoringActive || local.currentSession);

      setSessionStatus(
        localActive ? "Monitoring active" : res?.message || "Monitoring paused",
        localActive
      );

      setText("socketStatus", local.socketStatus || "unknown");
      setText("offlineQueueCount", String(local.offlineQueueCount || 0));
      setText("deviceId", local.deviceId || "...");
      return;
    }

    const data = res.data || {};
    const session =
      data.session || data.currentSession || data.activeSession || local.currentSession || null;

    const active = Boolean(data.monitoringActive || session || local.monitoringActive);

    setSessionStatus(active ? "Monitoring active" : "Monitoring paused", active);
    setText("socketStatus", data.socketStatus || local.socketStatus || "unknown");

    setText(
      "offlineQueueCount",
      String(data.offlineQueueCount ?? local.offlineQueueCount ?? 0)
    );

    setText("deviceId", data.deviceId || local.deviceId || "...");
  }

  async function startSession() {
    setSessionStatus("Starting...", false);

    const goal = $("goal")?.value?.trim?.() || "";

    const res = await sendMessage({
      type: "STUDY_START_SESSION",
      payload: { goal },
    });

    if (!res?.ok) {
      setSessionStatus(res?.message || "Start failed", false);
      return;
    }

    await chrome.storage.local.set({
      monitoringActive: true,
      sessionStatus: "active",
      currentSession: res.data?.session || res.data?.currentSession || res.data || null,
    });

    await refresh();
  }

  async function endSession() {
    setSessionStatus("Ending...", true);

    const res = await sendMessage({
      type: "STUDY_END_SESSION",
      payload: {},
    });

    if (!res?.ok) {
      setSessionStatus(res?.message || "End failed", true);
      return;
    }

    await chrome.storage.local.set({
      monitoringActive: false,
      sessionStatus: "ended",
      currentSession: null,
    });

    await refresh();
  }

  function init() {
    if (initialized) {
      refresh();
      return;
    }

    initialized = true;

    $("startSession")?.addEventListener("click", startSession);
    $("endSession")?.addEventListener("click", endSession);
    $("refreshSession")?.addEventListener("click", refresh);

    refresh();
  }

  global.SFAI_POPUP_SESSION = {
    init,
    refresh,
  };
})(window);