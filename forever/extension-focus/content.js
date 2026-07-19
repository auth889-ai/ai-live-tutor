/**
 * content.js
 * ------------------------------------------------------------------
 * Purpose:
 * - Watches websites only while a study session is active.
 * - Captures page text + behavior signals.
 * - Sends optimized signals to background.js.
 * - Connects to backend Socket.io.
 * - Shows AI popup on any website.
 * - Speaks backend-generated voice text.
 * - Lets user answer by button or voice.
 * - Shows explainability: why AI said study/distraction.
 *
 * Preserves old features:
 * - dynamic popup
 * - voice speech output
 * - speech recognition input
 * - chat transcript in popup
 * - feedback buttons
 * - Socket.io study:update
 * - screenshot request through background.js
 * - batching support through background queue
 * - duplicate hash support
 * - inactive tab pause
 * - CPU optimized DOM collection
 * - blank/PDF/iframe/SPA/large/restricted page metadata
 * - popup ignored tracking
 * - voice final decision handling
 * - explainability UI
 *
 * Adds:
 * - session-aware monitoring pause/resume
 * - extension joins socket as deviceType: "extension"
 * - listens to session-started/session-ended/session_required
 * - stops DOM/screenshot/signal sending when session ended
 * - overlay chat support through SFAI_OVERLAY_CHAT
 * - voice/chat replies use saved backend conversation history
 * - stale old AI response protection
 * - ignores old popup/voice if user already moved to another page
 *
 * FIXED:
 * - content.js no longer emits both "study:join" and old "join".
 * - signalLoop no longer opens a second socket through connectSocket().
 * - sessionBridge.js should own the extension Socket.io connection.
 */

const STATE = {
  startedAt: Date.now(),
  lastActivityAt: Date.now(),

  scrollDepth: 0,
  lastScrollY: window.scrollY || 0,
  lastScrollAt: Date.now(),
  scrollSpeed: 0,

  tabSwitches: 0,
  typingCount: 0,
  mouseMoves: 0,
  routeChanges: 0,
  iframeCount: 0,

  signalIntervalMs: 6000,
  screenshotIntervalMs: 45000,
  lastScreenshotRequestAt: 0,
  lastSignalHash: "",
  lastUrl: location.href,

  socket: null,
  socketConnected: false,
  joinedDeviceId: null,

  monitoringActive: false,
  sessionStatus: "unknown",

  activePopup: null,
  activeActivityId: null,
  popupShownAt: 0,
  popupCloseTracked: false,

  recognition: null,
  recognizing: false,

  loopStopped: false,
  cleanupTimer: null,
};


const STALE_RESPONSE_MAX_AGE_MS = 5 * 60 * 1000;
const SAME_PAGE_QUERY_SENSITIVE = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(text = "") {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isExtensionContextInvalidatedError(error) {
  const msg = String(error?.message || error || "");

  return (
    msg.includes("Extension context invalidated") ||
    msg.includes("Could not establish connection") ||
    msg.includes("Receiving end does not exist") ||
    msg.includes("The message port closed") ||
    msg.includes("message channel closed")
  );
}

function hasLiveExtensionContext() {
  try {
    return Boolean(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

function stopBecauseExtensionContextGone() {
  STATE.loopStopped = true;
  window.__STUDY_AI_RUNNING__ = false;

  try {
    if (STATE.socket) {
      STATE.socket.removeAllListeners?.();
      STATE.socket.off?.();
      STATE.socket.disconnect?.();
      STATE.socket = null;
    }
  } catch {}

  try {
    if (STATE.cleanupTimer) {
      clearInterval(STATE.cleanupTimer);
      STATE.cleanupTimer = null;
    }
  } catch {}

  try {
    if (STATE.recognition && STATE.recognizing) {
      STATE.recognition.stop();
    }
  } catch {}

  try {
    window.speechSynthesis?.cancel();
  } catch {}
}

function getDomain() {
  try {
    return location.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isRestrictedPage() {
  const url = location.href.toLowerCase();

  return (
    url.startsWith("chrome://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("moz-extension://") ||
    url.startsWith("devtools://")
  );
}

function isPdfPage() {
  const url = location.href.toLowerCase();
  const title = (document.title || "").toLowerCase();

  return (
    url.includes(".pdf") ||
    title.endsWith(".pdf") ||
    document.contentType === "application/pdf"
  );
}

function isBlankPage(text) {
  return !document.title && cleanText(text).length < 20;
}

function getIframeCount() {
  try {
    return document.querySelectorAll("iframe").length;
  } catch {
    return 0;
  }
}

function isTopFrame() {
  try {
    return window.top === window.self;
  } catch {
    return false;
  }
}

function lightweightHash(input) {
  const text = String(input || "");
  let hash = 2166136261;

  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }

  return `h${(hash >>> 0).toString(16)}`;
}

function getVisibleText(maxChars = 9000) {
  try {
    const raw = document.body?.innerText || "";
    return cleanText(raw).slice(0, maxChars);
  } catch {
    return "";
  }
}

function getHeadings() {
  try {
    return [...document.querySelectorAll("h1,h2,h3")]
      .map((el) => cleanText(el.innerText))
      .filter(Boolean)
      .slice(0, 30);
  } catch {
    return [];
  }
}

function getParagraphs() {
  try {
    return [...document.querySelectorAll("p")]
      .map((el) => cleanText(el.innerText))
      .filter((t) => t.length > 20)
      .slice(0, 40);
  } catch {
    return [];
  }
}

function getLinks() {
  try {
    return [...document.querySelectorAll("a[href]")]
      .map((a) => ({
        text: cleanText(a.innerText).slice(0, 80),
        href: a.href,
      }))
      .filter((x) => x.text || x.href)
      .slice(0, 40);
  } catch {
    return [];
  }
}

function collectPage() {
  const visibleText = getVisibleText();
  const iframeCount = getIframeCount();

  STATE.iframeCount = iframeCount;

  return {
    url: location.href,
    domain: getDomain(),
    title: document.title || "",
    visibleText,
    headings: getHeadings(),
    paragraphs: getParagraphs(),
    links: getLinks(),

    isBlank: isBlankPage(visibleText),
    isPdf: isPdfPage(),
    isRestricted: isRestrictedPage(),
    isSpa: STATE.routeChanges > 0,
    hasIframes: iframeCount > 0,
    textLength: visibleText.length,
  };
}

function collectBehavior() {
  const now = Date.now();

  return {
    dwellMs: now - STATE.startedAt,
    scrollDepth: STATE.scrollDepth,
    scrollSpeed: STATE.scrollSpeed,
    tabSwitches: STATE.tabSwitches,
    idleMs: now - STATE.lastActivityAt,
    typingCount: STATE.typingCount,
    mouseMoves: STATE.mouseMoves,
    routeChanges: STATE.routeChanges,
    iframeCount: STATE.iframeCount,
    isHidden: document.visibilityState === "hidden",
  };
}

function markActivity() {
  STATE.lastActivityAt = Date.now();
}

function buildSignalHash(page, behavior, needsScreenshot) {
  return lightweightHash(
    [
      page.url,
      page.title,
      page.visibleText.slice(0, 600),
      behavior.scrollDepth,
      behavior.tabSwitches,
      behavior.routeChanges,
      behavior.isHidden ? "hidden" : "visible",
      needsScreenshot ? "shot" : "no-shot",
    ].join("|")
  );
}

function shouldSkipSignal(page, behavior) {
  if (!isTopFrame()) return true;
  if (behavior.isHidden) return true;
  if (page.isRestricted) return true;
  return false;
}

function urlsSamePage(a = "", b = "") {
  if (!a || !b) return false;

  try {
    const left = new URL(a);
    const right = new URL(b);

    if (left.hostname !== right.hostname) return false;
    if (left.pathname !== right.pathname) return false;

    if (SAME_PAGE_QUERY_SENSITIVE && left.search !== right.search) {
      return false;
    }

    return true;
  } catch {
    return a === b;
  }
}

function getPayloadActivity(payload = {}) {
  return payload.activity || payload.data?.activity || payload.data?.data?.activity || {};
}

function getPayloadAi(payload = {}) {
  const activity = getPayloadActivity(payload);
  return activity.ai || payload.ai || payload.data?.ai || payload.data?.data?.ai || {};
}

function getPayloadUrl(payload = {}) {
  const activity = getPayloadActivity(payload);

  return (
    activity?.page?.url ||
    payload?.popup?.page?.url ||
    payload?.page?.url ||
    payload?.data?.page?.url ||
    ""
  );
}

function getPayloadActivityId(payload = {}) {
  const activity = getPayloadActivity(payload);

  return (
    activity?._id ||
    activity?.id ||
    payload?.popup?.activityId ||
    payload?.activityId ||
    payload?.data?.activityId ||
    ""
  );
}

function getPayloadCreatedAt(payload = {}) {
  const activity = getPayloadActivity(payload);

  return (
    activity?.createdAt ||
    activity?.updatedAt ||
    payload?.createdAt ||
    payload?.updatedAt ||
    payload?.sentAt ||
    payload?.data?.createdAt ||
    ""
  );
}

function isStaleAiResponse(payload = {}) {
  const responseUrl = getPayloadUrl(payload);

  if (!responseUrl) return false;

  return !urlsSamePage(responseUrl, location.href);
}

function isOldAiResponse(payload = {}, maxAgeMs = STALE_RESPONSE_MAX_AGE_MS) {
  const createdAt = getPayloadCreatedAt(payload);

  if (!createdAt) return false;

  const responseTime = new Date(createdAt).getTime();
  if (!Number.isFinite(responseTime)) return false;

  return Date.now() - responseTime > maxAgeMs;
}

function shouldIgnoreAiResponse(payload = {}) {
  if (!payload) return false;

  if (isStaleAiResponse(payload)) {
    console.info("Study Focus AI: ignored stale AI response for old URL.");
    return true;
  }

  if (isOldAiResponse(payload)) {
    console.info("Study Focus AI: ignored old AI response.");
    return true;
  }

  return false;
}

function isNonStudyAiPayload(payload = {}) {
  const activity = getPayloadActivity(payload);
  const ai = getPayloadAi(payload);
  const popup = payload?.popup || payload?.data?.popup || {};

  const type = String(ai?.type || "").toLowerCase();
  const decision = String(
    ai?.decision ||
      activity?.decision?.action ||
      payload?.action ||
      popup?.type ||
      ""
  ).toLowerCase();

  return (
    type === "non-study" ||
    type === "non_study" ||
    decision.includes("intervention") ||
    decision.includes("refocus") ||
    decision.includes("distract") ||
    decision.includes("non-study") ||
    decision.includes("non_study")
  );
}

async function rememberStaleNonStudyForRecovery(payload = {}) {
  try {
    if (!isNonStudyAiPayload(payload)) return;

    const activityId = getPayloadActivityId(payload);
    const activity = getPayloadActivity(payload);
    const ai = getPayloadAi(payload);

    if (!activityId) return;

    await chrome.storage.local.set({
      sfaiPendingRecovery: {
        activityId,
        oldUrl: activity?.page?.url || getPayloadUrl(payload) || "",
        oldTitle: activity?.page?.title || "",
        oldType: ai?.type || "non-study",
        reason:
          "Old non-study AI response was ignored because user already changed page.",
        at: Date.now(),
      },
    });

    console.info(
      "Study Focus AI: saved pending self recovery for stale non-study response."
    );
  } catch (error) {
    console.warn(
      "rememberStaleNonStudyForRecovery failed:",
      error?.message || error
    );
  }
}

async function savePendingRecoveryIfCurrentDecisionIsStudy(currentPayload = {}) {
  try {
    const currentAi = getPayloadAi(currentPayload);
    const currentType = String(currentAi?.type || "").toLowerCase();

    const isStudyNow =
      currentType === "study" ||
      currentType === "partial" ||
      currentType === "partial-study";

    if (!isStudyNow) return;

    const data = await chrome.storage.local.get(["sfaiPendingRecovery"]);
    const pending = data.sfaiPendingRecovery;

    if (!pending?.activityId) return;

    await sendRuntimeMessage({
      type: "STUDY_FEEDBACK",
      payload: {
        activityId: pending.activityId,
        userAnswer: "recovered",
        correctedType: "study",
        reason:
          "User returned to a study-like page before the old non-study popup/voice was shown.",
      },
    });

    await chrome.storage.local.remove(["sfaiPendingRecovery"]);

    window.SFAI_OVERLAY_CHAT?.addAiMessage?.(
      "Nice recovery. I cancelled the old distraction warning because you returned to study."
    );

    console.info(
      "Study Focus AI: self_recovered saved for old non-study activity."
    );
  } catch (error) {
    console.warn(
      "savePendingRecoveryIfCurrentDecisionIsStudy failed:",
      error?.message || error
    );
  }
}

async function ignoreIfStaleAndRemember(payload = {}) {
  if (!payload) return false;

  if (isStaleAiResponse(payload) || isOldAiResponse(payload)) {
    await rememberStaleNonStudyForRecovery(payload);

    try {
      window.speechSynthesis?.cancel();
    } catch {}

    console.info("Study Focus AI: ignored stale/old AI popup and voice.");
    return true;
  }

  return false;
}

async function saveLatestAiDecision(payload = {}) {
  try {
    const activity = getPayloadActivity(payload);
    const ai = getPayloadAi(payload);

    const type = ai.type || "";
    const activityId = getPayloadActivityId(payload);

    if (!type) return;

    await chrome.storage.local.set({
      sfaiLatestDecision: {
        type,
        activityId,
        url: activity?.page?.url || location.href,
        domain: activity?.page?.domain || location.hostname,
        title: activity?.page?.title || document.title || "",
        at: Date.now(),
      },
    });

    if (type === "study" || type === "partial" || type === "partial-study") {
      await savePendingRecoveryIfCurrentDecisionIsStudy(payload);

      await window.SFAI_REFOCUS_TIMER?.markRecovered?.({
        reason: "User returned to study/partial-study page.",
        silent: true,
      });
    }
  } catch (error) {
    console.warn("saveLatestAiDecision failed:", error?.message || error);
  }
}

let lastMouseCountAt = 0;

window.addEventListener(
  "scroll",
  () => {
    const now = Date.now();
    const y = window.scrollY || 0;
    const docHeight =
      document.documentElement.scrollHeight - window.innerHeight || 1;

    STATE.scrollDepth = Math.max(
      STATE.scrollDepth,
      Math.round((y / docHeight) * 100)
    );

    const deltaY = Math.abs(y - STATE.lastScrollY);
    const deltaT = Math.max(now - STATE.lastScrollAt, 1);

    STATE.scrollSpeed = Math.round(deltaY / deltaT);

    STATE.lastScrollY = y;
    STATE.lastScrollAt = now;

    markActivity();
  },
  { passive: true }
);

document.addEventListener("visibilitychange", () => {
  STATE.tabSwitches += 1;
  markActivity();

  if (document.visibilityState === "hidden") {
    flushSignals();
  }
});

document.addEventListener("keydown", () => {
  STATE.typingCount += 1;
  markActivity();
});

document.addEventListener(
  "mousemove",
  () => {
    const now = Date.now();

    if (now - lastMouseCountAt > 1000) {
      STATE.mouseMoves += 1;
      lastMouseCountAt = now;
      markActivity();
    }
  },
  { passive: true }
);

function patchHistoryMethod(methodName) {
  const original = history[methodName];

  history[methodName] = function patchedHistoryMethod(...args) {
    const result = original.apply(this, args);

    setTimeout(() => {
      if (location.href !== STATE.lastUrl) {
        STATE.lastUrl = location.href;
        STATE.routeChanges += 1;
        STATE.startedAt = Date.now();
        STATE.scrollDepth = 0;
        STATE.lastSignalHash = "";
        markActivity();

        window.SFAI_REFOCUS_TIMER?.cancelIfCurrentPageChanged?.();

        sendSignal({
          forceScreenshot: true,
          forceSend: true,
        }).catch(() => {});
      }
    }, 100);

    return result;
  };
}

try {
  patchHistoryMethod("pushState");
  patchHistoryMethod("replaceState");
} catch {}

window.addEventListener("popstate", () => {
  if (location.href !== STATE.lastUrl) {
    STATE.lastUrl = location.href;
    STATE.routeChanges += 1;
    STATE.startedAt = Date.now();
    STATE.scrollDepth = 0;
    STATE.lastSignalHash = "";
    markActivity();

    window.SFAI_REFOCUS_TIMER?.cancelIfCurrentPageChanged?.();

    sendSignal({
      forceScreenshot: true,
      forceSend: true,
    }).catch(() => {});
  }
});

async function sendRuntimeMessage(message) {
  if (STATE.loopStopped || !hasLiveExtensionContext()) {
    stopBecauseExtensionContextGone();
    return null;
  }

  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) {
      stopBecauseExtensionContextGone();
      return null;
    }

    console.warn("Message error:", error?.message || error);
    return null;
  }
}

async function shouldMonitorBySession() {
  try {
    if (!window.SFAI_SESSION_BRIDGE?.shouldMonitor) {
      return true;
    }

    const active = await window.SFAI_SESSION_BRIDGE.shouldMonitor();

    STATE.monitoringActive = Boolean(active);
    STATE.sessionStatus = active ? "active" : "ended";

    return Boolean(active);
  } catch {
    return true;
  }
}

async function getSettings() {
  const response = await sendRuntimeMessage({ type: "GET_SETTINGS" });
  return response?.data || {};
}

function apiBaseToSocketUrl(apiBaseUrl = "") {
  return String(apiBaseUrl || "").replace(/\/api\/?$/, "");
}




//////fix 1

function shouldAutoListenForPopup(popup = {}) {
  const ai = popup.ai || popup.activity?.ai || {};

  return Boolean(
    popup.openVoiceChat ||
      popup.needsUserCheck ||
      popup.followUpQuestion ||
      ai.followUpQuestion ||
      ai.needsUserCheck ||
      popup.type === "ask" ||
      popup.type === "ask_user" ||
      popup.type === "intervention" ||
      popup.type === "strict-intervention"
  );
}

function disablePopupButtons(root, disabled = true) {
  if (!root) return;

  const buttons = root.querySelectorAll("button");

  buttons.forEach((btn) => {
    btn.disabled = disabled;
    btn.style.opacity = disabled ? "0.65" : "1";
    btn.style.cursor = disabled ? "not-allowed" : "pointer";
  });
}

function stopVoiceInput() {
  try {
    if (STATE.recognition && STATE.recognizing) {
      STATE.recognition.stop();
    }
  } catch {}

  STATE.recognizing = false;
}

function shouldSkipDuplicateAiChat(text = "") {
  const clean = cleanText(text);
  if (!clean) return true;

  const now = Date.now();

  if (
    STATE.lastAiChatText === clean &&
    now - safeNumber(STATE.lastAiChatAt, 0) < 2500
  ) {
    return true;
  }

  STATE.lastAiChatText = clean;
  STATE.lastAiChatAt = now;

  return false;
}











function speakDynamicAiText(text, options = {}) {
  if (!text || !window.speechSynthesis) return;

  const cleanVoiceText = cleanText(text);
  if (!cleanVoiceText) return;

  try {
    if (options.cancelExisting !== false) {
      window.speechSynthesis.cancel();
    }

    stopVoiceInput();

    const utterance = new SpeechSynthesisUtterance(cleanVoiceText);
    utterance.rate = options.rate || 1;
    utterance.pitch = options.pitch || 1;
    utterance.volume = options.volume || 1;

    utterance.onstart = () => {
      setVoiceStatus("AI speaking...");
      window.SFAI_OVERLAY_CHAT?.setStatus?.("speaking");
    };

    utterance.onend = () => {
      setVoiceStatus("Voice ready");
      window.SFAI_OVERLAY_CHAT?.setStatus?.("voice ready");

      if (options.restartListening && STATE.activeActivityId) {
        setTimeout(() => {
          startVoiceInput();
        }, options.listenDelayMs || 600);
      }
    };

    utterance.onerror = () => {
      setVoiceStatus("Voice output failed. You can type or click a button.");
      window.SFAI_OVERLAY_CHAT?.setStatus?.("voice error");

      if (options.restartListening && STATE.activeActivityId) {
        setTimeout(() => {
          startVoiceInput();
        }, 800);
      }
    };

    window.speechSynthesis.speak(utterance);
  } catch (error) {
    console.warn("Voice output failed:", error.message);
    setVoiceStatus("Voice output failed. You can type or click a button.");
  }
}










function setupSpeechRecognition() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) return null;

  const recognition = new SpeechRecognition();

  recognition.lang = "en-US";
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    STATE.recognizing = true;
    setVoiceStatus("Listening...");
    window.SFAI_OVERLAY_CHAT?.setStatus?.("listening");
  };

  recognition.onerror = (event) => {
    STATE.recognizing = false;

    const reason = event?.error || "unknown";

    let message = "Voice input failed. Please click a button or try again.";

    if (reason === "not-allowed") {
      message =
        "Microphone permission blocked. Allow microphone permission in Chrome.";
    }

    if (reason === "no-speech") {
      message = "I could not hear you. Try again or click a button.";
    }

    if (reason === "audio-capture") {
      message = "No microphone found. Check your microphone settings.";
    }

    if (reason === "aborted") {
      message = "Voice listening stopped.";
    }

    setVoiceStatus(message);
    window.SFAI_OVERLAY_CHAT?.setStatus?.("voice error");

    if (reason !== "aborted") {
      addChatMessage("ai", message);
      window.SFAI_OVERLAY_CHAT?.addAiMessage?.(message);
    }
  };

  recognition.onend = () => {
    STATE.recognizing = false;

    const status =
      document.getElementById("sfai-voice-status")?.textContent || "";

    if (!status.toLowerCase().includes("failed")) {
      setVoiceStatus("Voice ready");
      window.SFAI_OVERLAY_CHAT?.setStatus?.("voice ready");
    }
  };

  recognition.onresult = async (event) => {
    let finalTranscript = "";
    let interimTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = event.results[i][0].transcript;

      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    if (interimTranscript) {
      setUserDraft(interimTranscript);
    }

    if (finalTranscript) {
      const cleanFinal = cleanText(finalTranscript);

      if (!cleanFinal) return;

      setUserDraft("");
      addChatMessage("user", cleanFinal);
      window.SFAI_OVERLAY_CHAT?.addUserMessage?.(cleanFinal);

      await handleVoiceAnswer(cleanFinal);
    }
  };

  return recognition;
}












function ensureRecognition() {
  if (!STATE.recognition) {
    STATE.recognition = setupSpeechRecognition();
  }

  return STATE.recognition;
}



function startVoiceInput() {
  const recognition = ensureRecognition();

  if (!recognition) {
    const msg = "Voice input is not supported in this browser.";
    setVoiceStatus(msg);
    addChatMessage("ai", msg);
    window.SFAI_OVERLAY_CHAT?.setStatus?.("voice not supported");
    window.SFAI_OVERLAY_CHAT?.addAiMessage?.(msg);
    return;
  }

  // No click is required. If there is no active popup/activity yet, the
  // backend will attach this voice turn to the latest activity for this device
  // or create a voice_conversation activity.

  if (STATE.recognizing) return;

  try {
    setVoiceStatus("Starting microphone...");
    window.SFAI_OVERLAY_CHAT?.setStatus?.("starting mic");
    recognition.start();
  } catch (error) {
    const msg = error?.message || "Voice input failed.";
    setVoiceStatus(msg);
    window.SFAI_OVERLAY_CHAT?.setStatus?.("voice error");
  }
}





////fix
async function handleVoiceAnswer(transcript, inputMode = "voice") {
  // activityId is optional: backend will use latest device activity if needed.

  const cleanTranscript = cleanText(transcript);

  if (!cleanTranscript) {
    setVoiceStatus("I could not hear a clear answer.");
    return;
  }

  setVoiceStatus("AI is thinking...");
  window.SFAI_OVERLAY_CHAT?.setStatus?.("thinking");

  const response = await sendRuntimeMessage({
    type: "STUDY_VOICE_REPLY",
    payload: {
      activityId: STATE.activeActivityId || "",
      page: collectPage(),
      behavior: collectBehavior(),
      message: cleanTranscript,
      voiceAnswer: cleanTranscript,
      userAnswer: cleanTranscript,
      inputMode,
      needsScreenshot: true,
      source: "extension",
    },
  });

  const payload = response?.data?.data || response?.data || {};
  const ai = payload.ai || payload.data?.ai || {};

  if (shouldIgnoreAiResponse(payload)) {
    window.SFAI_OVERLAY_CHAT?.setStatus?.("ignored stale reply");
    return;
  }

  await saveLatestAiDecision(payload);

  const reply =
    ai.reply ||
    ai.voiceText ||
    payload.reply ||
    "I understood your answer and updated your study memory.";

  const followUp =
    ai.followUpQuestion && ai.followUpQuestion !== reply
      ? ai.followUpQuestion
      : "";

  if (reply) {
    addChatMessage("ai", reply);
    window.SFAI_OVERLAY_CHAT?.addAiMessage?.(reply);
  }

  if (followUp) {
    addChatMessage("ai", followUp);
    window.SFAI_OVERLAY_CHAT?.addAiMessage?.(followUp);
  }

  if (payload.activity?.explainability || ai.explainability) {
    renderExplainability(payload.activity?.explainability || ai.explainability);
  }

  const shouldContinue =
    Boolean(ai.shouldContinueConversation || followUp) &&
    !ai.finalDecisionMade;

  const spokenText = [reply, followUp].filter(Boolean).join(" ");

  if (spokenText) {
    speakDynamicAiText(spokenText, {
      restartListening: shouldContinue,
    });
  }

  if (ai.finalDecisionMade) {
    const doneText =
      ai.stopReason ||
      "Final decision saved. I will adapt future focus guidance from this.";

    addChatMessage("ai", doneText);
    window.SFAI_OVERLAY_CHAT?.addAiMessage?.(doneText);
    window.SFAI_OVERLAY_CHAT?.setStatus?.("completed");
    setVoiceStatus("Conversation completed");

    return;
  }

  if (shouldContinue) {
    setVoiceStatus("AI is waiting for your answer...");
    window.SFAI_OVERLAY_CHAT?.setStatus?.("waiting");
  }
}













async function sendFeedback(payload) {
  return sendRuntimeMessage({
    type: "STUDY_FEEDBACK",
    payload,
  });
}

async function markPopupIgnored(reason = "User closed popup.") {
  if (!STATE.activeActivityId || STATE.popupCloseTracked) return;

  STATE.popupCloseTracked = true;

  try {
    await sendRuntimeMessage({
      type: "STUDY_POPUP_IGNORED",
      payload: {
        activityId: STATE.activeActivityId,
        reason,
      },
    });
  } catch (error) {
    console.warn("Popup ignored tracking failed:", error.message);
  }
}

async function flushSignals() {
  try {
    await sendRuntimeMessage({ type: "STUDY_FLUSH" });
  } catch {}
}

async function sendSignal(options = {}) {
  if (STATE.loopStopped) return;

  const canMonitor = await shouldMonitorBySession();

  if (!canMonitor && !options.forceSend) {
    return;
  }

  const settings = await getSettings();

  STATE.signalIntervalMs = safeNumber(settings.signalIntervalMs, 6000);
  STATE.screenshotIntervalMs = safeNumber(settings.screenshotIntervalMs, 45000);

  const page = collectPage();
  const behavior = collectBehavior();

  if (shouldSkipSignal(page, behavior) && !options.forceSend) {
    return;
  }

  const now = Date.now();
  const needsScreenshot =
    Boolean(options.forceScreenshot) ||
    now - STATE.lastScreenshotRequestAt >= STATE.screenshotIntervalMs ||
    page.isPdf ||
    page.isBlank ||
    page.isSpa;

  if (needsScreenshot) {
    STATE.lastScreenshotRequestAt = now;
  }

  const signalHash = buildSignalHash(page, behavior, needsScreenshot);

  if (
    signalHash === STATE.lastSignalHash &&
    !options.forceSend &&
    !options.forceScreenshot
  ) {
    return;
  }

  STATE.lastSignalHash = signalHash;

  const response = await sendRuntimeMessage({
    type: "STUDY_SIGNAL",
    payload: {
      page,
      behavior,
      needsScreenshot,
      forceScreenshot: Boolean(options.forceScreenshot),
      forceSend: Boolean(options.forceSend),
      signalHash,
      batchId: `batch-${Date.now()}`,
      client: {
        isTopFrame: isTopFrame(),
        isSpa: page.isSpa,
      },
    },
  });

  if (!response) return;

  const data = response?.data?.data || response?.data;

  if (shouldIgnoreAiResponse(data)) {
    return;
  }

  await saveLatestAiDecision(data);

  if (data?.popup) {
    renderRealtimePopup(data.popup, data.dashboard);
  }

  if (data?.activity?._id || data?.activity?.id) {
    const activityId = data.activity._id || data.activity.id;
    STATE.activeActivityId = activityId;
    window.SFAI_OVERLAY_CHAT?.setActiveActivityId?.(activityId);
  }
}

function removePopup() {
  const old = document.getElementById("study-focus-ai-root");
  if (old) old.remove();

  STATE.activePopup = null;
}

function normalizeExplainability(explainability = {}) {
  const bullets = Array.isArray(explainability.bullets)
    ? explainability.bullets
    : [];

  const evidence = Array.isArray(explainability.evidence)
    ? explainability.evidence
    : [];

  const userVisibleReason =
    explainability.userVisibleReason || explainability.reason || "";

  return {
    bullets: bullets.slice(0, 6),
    evidence: evidence.slice(0, 6),
    userVisibleReason,
  };
}

function renderExplainability(explainability = {}) {
  const root = document.getElementById("sfai-explainability");
  if (!root) return;

  const data = normalizeExplainability(explainability);

  const items = [
    ...data.bullets,
    ...data.evidence.map((x) => `Evidence: ${x}`),
  ].slice(0, 7);

  if (!items.length && !data.userVisibleReason) {
    root.innerHTML = "";
    return;
  }

  root.innerHTML = `
    <div class="sfai-explain-title">Why AI decided this</div>
    ${
      data.userVisibleReason
        ? `<div class="sfai-explain-main">${escapeHtml(data.userVisibleReason)}</div>`
        : ""
    }
    <ul>
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
  `;
}


function looksLikeRawJsonText(value = "") {
  const text = String(value || "").trim();
  return (
    text.startsWith("{") ||
    text.startsWith("[") ||
    text.includes('"type"') ||
    text.includes('"confidence"') ||
    text.includes('"voiceText"') ||
    text.includes('"decision"')
  );
}

function cleanPopupText(value = "", fallback = "") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  if (looksLikeRawJsonText(text)) return fallback;
  return text;
}

function popupConfidence(value, fallback = 0.5) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n > 1 ? Math.max(0, Math.min(1, n / 100)) : Math.max(0, Math.min(1, n));
}

function calculateLivePopupFocus({ popup = {}, dashboard = {} }) {
  /**
   * Dynamic focus only.
   * No fixed domain/keyword detection here.
   * This mirrors backend scoring from real AI confidence + relevance + behavior + memory.
   */
  const activity = popup.activity || dashboard.latestActivity || {};
  const ai = popup.ai || activity.ai || {};
  const signals = activity.signals || popup.signals || {};

  const rawType = String(
    ai.type ||
      activity?.decision?.finalType ||
      activity?.decision?.type ||
      popup.aiType ||
      popup.type ||
      "partial"
  ).toLowerCase();

  const type =
    rawType === "study"
      ? "study"
      : rawType === "non-study" || rawType === "non_study" || rawType === "strict-intervention" || rawType === "intervention"
        ? "non-study"
        : "partial";

  const confidence = popupConfidence(
    ai.confidence ??
      activity?.decision?.finalConfidence ??
      signals.finalConfidence ??
      dashboard?.latestActivity?.ai?.confidence,
    0.5
  );

  const relevanceScore = Math.max(0, Math.min(100, Number(signals.relevanceScore ?? popup.relevanceScore ?? 50)));
  const behaviorScore = Math.max(0, Math.min(100, Number(signals.behaviorScore ?? popup.behaviorScore ?? 50)));
  const patternScore = Math.max(0, Math.min(100, Number(signals.patternScore ?? signals.memoryScore ?? popup.patternScore ?? 50)));

  if (type === "study") {
    return Math.max(
      70,
      Math.min(
        100,
        Math.round(confidence * 55 + relevanceScore * 0.25 + behaviorScore * 0.15 + patternScore * 0.05)
      )
    );
  }

  if (type === "non-study") {
    return Math.max(
      0,
      Math.min(
        100,
        Math.round((1 - confidence) * 35 + relevanceScore * 0.25 + behaviorScore * 0.1 + patternScore * 0.05)
      )
    );
  }

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(confidence * 35 + relevanceScore * 0.35 + behaviorScore * 0.2 + patternScore * 0.1)
    )
  );
}

function renderRealtimePopup(popup, dashboard = null) {
  if (!popup || !popup.activityId) return;

  const pseudoPayload = {
    popup,
    activity: {
      _id: popup.activityId,
      page: popup.page || popup.activity?.page || {},
      ai: popup.ai || popup.activity?.ai || {},
      createdAt: popup.createdAt || popup.activity?.createdAt || "",
    },
  };

  if (shouldIgnoreAiResponse(pseudoPayload)) {
    return;
  }

  STATE.activePopup = popup;
  STATE.activeActivityId = popup.activityId;
  STATE.popupShownAt = Date.now();
  STATE.popupCloseTracked = false;

  window.SFAI_OVERLAY_CHAT?.setActiveActivityId?.(popup.activityId);

  removePopup();

  const root = document.createElement("div");
  root.id = "study-focus-ai-root";

  popup.message = cleanPopupText(
    popup.message,
    "I am checking whether this page helps your study goal."
  );
  popup.voiceText = cleanPopupText(
    popup.voiceText,
    popup.message || "Is this page helping your study goal?"
  );
  popup.reason = cleanPopupText(
    popup.reason,
    "AI is checking this page against your study goal."
  );

  const focusScore = calculateLivePopupFocus({ popup, dashboard });
  const studyCount =
    dashboard?.studyCount ??
    dashboard?.stats?.study ??
    dashboard?.premiumCards?.studyCount ??
    0;
  const distractionCount =
    dashboard?.distractionCount ??
    dashboard?.stats?.distracted ??
    dashboard?.stats?.nonStudy ??
    dashboard?.premiumCards?.distractionCount ??
    0;

  const adaptiveLevel = popup.adaptiveLevel ?? popup.decision?.adaptiveLevel ?? 0;
  const isStrict = popup.type === "strict-intervention" || adaptiveLevel >= 2;

  root.innerHTML = `
    <style>
      #study-focus-ai-root {
        position: fixed;
        right: 22px;
        bottom: 22px;
        width: 390px;
        max-width: calc(100vw - 32px);
        z-index: 2147483647;
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #study-focus-ai-root .sfai-card {
        border-radius: 26px;
        overflow: hidden;
        background:
          radial-gradient(circle at top left, rgba(255, 139, 216, .28), transparent 35%),
          radial-gradient(circle at bottom right, rgba(125, 159, 255, .24), transparent 35%),
          rgba(18, 18, 32, .94);
        color: white;
        border: 1px solid rgba(255,255,255,.15);
        box-shadow: 0 28px 90px rgba(0,0,0,.42);
        backdrop-filter: blur(20px);
      }

      #study-focus-ai-root .sfai-card.strict {
        border-color: rgba(255, 140, 170, .65);
        box-shadow: 0 32px 100px rgba(255, 70, 120, .30);
      }

      #study-focus-ai-root .sfai-header {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        padding: 18px 18px 10px;
      }

      #study-focus-ai-root .sfai-badge {
        display: inline-flex;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 900;
        color: #ffd7fb;
        background: rgba(255,255,255,.11);
        margin-bottom: 9px;
      }

      #study-focus-ai-root .sfai-title {
        font-size: 20px;
        font-weight: 900;
        line-height: 1.15;
      }

      #study-focus-ai-root .sfai-close {
        width: 32px;
        height: 32px;
        border: 0;
        border-radius: 999px;
        background: rgba(255,255,255,.12);
        color: white;
        cursor: pointer;
        font-size: 22px;
        line-height: 1;
      }

      #study-focus-ai-root .sfai-message {
        padding: 0 18px 14px;
        font-size: 14px;
        line-height: 1.5;
        color: rgba(255,255,255,.86);
      }

      #study-focus-ai-root .sfai-metrics {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        padding: 0 18px 14px;
      }

      #study-focus-ai-root .sfai-metric {
        border-radius: 16px;
        padding: 10px;
        background: rgba(255,255,255,.08);
      }

      #study-focus-ai-root .sfai-metric span {
        display: block;
        font-size: 10px;
        color: rgba(255,255,255,.62);
        margin-bottom: 2px;
      }

      #study-focus-ai-root .sfai-metric strong {
        font-size: 15px;
        font-weight: 900;
      }

      #study-focus-ai-root .sfai-explain {
        margin: 0 18px 14px;
        border-radius: 18px;
        background: rgba(255,255,255,.08);
        padding: 12px;
      }

      #study-focus-ai-root .sfai-explain-title {
        font-size: 12px;
        font-weight: 900;
        color: #ffe3fb;
        margin-bottom: 6px;
      }

      #study-focus-ai-root .sfai-explain-main {
        font-size: 12px;
        line-height: 1.4;
        color: rgba(255,255,255,.82);
        margin-bottom: 6px;
      }

      #study-focus-ai-root .sfai-explain ul {
        margin: 0;
        padding-left: 16px;
      }

      #study-focus-ai-root .sfai-explain li {
        font-size: 11px;
        line-height: 1.45;
        color: rgba(255,255,255,.70);
        margin: 3px 0;
      }

      #study-focus-ai-root .sfai-chat {
        margin: 0 18px 14px;
        max-height: 170px;
        overflow-y: auto;
        display: grid;
        gap: 8px;
      }

      #study-focus-ai-root .sfai-msg {
        padding: 10px 12px;
        border-radius: 15px;
        font-size: 13px;
        line-height: 1.4;
      }

      #study-focus-ai-root .sfai-msg.ai {
        background: rgba(255,255,255,.10);
        color: rgba(255,255,255,.9);
      }

      #study-focus-ai-root .sfai-msg.user {
        background: rgba(180, 255, 208, .16);
        color: #d9ffe8;
      }

      #study-focus-ai-root .sfai-draft {
        margin: -6px 18px 12px;
        min-height: 18px;
        font-size: 12px;
        color: rgba(255,255,255,.58);
      }

      #study-focus-ai-root .sfai-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 9px;
        padding: 0 18px 18px;
      }

      #study-focus-ai-root .sfai-actions.voice-row {
        grid-template-columns: 1fr;
        padding-top: 0;
      }

      #study-focus-ai-root .sfai-btn {
        border: 0;
        border-radius: 16px;
        padding: 11px 12px;
        font-size: 13px;
        font-weight: 900;
        cursor: pointer;
      }

      #study-focus-ai-root .sfai-yes {
        background: #baffd4;
        color: #07381a;
      }

      #study-focus-ai-root .sfai-no {
        background: #ffd2de;
        color: #4b071a;
      }

      #study-focus-ai-root .sfai-voice {
        background: linear-gradient(135deg, #ff98dc, #9db3ff);
        color: #111122;
      }



      #study-focus-ai-root .sfai-input-row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
        padding: 0 18px 12px;
      }

      #study-focus-ai-root .sfai-input {
        min-width: 0;
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 14px;
        padding: 11px 12px;
        background: rgba(255,255,255,.09);
        color: white;
        outline: none;
        font-size: 13px;
        font-weight: 700;
      }

      #study-focus-ai-root .sfai-input::placeholder {
        color: rgba(255,255,255,.45);
      }

      #study-focus-ai-root .sfai-send {
        border: 0;
        border-radius: 14px;
        padding: 0 14px;
        background: #baffd4;
        color: #07381a;
        cursor: pointer;
        font-size: 13px;
        font-weight: 900;
      }

      #study-focus-ai-root .sfai-status {
        padding: 0 18px 16px;
        font-size: 12px;
        color: rgba(255,255,255,.55);
      }
    </style>

    <div class="sfai-card ${isStrict ? "strict" : ""}">
      <div class="sfai-header">
        <div>
          <div class="sfai-badge">
            ${
              isStrict
                ? "Strict focus mode"
                : popup.type === "ask" || popup.type === "ask_user"
                ? "AI is unsure"
                : "AI focus guidance"
            }
          </div>
          <div class="sfai-title">
            ${escapeHtml(popup.title || "Study Focus AI")}
          </div>
        </div>
        <button class="sfai-close" data-action="close">×</button>
      </div>

      <div class="sfai-message">
        ${escapeHtml(cleanPopupText(popup.message, "I am checking whether this page helps your study goal."))}
      </div>

      ${
        focusScore !== null
          ? `
        <div class="sfai-metrics">
          <div class="sfai-metric">
            <span>Focus</span>
            <strong>${focusScore}%</strong>
          </div>
          <div class="sfai-metric">
            <span>Study</span>
            <strong>${studyCount ?? 0}</strong>
          </div>
          <div class="sfai-metric">
            <span>Distract</span>
            <strong>${distractionCount ?? 0}</strong>
          </div>
        </div>
      `
          : ""
      }

      <div class="sfai-explain" id="sfai-explainability"></div>

      <div class="sfai-chat" id="sfai-chat">
        <div class="sfai-msg ai">
          ${escapeHtml(
            cleanPopupText(
              popup.voiceText || popup.message,
              "Tell me if this is study or distraction."
            )
          )}
        </div>
      </div>

      <div class="sfai-draft" id="sfai-draft"></div>

      <div class="sfai-input-row">
        <input class="sfai-input" id="sfai-manual-input" placeholder="Type or talk with AI coach..." />
        <button class="sfai-send" data-action="send-chat">Send</button>
      </div>

      <div class="sfai-actions">
        <button class="sfai-btn sfai-yes" data-action="yes">Yes, studying</button>
        <button class="sfai-btn sfai-no" data-action="no">No, distracted</button>
      </div>

      <div class="sfai-actions voice-row">
        <button class="sfai-btn sfai-voice" data-action="voice">🎤 Answer by voice</button>
      </div>

      <div class="sfai-status" id="sfai-voice-status">Voice ready</div>
    </div>
  `;

  document.documentElement.appendChild(root);

  renderExplainability(popup.explainability || popup.activity?.explainability || {});

  root.addEventListener("click", async (event) => {
    const action = event.target?.dataset?.action;
    if (!action) return;

    if (event.target?.disabled) return;

    if (["yes", "no"].includes(action)) {
      disablePopupButtons(root, true);
    }
    if (action === "close") {
      await markPopupIgnored("User closed popup.");
      removePopup();
      return;
    }

    if (action === "yes") {
      const userText = "Yes, I am studying here.";
      addChatMessage("user", userText);
      window.SFAI_OVERLAY_CHAT?.addUserMessage?.(userText);

      await sendFeedback({
        activityId: popup.activityId,
        userAnswer: "yes",
        correctedType: "study",
        reason: "User clicked yes, this context is study related.",
      });

      await chrome.storage.local.set({
        sfaiLatestDecision: {
          type: "study",
          activityId: popup.activityId,
          url: location.href,
          domain: location.hostname,
          title: document.title || "",
          at: Date.now(),
        },
      });

      await window.SFAI_REFOCUS_TIMER?.markRecovered?.({
        reason: "User confirmed current page is study-related.",
        silent: false,
      });

      const reply = "Saved. I will remember this as useful for your study goal.";
      addChatMessage("ai", reply);
      window.SFAI_OVERLAY_CHAT?.addAiMessage?.(reply);
      speakDynamicAiText(reply);
setTimeout(() => {
  removePopup();
}, 1200);
      return;
    }

    if (action === "no") {
      const userText = "No, I am distracted.";
      addChatMessage("user", userText);
      window.SFAI_OVERLAY_CHAT?.addUserMessage?.(userText);

      await sendFeedback({
        activityId: popup.activityId,
        userAnswer: "no",
        correctedType: "non-study",
        reason: "User clicked no, this context is distraction.",
      });

      await chrome.storage.local.set({
        sfaiLatestDecision: {
          type: "non-study",
          activityId: popup.activityId,
          url: location.href,
          domain: location.hostname,
          title: document.title || "",
          at: Date.now(),
        },
      });

      const reply =
        "Saved. I’ll help you catch this distraction faster next time.";
      addChatMessage("ai", reply);
      window.SFAI_OVERLAY_CHAT?.addAiMessage?.(reply);
      speakDynamicAiText(reply);
setTimeout(() => {
  removePopup();
}, 1200);
      return;
    }

    if (action === "send-chat") {
      const input = document.getElementById("sfai-manual-input");
      const text = cleanText(input?.value || "");

      if (!text) return;

      if (input) input.value = "";
      addChatMessage("user", text);
      window.SFAI_OVERLAY_CHAT?.addUserMessage?.(text);
      await handleVoiceAnswer(text, "manual_chat");
      return;
    }

    if (action === "voice") {
      startVoiceInput();
    }
  });

  const manualInput = document.getElementById("sfai-manual-input");
  manualInput?.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;

    const text = cleanText(event.currentTarget?.value || "");
    if (!text) return;

    event.currentTarget.value = "";
    addChatMessage("user", text);
    window.SFAI_OVERLAY_CHAT?.addUserMessage?.(text);
    await handleVoiceAnswer(text, "manual_chat");
  });

 const firstAiText = cleanPopupText(
  popup.voiceText || popup.followUpQuestion || popup.message,
  "Tell me if this page is helping your study goal."
);

speakDynamicAiText(firstAiText, {
  restartListening: shouldAutoListenForPopup(popup),
});
}





function addChatMessage(role, text) {
  const chat = document.getElementById("sfai-chat");
  if (!chat) return;

  if (role === "ai" && shouldSkipDuplicateAiChat(text)) {
    return;
  }






  const div = document.createElement("div");
  div.className = `sfai-msg ${role === "user" ? "user" : "ai"}`;
  div.textContent = text;

  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}






function setUserDraft(text) {
  const draft = document.getElementById("sfai-draft");
  if (draft) draft.textContent = text ? `You are saying: ${text}` : "";
}

function setVoiceStatus(text) {
  const status = document.getElementById("sfai-voice-status");
  if (status) status.textContent = text;
}

async function emitExtensionClientState(settings = {}) {
  try {
    await sendRuntimeMessage({
      type: "EXTENSION_CLIENT_STATE",
      socketStatus: STATE.socketConnected ? "connected" : "disconnected",
      sessionStatus: STATE.sessionStatus || "unknown",
      monitoringActive: Boolean(STATE.monitoringActive),
    });
  } catch {}

  try {
    window.SFAI_SESSION_BRIDGE?.emitClientState?.({
      voiceStatus: STATE.recognizing ? "listening" : "idle",
      sessionStatus: STATE.sessionStatus || "unknown",
    });
  } catch {}
}

function joinStudySocket(settings) {
  if (!STATE.socket || !settings?.deviceId) return;

  const joinPayload = {
    deviceId: settings.deviceId,
    userId: settings.userId || "",
    deviceType: "extension",
    label: "Chrome extension",
    currentScreen: "browser-page",
    voiceStatus: STATE.recognizing ? "listening" : "idle",
    sessionStatus: STATE.monitoringActive ? "active" : "ended",
  };

  STATE.socket.emit("study:join", joinPayload);
}

async function connectSocket() {
  if (STATE.loopStopped || !hasLiveExtensionContext()) {
    stopBecauseExtensionContextGone();
    return;
  }

  const settings = await getSettings();

  if (STATE.loopStopped || !settings.deviceId || !settings.apiBaseUrl) return;

  STATE.monitoringActive = Boolean(settings.monitoringActive);
  STATE.sessionStatus = settings.sessionStatus || "unknown";

  const socketUrl = apiBaseToSocketUrl(settings.apiBaseUrl);

  if (STATE.socket && STATE.joinedDeviceId === settings.deviceId) {
    return;
  }

  if (STATE.socket) {
    try {
      STATE.socket.removeAllListeners?.();
      STATE.socket.off?.();
      STATE.socket.disconnect?.();
    } catch {}
  }

  if (!window.io) {
    console.warn("Socket.io client not loaded. Check vendor/socket.io.min.js");
    return;
  }

  STATE.socket = window.io(socketUrl, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
  });

  STATE.socket.on("connect", async () => {
    if (STATE.loopStopped) return;

    STATE.socketConnected = true;
    STATE.joinedDeviceId = settings.deviceId;

    joinStudySocket(settings);
    await window.SFAI_SESSION_BRIDGE?.connect?.();
    await emitExtensionClientState(settings);
  });

  STATE.socket.on("disconnect", async () => {
    STATE.socketConnected = false;
    await emitExtensionClientState(settings);
  });

  STATE.socket.on("study:session-started", async (payload = {}) => {
    if (STATE.loopStopped) return;

    STATE.monitoringActive = true;
    STATE.sessionStatus = "active";

    await window.SFAI_SESSION_BRIDGE?.setMonitoringActive?.(true, payload.session);

    window.SFAI_OVERLAY_CHAT?.setStatus?.("session active");
    window.SFAI_OVERLAY_CHAT?.addAiMessage?.(
      "Study session started. I’ll monitor quietly."
    );

    await emitExtensionClientState(settings);
  });

  STATE.socket.on("study:session-ended", async (payload = {}) => {
    if (STATE.loopStopped) return;

    STATE.monitoringActive = false;
    STATE.sessionStatus = "ended";

    await window.SFAI_SESSION_BRIDGE?.setMonitoringActive?.(false, payload.session);

    window.SFAI_OVERLAY_CHAT?.setStatus?.("session paused");
    window.SFAI_OVERLAY_CHAT?.addAiMessage?.(
      "Study session ended. Monitoring is paused."
    );

    await emitExtensionClientState(settings);
  });

  STATE.socket.on("study:session_updated", async (payload = {}) => {
    if (STATE.loopStopped) return;

    STATE.monitoringActive = Boolean(payload.monitoringActive);
    STATE.sessionStatus = STATE.monitoringActive ? "active" : "ended";

    await window.SFAI_SESSION_BRIDGE?.setMonitoringActive?.(
      STATE.monitoringActive,
      payload.session
    );

    await emitExtensionClientState(settings);
  });

  STATE.socket.on("study:session_required", async () => {
    if (STATE.loopStopped) return;

    STATE.monitoringActive = false;
    STATE.sessionStatus = "ended";

    await window.SFAI_SESSION_BRIDGE?.setMonitoringActive?.(false, null);

    window.SFAI_OVERLAY_CHAT?.setStatus?.("session required");
    await emitExtensionClientState(settings);
  });

  STATE.socket.on("study:update", async (payload) => {
    if (STATE.loopStopped) return;

    if (shouldIgnoreAiResponse(payload)) {
      return;
    }

    const activityId = getPayloadActivityId(payload);

    if (activityId) {
      STATE.activeActivityId = activityId;
      window.SFAI_OVERLAY_CHAT?.setActiveActivityId?.(activityId);
    }

    await saveLatestAiDecision(payload);
    await window.SFAI_REFOCUS_TIMER?.observeDecision?.(payload);

    if (payload?.popup) {
      renderRealtimePopup(payload.popup, payload.dashboard);
    }
  });

  STATE.socket.on("dashboard:update", async (payload = {}) => {
    if (STATE.loopStopped) return;

    if (shouldIgnoreAiResponse(payload)) {
      return;
    }

    const activityId = getPayloadActivityId(payload);

    if (activityId) {
      STATE.activeActivityId = activityId;
      window.SFAI_OVERLAY_CHAT?.setActiveActivityId?.(activityId);
    }

    await saveLatestAiDecision(payload);
  });

  STATE.socket.on("study:feedback-updated", (payload) => {
    if (STATE.loopStopped) return;

    if (payload?.dashboard) {
      const msg =
        "Your feedback was saved and your learning memory was updated.";

      addChatMessage("ai", msg);
      window.SFAI_OVERLAY_CHAT?.addAiMessage?.(msg);
    }
  });

  STATE.socket.on("study:feedback", (payload) => {
    if (STATE.loopStopped) return;

    if (payload?.dashboard) {
      addChatMessage("ai", "Feedback saved.");
      window.SFAI_OVERLAY_CHAT?.addAiMessage?.("Feedback saved.");
    }
  });

  STATE.socket.on("study:goal-updated", (payload) => {
    if (STATE.loopStopped) return;

    const msg = `Goal updated: ${payload?.goal || "new study goal"}`;
    addChatMessage("ai", msg);
    window.SFAI_OVERLAY_CHAT?.addAiMessage?.(msg);
  });

  STATE.socket.on("study:goal", (payload) => {
    if (STATE.loopStopped) return;

    const msg = `Goal updated: ${payload?.goal || "new study goal"}`;
    addChatMessage("ai", msg);
    window.SFAI_OVERLAY_CHAT?.addAiMessage?.(msg);
  });

  STATE.socket.on("study:voice-status", (payload = {}) => {
    if (STATE.loopStopped) return;

    if (shouldIgnoreAiResponse(payload)) {
      return;
    }

    const status = payload.voiceStatus || payload.status || "voice";
    window.SFAI_OVERLAY_CHAT?.setStatus?.(status);

    if (payload.status === "ai_thinking") {
      window.SFAI_OVERLAY_CHAT?.addAiMessage?.("Thinking...");
    }

    if (payload.reply) {
      addChatMessage("ai", payload.reply);
      window.SFAI_OVERLAY_CHAT?.addAiMessage?.(payload.reply);
    }
  });

  STATE.socket.on("study:voice-updated", async (payload = {}) => {
    if (STATE.loopStopped) return;

    if (shouldIgnoreAiResponse(payload)) {
      return;
    }

    await saveLatestAiDecision(payload);

    const ai = payload?.ai || {};
    const reply = ai.reply || ai.voiceText || payload.reply || "";
    const activityId = getPayloadActivityId(payload);

    if (activityId) {
      STATE.activeActivityId = activityId;
      window.SFAI_OVERLAY_CHAT?.setActiveActivityId?.(activityId);
    }

    if (reply) {
      addChatMessage("ai", reply);
      window.SFAI_OVERLAY_CHAT?.addAiMessage?.(reply);

      speakDynamicAiText(reply, {
        restartListening:
          Boolean(ai.shouldContinueConversation || ai.followUpQuestion) &&
          !ai.finalDecisionMade,
      });
    }

    window.SFAI_OVERLAY_CHAT?.setStatus?.(
      ai.finalDecisionMade ? "completed" : "speaking"
    );
  });
}

async function signalLoop() {
  while (!STATE.loopStopped) {
    try {
      if (!hasLiveExtensionContext()) {
        stopBecauseExtensionContextGone();
        break;
      }

      await window.SFAI_SESSION_BRIDGE?.connect?.();

      const canMonitor = await shouldMonitorBySession();

      if (!canMonitor) {
        await sleep(STATE.signalIntervalMs || 6000);
        continue;
      }

      if (!STATE.loopStopped && document.visibilityState !== "hidden") {
        await sendSignal();
      }
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) {
        stopBecauseExtensionContextGone();
        break;
      }

      console.warn("Study loop failed:", error?.message || error);
    }

    await sleep(STATE.signalIntervalMs || 6000);
  }
}

function cleanup() {
  STATE.loopStopped = true;

  if (hasLiveExtensionContext()) {
    try {
      flushSignals();
    } catch {}
  }

  try {
    if (STATE.socket) {
      STATE.socket.removeAllListeners?.();
      STATE.socket.off?.();
      STATE.socket.disconnect?.();
      STATE.socket = null;
    }
  } catch {}

  try {
    if (STATE.recognition && STATE.recognizing) {
      STATE.recognition.stop();
    }
  } catch {}

  try {
    window.speechSynthesis?.cancel();
  } catch {}

  try {
    if (STATE.cleanupTimer) {
      clearInterval(STATE.cleanupTimer);
      STATE.cleanupTimer = null;
    }
  } catch {}

  removePopup();
  window.__STUDY_AI_RUNNING__ = false;
}

window.addEventListener("beforeunload", cleanup);

STATE.cleanupTimer = setInterval(() => {
  if (STATE.mouseMoves > 100000) STATE.mouseMoves = 1000;
  if (STATE.typingCount > 100000) STATE.typingCount = 1000;
  if (STATE.tabSwitches > 10000) STATE.tabSwitches = 100;
}, 60000);

function attachSessionBridgeUiListener() {
  if (window.__SFAI_BRIDGE_UI_LISTENER_ATTACHED__) return;
  window.__SFAI_BRIDGE_UI_LISTENER_ATTACHED__ = true;

  window.SFAI_SESSION_BRIDGE?.on?.(async ({ eventName, payload }) => {
    try {
      if (STATE.loopStopped) return;

      if (eventName === "study:update" || eventName === "dashboard:update") {
        if (await ignoreIfStaleAndRemember(payload)) {
          return;
        }

        const activityId = getPayloadActivityId(payload);

        if (activityId) {
          STATE.activeActivityId = activityId;
          window.SFAI_OVERLAY_CHAT?.setActiveActivityId?.(activityId);
        }

        await saveLatestAiDecision(payload);

      if (payload?.popup) {
  renderRealtimePopup(payload.popup, payload.dashboard);
}
      }

      if (eventName === "study:voice-status") {
        const status = payload?.voiceStatus || payload?.status || "voice";
        window.SFAI_OVERLAY_CHAT?.setStatus?.(status);
      }

      if (eventName === "study:voice-updated") {
        if (await ignoreIfStaleAndRemember(payload)) {
          return;
        }

        await saveLatestAiDecision(payload);

        const ai = payload?.ai || {};
        const reply =
          ai.reply ||
          ai.voiceText ||
          ai.message ||
          payload?.reply ||
          payload?.message ||
          "";

        const activityId = getPayloadActivityId(payload);

        if (activityId) {
          STATE.activeActivityId = activityId;
          window.SFAI_OVERLAY_CHAT?.setActiveActivityId?.(activityId);
        }

        if (reply) {
          addChatMessage("ai", reply);
          window.SFAI_OVERLAY_CHAT?.addAiMessage?.(reply);

          speakDynamicAiText(reply, {
            restartListening:
              Boolean(ai.shouldContinueConversation || ai.followUpQuestion) &&
              !ai.finalDecisionMade,
          });
        }

        window.SFAI_OVERLAY_CHAT?.setStatus?.(
          ai.finalDecisionMade ? "completed" : "speaking"
        );
      }
    } catch (error) {
      console.warn(
        "[Study Focus AI] bridge UI listener error:",
        error?.message || error
      );
    }
  });
}

function startStudyAiContentScript() {
  if (window.__STUDY_AI_RUNNING__) return;
  if (!hasLiveExtensionContext()) return;

  window.__STUDY_AI_RUNNING__ = true;
  STATE.loopStopped = false;

  window.renderRealtimePopup = renderRealtimePopup;
  window.speakDynamicAiText = speakDynamicAiText;

  attachSessionBridgeUiListener();

  window.SFAI_SESSION_BRIDGE?.connect?.().catch((error) => {
    console.warn(
      "[Study Focus AI] session bridge connect failed:",
      error?.message || error
    );
  });

  signalLoop();
}

window.addEventListener("error", (event) => {
  if (isExtensionContextInvalidatedError(event.error || event.message)) {
    event.preventDefault();
    stopBecauseExtensionContextGone();
  }
});

window.addEventListener("unhandledrejection", (event) => {
  if (isExtensionContextInvalidatedError(event.reason)) {
    event.preventDefault();
    stopBecauseExtensionContextGone();
  }
});

try {
  chrome.runtime.onMessage.addListener((message) => {
    if (STATE.loopStopped) return;

    if (message?.type === "STUDY_POPUP") {
      const data = message.payload || {};

      (async () => {
        if (await ignoreIfStaleAndRemember(data)) {
          return;
        }
if (data?.popup) {
  renderRealtimePopup(data.popup, data.dashboard);
}
      })();
    }

    if (message?.type === "STUDY_VOICE_STATUS") {
      window.SFAI_OVERLAY_CHAT?.setStatus?.(
        message.payload?.voiceStatus || message.payload?.status || "voice"
      );
    }

    if (message?.type === "STUDY_VOICE_MESSAGE") {
      const text = message.payload?.text || "";
      const role = message.payload?.role || "ai";

      if (role === "user") {
        window.SFAI_OVERLAY_CHAT?.addUserMessage?.(text);
      } else {
        window.SFAI_OVERLAY_CHAT?.addAiMessage?.(text);
      }
    }
  });
} catch {}

startStudyAiContentScript();