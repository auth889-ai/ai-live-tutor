/**
 * popup.js
 * ------------------------------------------------------------
 * Fixed:
 * - Uses background.js supported STUDY_* message names.
 * - Saves API/settings.
 * - Saves goal.
 * - Refreshes session UI after changes.
 */

const apiBaseUrlEl = document.getElementById("apiBaseUrl");
const signalIntervalMsEl = document.getElementById("signalIntervalMs");
const screenshotIntervalMsEl = document.getElementById("screenshotIntervalMs");
const goalEl = document.getElementById("goal");
const deviceIdEl = document.getElementById("deviceId");
const statusEl = document.getElementById("status");

const saveSettingsBtn = document.getElementById("saveSettings");
const saveGoalBtn = document.getElementById("saveGoal");

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

async function sendMessage(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (err) {
    console.error("Popup sendMessage error:", err);
    return { ok: false, message: err.message };
  }
}

async function load() {
  try {
    const res = await sendMessage({ type: "STUDY_GET_SETTINGS" });
    const data = res?.data || {};

    apiBaseUrlEl.value = data.apiBaseUrl || "http://localhost:3000/api";
    signalIntervalMsEl.value = data.signalIntervalMs || 12000;
    screenshotIntervalMsEl.value = data.screenshotIntervalMs || 90000;
    goalEl.value = data.goal || "";
    deviceIdEl.textContent = data.deviceId || "...";

    setStatus(data.goal ? "Goal saved" : "Set your goal");

    window.SFAI_POPUP_SESSION?.init?.();
  } catch (err) {
    console.error(err);
    setStatus("Failed to load");
  }
}

saveSettingsBtn?.addEventListener("click", async () => {
  try {
    setStatus("Saving settings...");

    const res = await sendMessage({
      type: "STUDY_SAVE_SETTINGS",
      payload: {
        apiBaseUrl: apiBaseUrlEl.value.trim(),
        signalIntervalMs: Number(signalIntervalMsEl.value || 12000),
        screenshotIntervalMs: Number(screenshotIntervalMsEl.value || 90000),
      },
    });

    if (!res?.ok) throw new Error(res?.message || "Settings save failed");

    setStatus("Settings saved");
    window.SFAI_POPUP_SESSION?.refresh?.();
  } catch (error) {
    console.error(error);
    setStatus(error.message);
  }
});

saveGoalBtn?.addEventListener("click", async () => {
  try {
    const goal = goalEl.value.trim();

    if (!goal) {
      setStatus("Goal is required");
      return;
    }

    setStatus("Saving goal...");

    const res = await sendMessage({
      type: "STUDY_SAVE_GOAL",
      payload: {
        goal,
      },
    });

    if (!res?.ok) throw new Error(res?.message || "Goal save failed");

    deviceIdEl.textContent = res.data?.deviceId || deviceIdEl.textContent;
    setStatus("Goal saved. Start a session to monitor.");

    window.SFAI_POPUP_SESSION?.refresh?.();
  } catch (error) {
    console.error(error);
    setStatus(error.message);
  }
});

load();