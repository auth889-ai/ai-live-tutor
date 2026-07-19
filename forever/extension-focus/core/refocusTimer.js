/**
 * extension/core/refocusTimer.js
 * ------------------------------------------------------------
 * Production-safe refocus timer for Study Focus AI.
 *
 * Purpose:
 * - User confirms non-study.
 * - Extension starts a grace timer.
 * - Before AI talks, extension checks latest page/AI decision.
 * - If user returned to study/partial-study, AI does NOT interrupt.
 * - If user is still non-study after grace period, AI sends a refocus reply.
 *
 * Why this file exists:
 * - Prevents late AI voice after user already fixed behavior.
 * - Prevents annoying "old distraction" nudges.
 * - Keeps logic outside content.js to follow OCP.
 *
 * Requires:
 * - chrome.storage.local
 * - chrome.runtime.sendMessage
 * - optional window.SFAI_OVERLAY_CHAT
 */

(function initSfaiRefocusTimer(global) {
  const STORAGE_KEY = "sfaiRefocusTimer";
  const LATEST_DECISION_KEY = "sfaiLatestDecision";

  const DEFAULT_GRACE_MS = 60 * 1000;
  const RECENT_DECISION_WINDOW_MS = 90 * 1000;
  const MAX_TIMER_AGE_MS = 10 * 60 * 1000;

  let timerId = null;

  function safeNow() {
    return Date.now();
  }

  function clean(value = "") {
    return String(value || "").trim();
  }

  function isStudyLike(type = "") {
    const value = clean(type).toLowerCase();
    return value === "study" || value === "partial";
  }

  function isNonStudyLike(type = "") {
    const value = clean(type).toLowerCase();
    return value === "non-study" || value === "nonstudy" || value === "distraction";
  }

  function currentPageSnapshot() {
    try {
      return {
        url: location.href,
        domain: location.hostname,
        path: location.pathname,
        title: document.title || "",
        at: safeNow(),
      };
    } catch {
      return {
        url: "",
        domain: "",
        path: "",
        title: "",
        at: safeNow(),
      };
    }
  }

  function samePage(a = "", b = "") {
    if (!a || !b) return false;

    try {
      const left = new URL(a);
      const right = new URL(b);

      if (left.hostname !== right.hostname) return false;
      if (left.pathname !== right.pathname) return false;

      return true;
    } catch {
      return a === b;
    }
  }

  async function getTimer() {
    const data = await chrome.storage.local.get([STORAGE_KEY]);
    return data[STORAGE_KEY] || null;
  }

  async function setTimer(timer) {
    await chrome.storage.local.set({ [STORAGE_KEY]: timer });
  }

  async function clearTimer() {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }

    await chrome.storage.local.remove([STORAGE_KEY]);
  }

  async function getLatestDecision() {
    const data = await chrome.storage.local.get([LATEST_DECISION_KEY]);
    return data[LATEST_DECISION_KEY] || null;
  }

  async function saveTimerEvent(eventName, payload = {}) {
    const key = "sfaiRefocusTimerEvents";
    const data = await chrome.storage.local.get([key]);
    const events = Array.isArray(data[key]) ? data[key] : [];

    events.push({
      eventName,
      payload,
      at: new Date().toISOString(),
    });

    await chrome.storage.local.set({
      [key]: events.slice(-50),
    });
  }

  function decisionIsRecent(latest) {
    if (!latest) return false;

    const latestAt = Number(latest.at || 0);
    if (!Number.isFinite(latestAt) || latestAt <= 0) return false;

    return safeNow() - latestAt < RECENT_DECISION_WINDOW_MS;
  }

  function latestDecisionShowsRecovery(latest) {
    if (!latest) return false;
    if (!decisionIsRecent(latest)) return false;

    return isStudyLike(latest.type);
  }

  function latestDecisionStillNonStudy(latest) {
    if (!latest) return false;
    if (!decisionIsRecent(latest)) return false;

    return isNonStudyLike(latest.type);
  }

  function timerIsTooOld(timer) {
    const startedAt = Number(timer?.startedAt || 0);
    if (!startedAt) return true;

    return safeNow() - startedAt > MAX_TIMER_AGE_MS;
  }

  function timerPageChanged(timer) {
    const current = currentPageSnapshot();
    const timerUrl = clean(timer?.page?.url || timer?.url || "");

    if (!timerUrl) return false;

    return !samePage(timerUrl, current.url);
  }

  async function shouldCancelBecauseRecovered(timer) {
    const latest = await getLatestDecision();

    if (latestDecisionShowsRecovery(latest)) {
      return {
        cancel: true,
        reason: "Latest AI decision is study/partial-study.",
        latest,
      };
    }

    if (timerPageChanged(timer)) {
      const current = currentPageSnapshot();

      /**
       * Page changed alone does not always mean recovery.
       * But it means the old non-study timer should not speak on a new page.
       * We cancel quietly and let the new page produce its own fresh signal.
       */
      return {
        cancel: true,
        reason: "User changed page before timer fired.",
        latest,
        current,
      };
    }

    if (timerIsTooOld(timer)) {
      return {
        cancel: true,
        reason: "Timer is too old and was cancelled for safety.",
        latest,
      };
    }

    return {
      cancel: false,
      latest,
    };
  }

  async function start({
    activityId,
    goal = "",
    reason = "User confirmed this is non-study.",
    graceMs = DEFAULT_GRACE_MS,
    page = null,
  }) {
    if (!activityId) return null;

    await clearTimer();

    const pageSnapshot = page || currentPageSnapshot();

    const timer = {
      activityId,
      goal: clean(goal),
      reason: clean(reason),
      page: pageSnapshot,
      startedAt: safeNow(),
      expiresAt: safeNow() + Number(graceMs || DEFAULT_GRACE_MS),
      graceMs: Number(graceMs || DEFAULT_GRACE_MS),
      status: "waiting-for-recovery",
    };

    await setTimer(timer);
    await saveTimerEvent("timer_started", timer);

    global.SFAI_OVERLAY_CHAT?.setStatus?.("recovery timer");
    global.SFAI_OVERLAY_CHAT?.addAiMessage?.(
      "Okay. I’ll give you a little time to return to your study. If you come back, I won’t interrupt."
    );

    schedule(timer);
    return timer;
  }

  function schedule(timer) {
    if (timerId) clearTimeout(timerId);

    const remaining = Math.max(0, Number(timer.expiresAt || 0) - safeNow());

    timerId = setTimeout(async () => {
      const current = await getTimer();

      if (!current || current.status !== "waiting-for-recovery") return;

      await triggerRefocus(current);
    }, remaining);
  }

  async function restore() {
    const timer = await getTimer();

    if (!timer) return null;

    if (timerIsTooOld(timer)) {
      await clearTimer();
      await saveTimerEvent("timer_cleared_too_old", timer);
      return null;
    }

    if (Number(timer.expiresAt || 0) <= safeNow()) {
      await triggerRefocus(timer);
      return timer;
    }

    schedule(timer);
    return timer;
  }

  async function triggerRefocus(timer) {
    const cancelCheck = await shouldCancelBecauseRecovered(timer);

    if (cancelCheck.cancel) {
      await markRecovered({
        reason: cancelCheck.reason,
        silent: false,
      });

      await saveTimerEvent("timer_cancelled_before_refocus", cancelCheck);
      return;
    }

    const latest = cancelCheck.latest;

    /**
     * If latest decision is unknown or absent, we still should not blindly scream.
     * We only refocus if either:
     * - latest says non-study, or
     * - user is still on the same page that started the timer.
     */
    const sameAsTimerPage = !timerPageChanged(timer);
    const stillNonStudy = latestDecisionStillNonStudy(latest);

    if (!sameAsTimerPage && !stillNonStudy) {
      await markRecovered({
        reason: "Timer page is no longer current, and no recent non-study decision exists.",
        silent: false,
      });

      await saveTimerEvent("timer_cancelled_not_current", {
        timer,
        latest,
      });

      return;
    }

    await clearTimer();
    await saveTimerEvent("timer_refocus_triggered", {
      timer,
      latest,
    });

    global.SFAI_OVERLAY_CHAT?.setStatus?.("refocus");
    global.SFAI_OVERLAY_CHAT?.addAiMessage?.(
      "You still seem away from your study goal. Let’s return now."
    );

    try {
      await chrome.runtime.sendMessage({
        type: "STUDY_VOICE_REPLY",
        payload: {
          activityId: timer.activityId,
          message:
            "I am still on non-study content after the recovery grace period. Please help me refocus.",
          source: "extension",
          needsScreenshot: true,
        },
      });
    } catch (error) {
      console.warn("Refocus voice reply failed:", error?.message || error);
    }
  }

  async function markRecovered({
    reason = "User returned to study within the grace period.",
    silent = false,
  } = {}) {
    const timer = await getTimer();

    if (!timer) return false;

    await clearTimer();

    await saveTimerEvent("timer_recovered", {
      timer,
      reason,
    });

    if (!silent) {
      global.SFAI_OVERLAY_CHAT?.setStatus?.("recovered");
      global.SFAI_OVERLAY_CHAT?.addAiMessage?.(
        "Nice, you came back to studying. I won’t interrupt."
      );
    }

    try {
      await chrome.runtime.sendMessage({
        type: "STUDY_FEEDBACK",
        payload: {
          activityId: timer.activityId,
          userAnswer: "recovered",
          correctedType: "study",
          reason,
        },
      });
    } catch (error) {
      console.warn("Recovery feedback failed:", error?.message || error);
    }

    return true;
  }

  async function observeDecision(payload = {}) {
    const activity = payload.activity || payload.data?.activity || {};
    const ai = activity.ai || payload.ai || payload.data?.ai || {};
    const type = ai.type || payload.type || "";

    if (isStudyLike(type)) {
      await markRecovered({
        reason: "Latest AI decision shows user returned to study.",
        silent: false,
      });
    }
  }

  async function cancelIfCurrentPageChanged() {
    const timer = await getTimer();
    if (!timer) return false;

    if (timerPageChanged(timer)) {
      await markRecovered({
        reason: "User moved away from the original non-study page before timer fired.",
        silent: false,
      });

      return true;
    }

    return false;
  }

  global.SFAI_REFOCUS_TIMER = {
    start,
    restore,
    clear: clearTimer,
    markRecovered,
    observeDecision,
    cancelIfCurrentPageChanged,
    getTimer,
    getLatestDecision,
  };

  restore().catch(() => {});
})(window);