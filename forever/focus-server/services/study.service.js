import StudyGoal from "../models/StudyGoal.js";
import StudyActivity from "../models/StudyActivity.js";
import StudyConversation from "../models/StudyConversation.js";
import StudySession from "../models/StudySession.js";
import StudyInsight from "../models/StudyInsight.js";
import UserDeviceLink from "../models/UserDeviceLink.js";
import PatternMemory, { makePatternGoalHash, makePatternKey } from "../models/PatternMemory.js";
import { enrichDashboardPayload } from "./study.dynamicPayload.service.js";
import {
  emitStudyEvent,
  emitDevicesUpdated,
  getConnectedDevices,
} from "../config/realtime.js";

import {
  analyzeRealtimeWithCloudGemma,
  analyzeDeepWithCloudGemma,
  analyzeVoiceReplyWithAgenticGemma,
} from "./ai/agenticGemma.service.js";

import { studyRuntimeConfig } from "../config/studyRuntime.config.js";

/**
 * server/services/study.service.js
 * ------------------------------------------------------------
 * Feature 1 main brain.
 *
 * This replacement keeps old features and adds:
 * - history-based popup decision
 * - immediate popup for non-study if user is still on same non-study page
 * - no stale popup if user already returned to study page
 * - non-study → non-study stronger motivation
 * - many non-study switches → strict intervention
 * - non-study → study → no popup, save recovered_to_study
 * - voice motivation + chat motivation saved together
 * - scrollable activity/timeline history per device/user/session
 * - correct socket emit target object
 * - Mongo enum-safe timeline/refocus values
 */

const DEFAULT_DASHBOARD_LIMIT = 40;
const RECENT_HISTORY_MINUTES = 60;
const RECENT_HISTORY_LIMIT = 40;
const activeAiRequests = new Map();
const activeDeepAnalysis = new Set();

function now() {
  return new Date();
}

function nowIso() {
  return new Date().toISOString();
}

function cleanId(value = "") {
  return String(value || "").trim();
}

function cleanText(value = "") {
  return String(value || "").trim();
}

function publicId(doc) {
  if (!doc) return "";
  return String(doc._id || doc.id || "");
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function clamp100(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

function safeDate(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return d;
}

function getDomain(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeAiType(type = "") {
  const t = String(type || "").trim();

  if (t === "study") return "study";
  if (t === "partial") return "partial";
  if (t === "non-study") return "non-study";
  if (t === "non_study") return "non-study";
  if (t === "nonstudy") return "non-study";

  return "unknown";
}

function aiTypeToTimeline(type = "") {
  const t = normalizeAiType(type);

  if (t === "study") return "study";
  if (t === "partial") return "partial";
  if (t === "non-study") return "non_study";

  return "unknown";
}

function getAiTypeFromActivity(item = {}) {
  return normalizeAiType(
    item?.ai?.type ||
      item?.type ||
      item?.computed?.decision ||
      item?.decision?.type ||
      "unknown"
  );
}

function normalizePage(input = {}, fallbackTab = {}) {
  const page = input.page || input || {};
  const url = cleanText(page.url || input.url || fallbackTab.url || "");
  const domain = cleanText(page.domain || getDomain(url));
  const visibleText = cleanText(
    page.visibleText || page.text || page.bodyText || input.visibleText || ""
  );

  return {
    url,
    domain,
    title: cleanText(page.title || input.title || fallbackTab.title || ""),
    topic: cleanText(page.topic || input.topic || ""),
    visibleText,
    text: cleanText(page.text || visibleText),
    bodyText: cleanText(page.bodyText || visibleText),
    headings: safeArray(page.headings).map(String).slice(0, 30),
    paragraphs: safeArray(page.paragraphs).map(String).slice(0, 30),
    links: safeArray(page.links).map(String).slice(0, 30),
    textLength: safeNumber(
      page.textLength || visibleText.length || page.text?.length || 0,
      0
    ),
    isBlank: Boolean(page.isBlank),
    isPdf: Boolean(page.isPdf || /\.pdf($|\?)/i.test(url)),
    isRestricted: Boolean(page.isRestricted),
    isSpa: Boolean(page.isSpa),
    hasIframes: Boolean(page.hasIframes),
    screenshotBase64: page.screenshotBase64 || page.imageBase64 || "",
    screenshotCapturedAt: page.screenshotCapturedAt || page.capturedAt || null,
    hasScreenshot: Boolean(
      page.hasScreenshot || page.screenshotBase64 || page.imageBase64
    ),
  };
}

function normalizeBehavior(input = {}) {
  const b = input.behavior || input || {};

  return {
    dwellMs: safeNumber(b.dwellMs || b.durationMs || 0, 0),
    durationMs: safeNumber(b.durationMs || b.dwellMs || 0, 0),
    scrollDepth: safeNumber(b.scrollDepth || b.scrollDistance || 0, 0),
    scrollSpeed: safeNumber(b.scrollSpeed || 0, 0),
    tabSwitches: safeNumber(b.tabSwitches || 0, 0),
    idleMs: safeNumber(b.idleMs || 0, 0),
    typingCount: safeNumber(b.typingCount || b.keyEvents || 0, 0),
    mouseMoves: safeNumber(b.mouseMoves || b.mouseEvents || 0, 0),
    routeChanges: safeNumber(b.routeChanges || 0, 0),
    iframeCount: safeNumber(b.iframeCount || 0, 0),
    isHidden: Boolean(b.isHidden),
  };
}

function buildPublicActivity(activity) {
  if (!activity) return null;

  const plain = activity.toObject ? activity.toObject() : activity;

  return {
    id: publicId(plain),
    _id: publicId(plain),
    userId: plain.userId || "",
    deviceId: plain.deviceId || "",
    sessionId: publicId(plain.sessionId) || "",
    goal: plain.goal || "",
    page: plain.page || {},
    behavior: plain.behavior || {},
    signals: plain.signals || {},
    ai: plain.ai || {},
    decision: plain.decision || {},
    explainability: plain.explainability || {},
    intervention: plain.intervention || {},
    timelineEvent: plain.timelineEvent || "unknown",
    refocus: plain.refocus || {},
    popup: plain.popup || {},
    voiceSession: plain.voiceSession || {},
    feedback: plain.feedback || {},
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
}

function formatMinutes(ms = 0) {
  const m = Math.max(0, Math.round(Number(ms || 0) / 60000));
  if (m < 1) return "less than 1 min";
  if (m === 1) return "1 min";
  return `${m} mins`;
}

/* -------------------------------------------------------------------------- */
/* Goal/session helpers                                                        */
/* -------------------------------------------------------------------------- */

export async function upsertStudyGoal({
  deviceId,
  userId = "",
  goal,
  deviceType = "extension",
  label = "Study device",
}) {
  const cleanDeviceId = cleanId(deviceId);
  const cleanUserId = cleanId(userId);
  const cleanGoal = cleanText(goal);

  if (!cleanDeviceId) {
    throw new Error("deviceId is required");
  }

  if (!cleanGoal) {
    throw new Error("goal is required");
  }

  const goalDoc = await StudyGoal.findOneAndUpdate(
    {
      deviceId: cleanDeviceId,
      userId: cleanUserId,
    },
    {
      $set: {
        deviceId: cleanDeviceId,
        userId: cleanUserId,
        goal: cleanGoal,
        active: true,
        updatedAt: now(),
      },
      $setOnInsert: {
        createdAt: now(),
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );

  await UserDeviceLink.findOneAndUpdate(
    {
      deviceId: cleanDeviceId,
      userId: cleanUserId,
    },
    {
      $set: {
        deviceId: cleanDeviceId,
        userId: cleanUserId,
        deviceType: deviceType || "unknown",
        label: label || deviceType || "Study device",
        lastSeenAt: now(),
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );

  emitStudyEvent(
    {
      deviceId: cleanDeviceId,
      userId: cleanUserId,
    },
    "study:goal-updated",
    {
      goal: goalDoc,
      deviceId: cleanDeviceId,
      userId: cleanUserId,
    }
  );

  emitDevicesUpdated({
    deviceId: cleanDeviceId,
    userId: cleanUserId,
  });

  return goalDoc;
}



export async function startStudySession({
  deviceId,
  userId = "",
  goal = "",
  deviceType = "extension",
  label = "Study device",
  reason = "",
}) {
  const cleanDeviceId = cleanId(deviceId);
  const cleanUserId = cleanId(userId);

  if (!cleanDeviceId) {
    throw new Error("deviceId is required");
  }

  let finalGoal = cleanText(goal);

  if (!finalGoal) {
    const goalDoc = await getStudyGoal({
      deviceId: cleanDeviceId,
      userId: cleanUserId,
    });
    finalGoal = goalDoc?.goal || "";
  }

  if (!finalGoal) {
    throw new Error("Study goal is required before starting session");
  }

  await StudySession.updateMany(
    {
      deviceId: cleanDeviceId,
      userId: cleanUserId,
      active: true,
    },
    {
      $set: {
        active: false,
        endedAt: now(),
        status: "ended",
        endReason: "Replaced by a new session",
      },
    }
  );

  const session = await StudySession.create({
    deviceId: cleanDeviceId,
    userId: cleanUserId,
    goal: finalGoal,
    active: true,
    status: "active",
    startedAt: now(),
    deviceType,
    label,
    startReason: reason || "Started study session",
  });

  await UserDeviceLink.findOneAndUpdate(
    {
      deviceId: cleanDeviceId,
      userId: cleanUserId,
    },
    {
      $set: {
        deviceId: cleanDeviceId,
        userId: cleanUserId,
        deviceType,
        label,
        lastSeenAt: now(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  emitStudyEvent(
    {
      deviceId: cleanDeviceId,
      userId: cleanUserId,
    },
    "study:session-started",
    {
      session,
      deviceId: cleanDeviceId,
      userId: cleanUserId,
    }
  );

  emitDevicesUpdated({
    deviceId: cleanDeviceId,
    userId: cleanUserId,
  });

  return session;
}

export async function endStudySession({
  deviceId,
  userId = "",
  reason = "Ended by user",
}) {
  const cleanDeviceId = cleanId(deviceId);
  const cleanUserId = cleanId(userId);

  if (!cleanDeviceId) {
    throw new Error("deviceId is required");
  }

  const session = await StudySession.findOneAndUpdate(
    {
      deviceId: cleanDeviceId,
      userId: cleanUserId,
      active: true,
    },
    {
      $set: {
        active: false,
        status: "ended",
        endedAt: now(),
        endReason: reason,
      },
    },
    {
      new: true,
    }
  );

  emitStudyEvent(
    {
      deviceId: cleanDeviceId,
      userId: cleanUserId,
    },
    "study:session-ended",
    {
      session,
      deviceId: cleanDeviceId,
      userId: cleanUserId,
    }
  );

  emitDevicesUpdated({
    deviceId: cleanDeviceId,
    userId: cleanUserId,
  });

  return session;
}

export async function getCurrentStudySession(input = {}, maybeOptions = {}) {
  /**
   * Backward compatible call styles:
   *   getCurrentStudySession({ deviceId, userId })
   *   getCurrentStudySession(deviceId, { userId })
   *
   * Returns a stable envelope for extension popup/dashboard:
   *   { monitoringActive, sessionStatus, session, currentSession }
   */
  const cleanDeviceId =
    typeof input === "object" ? cleanId(input.deviceId) : cleanId(input);

  const cleanUserId =
    typeof input === "object"
      ? cleanId(input.userId || maybeOptions.userId || "")
      : cleanId(maybeOptions.userId || "");

  if (!cleanDeviceId) {
    throw new Error("deviceId is required");
  }

  const query = {
    deviceId: cleanDeviceId,
    active: true,
    status: "active",
  };

  if (cleanUserId) {
    query.userId = cleanUserId;
  }

  const session = await StudySession.findOne(query).sort({ startedAt: -1 });
  const plainSession = session?.toObject ? session.toObject() : session;

  return {
    deviceId: cleanDeviceId,
    userId: cleanUserId,
    monitoringActive: Boolean(plainSession),
    sessionStatus: plainSession ? "active" : "ended",
    session: plainSession || null,
    currentSession: plainSession || null,
    activeSession: plainSession || null,
  };
}

/* -------------------------------------------------------------------------- */
/* Scoring helpers                                                             */
/* -------------------------------------------------------------------------- */

function tokenize(text = "") {
  return String(text || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\u0980-\u09ff]+/gi, " ")
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 3);
}

function computeRelevanceScore({ goal = "", page = {} }) {
  const goalTokens = new Set(tokenize(goal));
  if (!goalTokens.size) return 0;

  const pageText = [
    page.title,
    page.topic,
    page.visibleText,
    safeArray(page.headings).join(" "),
    safeArray(page.paragraphs).slice(0, 3).join(" "),
  ].join(" ");

  const pageTokens = new Set(tokenize(pageText));
  if (!pageTokens.size) return 0;

  let hits = 0;
  goalTokens.forEach((token) => {
    if (pageTokens.has(token)) hits += 1;
  });

  return clamp100((hits / goalTokens.size) * 100, 0);
}

function computeBehaviorScore(behavior = {}) {
  let score = 50;

  const dwellMs = safeNumber(behavior.dwellMs || behavior.durationMs, 0);
  const typing = safeNumber(behavior.typingCount, 0);
  const scrollDepth = safeNumber(behavior.scrollDepth, 0);
  const tabSwitches = safeNumber(behavior.tabSwitches, 0);
  const idleMs = safeNumber(behavior.idleMs, 0);
  const scrollSpeed = safeNumber(behavior.scrollSpeed, 0);

  if (dwellMs >= 60_000) score += 15;
  else if (dwellMs >= 20_000) score += 8;
  else if (dwellMs < 5_000) score -= 10;

  if (typing >= 10) score += 12;
  if (scrollDepth >= 30 && scrollSpeed < 120) score += 8;

  if (tabSwitches >= 4) score -= 20;
  else if (tabSwitches >= 2) score -= 10;

  if (idleMs >= 60_000) score -= 15;
  if (scrollSpeed >= 350) score -= 10;

  return clamp100(score, 50);
}

async function getPatternMemoryScore({ deviceId, userId = "", goal = "", domain = "" }) {
  if (!domain) return 0;

  try {
    const memory = await PatternMemory.findOne({
      deviceId: cleanId(deviceId),
      userId: cleanId(userId),
      goal,
      domain,
    }).lean();

    if (!memory) return 0;

    return clamp100(memory.memoryScore || 0, 0);
  } catch {
    return 0;
  }
}

function fuseDecision({ ai, relevanceScore, behaviorScore, memoryScore }) {
  const aiConfidence = clamp01(ai?.confidence, 0.5) * 100;

  const finalConfidence = clamp100(
    aiConfidence * 0.55 +
      relevanceScore * 0.2 +
      behaviorScore * 0.15 +
      memoryScore * 0.1,
    50
  );

  return {
    aiConfidence,
    finalConfidence,
    relevanceScore,
    behaviorScore,
    memoryScore,
  };
}

/* -------------------------------------------------------------------------- */
/* History-based guardian popup engine                                         */
/* -------------------------------------------------------------------------- */

function analyzeDistractionHistory(recentHistory = []) {
  const rows = safeArray(recentHistory);

  const recentTypes = rows.map((item) => getAiTypeFromActivity(item));

  const recentDomains = rows
    .map((item) => item?.page?.domain || "")
    .filter(Boolean);

  const recentNonStudy = rows.filter((item) => {
    return getAiTypeFromActivity(item) === "non-study";
  });

  const recentStudy = rows.filter((item) => {
    return getAiTypeFromActivity(item) === "study";
  });

  const recentPopups = rows.filter((item) => {
    return (
      item?.popup?.shouldShow === true ||
      item?.intervention?.shownCount > 0 ||
      item?.timelineEvent === "refocus_triggered" ||
      item?.timelineEvent === "distraction_loop"
    );
  });

  const recentRecoveries = rows.filter((item) => {
    return (
      item?.timelineEvent === "recovered_to_study" ||
      item?.timelineEvent === "self_recovered" ||
      item?.refocus?.status === "self_recovered"
    );
  });

  let consecutiveNonStudy = 0;

  for (const item of rows) {
    if (getAiTypeFromActivity(item) === "non-study") {
      consecutiveNonStudy += 1;
    } else {
      break;
    }
  }

  const uniqueNonStudyDomains = new Set(
    recentNonStudy.map((item) => item?.page?.domain).filter(Boolean)
  );

  const lastStudy = rows.find((item) => getAiTypeFromActivity(item) === "study");
  const lastNonStudy = rows.find(
    (item) => getAiTypeFromActivity(item) === "non-study"
  );

  const minutesSinceLastStudy = lastStudy?.createdAt
    ? Math.round((Date.now() - new Date(lastStudy.createdAt).getTime()) / 60000)
    : null;

  const awayMs = lastStudy?.createdAt
    ? Math.max(0, Date.now() - new Date(lastStudy.createdAt).getTime())
    : 0;

  const nonStudyTimeMs = recentNonStudy.reduce((sum, item) => {
    return sum + safeNumber(item?.behavior?.dwellMs || item?.behavior?.durationMs, 0);
  }, 0);

  const studyTimeMs = recentStudy.reduce((sum, item) => {
    return sum + safeNumber(item?.behavior?.dwellMs || item?.behavior?.durationMs, 0);
  }, 0);

  return {
    totalChecked: rows.length,
    recentTypes,
    recentDomains,

    recentNonStudyCount: recentNonStudy.length,
    recentStudyCount: recentStudy.length,
    recentPopupCount: recentPopups.length,
    recentRecoveryCount: recentRecoveries.length,

    consecutiveNonStudy,
    domainSwitchCount: uniqueNonStudyDomains.size,
    minutesSinceLastStudy,
    awayMs,

    nonStudyTimeMs,
    studyTimeMs,
    nonStudyTimeText: formatMinutes(nonStudyTimeMs),
    studyTimeText: formatMinutes(studyTimeMs),

    hasRecentStudy: recentStudy.length > 0,
    hasRecentRecovery: recentRecoveries.length > 0,
    lastType: rows[0] ? getAiTypeFromActivity(rows[0]) : "unknown",
    previousType: rows[0] ? getAiTypeFromActivity(rows[0]) : "unknown",
    lastNonStudyDomain: lastNonStudy?.page?.domain || "",
  };
}

function buildPopupDecisionFromHistory({
  ai,
  goal,
  currentDomain,
  previousActivity,
  recentHistory,
}) {
  const currentType = normalizeAiType(ai?.type);
  const previousType = previousActivity
    ? getAiTypeFromActivity(previousActivity)
    : "unknown";

  const history = analyzeDistractionHistory(recentHistory);

  /**
   * Case 1:
   * User came back to study.
   * No popup. Save recovery.
   */
  if (previousType === "non-study" && currentType === "study") {
    return {
      shouldShow: false,
      type: "none",
      priority: "low",
      pattern: "recovered_to_study",
      timelineEvent: "recovered_to_study",
      reason: "User returned from non-study to study.",
      history,
    };
  }

  /**
   * Case 2:
   * Normal study page.
   * No popup. Save focus update.
   */
  if (currentType === "study") {
    return {
      shouldShow: false,
      type: "none",
      priority: "low",
      pattern: "focus",
      timelineEvent: "focus_update",
      reason: "User is on a study page.",
      history,
    };
  }

  /**
   * Case 3:
   * AI unsure.
   * Ask user.
   */
  if (currentType === "partial") {
    return {
      shouldShow: true,
      type: "ask_user",
      priority: "medium",
      pattern: "uncertain",
      timelineEvent: "ask_user",
      reason: "AI is unsure whether this page supports the study goal.",
      history,
    };
  }

  /**
   * Case 4:
   * Non-study with history-based distraction loop.
   */
  if (currentType === "non-study") {
    const isFirstDistraction =
      previousType === "study" || history.recentNonStudyCount === 0;

    const isRepeatedNonStudy =
      previousType === "non-study" ||
      history.consecutiveNonStudy >= 1 ||
      history.recentNonStudyCount >= 2;

    const nonStudyTimeDominates =
      history.nonStudyTimeMs > 0 &&
      history.nonStudyTimeMs >= Math.max(60_000, history.studyTimeMs * 1.2);

    const isDistractionLoop =
      history.consecutiveNonStudy >= 2 ||
      history.recentNonStudyCount >= 3 ||
      history.domainSwitchCount >= 3 ||
      history.recentPopupCount >= 2 ||
      nonStudyTimeDominates;

    if (isDistractionLoop) {
      return {
        shouldShow: true,
        type: "strict-intervention",
        priority: "high",
        pattern: "distraction_loop",
        timelineEvent: "distraction_loop",
        reason:
          "User has spent more time on non-study pages recently and may be in a distraction loop.",
        history,
      };
    }

    if (isRepeatedNonStudy) {
      return {
        shouldShow: true,
        type: "intervention",
        priority: "high",
        pattern: "non_study_to_non_study",
        timelineEvent: "non_study_to_non_study",
        reason: "User moved from one non-study page to another.",
        history,
      };
    }

    if (isFirstDistraction) {
      return {
        shouldShow: true,
        type: "intervention",
        priority: "medium",
        pattern: "study_to_distraction",
        timelineEvent: "study_to_distraction",
        reason: "User moved away from study to a non-study page.",
        history,
      };
    }

    return {
      shouldShow: true,
      type: "intervention",
      priority: "medium",
      pattern: "non_study",
      timelineEvent: "refocus_triggered",
      reason: "Current page appears unrelated to the study goal.",
      history,
    };
  }

  return {
    shouldShow: false,
    type: "none",
    priority: "low",
    pattern: "unknown",
    timelineEvent: "unknown",
    reason: "No popup decision made.",
    history,
  };
}


function buildAgenticMotivation({ decision, ai, goal, currentDomain }) {
  const history = decision.history || {};
  const goalText = goal || "your study goal";
  const domainText = currentDomain || "this page";

  const recentNonStudyCount = Number(history.recentNonStudyCount || 0);
  const domainSwitchCount = Number(history.domainSwitchCount || 0);
  const minutesSinceLastStudy = history.minutesSinceLastStudy;
  const nonStudyTimeText = history.nonStudyTimeText || "";
  const studyTimeText = history.studyTimeText || "";

  const aiMotivation = cleanText(ai?.motivation || "");
  const aiVoiceText = cleanText(ai?.voiceText || ai?.reply || "");

  if (decision.pattern === "study_to_distraction") {
    return {
      title: "You are drifting away",
      message:
        aiMotivation ||
        `You were studying ${goalText}, but now you opened ${domainText}. Come back now before this becomes a long distraction.`,
      voiceText:
        aiVoiceText ||
        `You are drifting away from your study goal. Return to your study page now.`,
      chatMessage:
        `I noticed you moved away from ${goalText} to ${domainText}. This is the easiest moment to recover. Open your study material again and continue for only 5 minutes.`,
      suggestedAction: `Open your ${goalText} material and study for 5 minutes.`,
      historyInsight: "This looks like the first drift away from a study page.",
    };
  }

  if (decision.pattern === "non_study_to_non_study") {
    return {
      title: "You are still outside study",
      message:
        aiMotivation ||
        `You moved from one non-study page to another. This is where time disappears. Return to ${goalText} for just 5 minutes.`,
      voiceText:
        aiVoiceText ||
        `You are still outside your study goal. Break this now and study for five minutes.`,
      chatMessage:
        `You are moving between distracting pages instead of returning to ${goalText}. I am not asking for a perfect study session. Just break the chain with one small action: open the study page and work for 5 minutes.`,
      suggestedAction: `Break the chain: return to ${goalText} for 5 minutes.`,
      historyInsight: "You moved from one non-study page to another.",
    };
  }

  if (decision.pattern === "distraction_loop") {
    return {
      title: "Break the distraction loop",
      message:
        aiMotivation ||
        `You have visited ${recentNonStudyCount} non-study pages recently${
          domainSwitchCount ? ` across ${domainSwitchCount} different sites` : ""
        }${
          minutesSinceLastStudy
            ? ` and have been away from study for about ${minutesSinceLastStudy} minutes`
            : ""
        }. Do not try to fix the whole day. Just open your ${goalText} material and study for 5 minutes.`,
      voiceText:
        aiVoiceText ||
        `This is a distraction loop. Start small. Return to your study material for five minutes.`,
      chatMessage:
        `This looks like a distraction loop. Recently you visited ${recentNonStudyCount} non-study pages${
          domainSwitchCount ? ` across ${domainSwitchCount} sites` : ""
        }${
          minutesSinceLastStudy
            ? ` and stayed away from study for about ${minutesSinceLastStudy} minutes`
            : ""
        }${
          nonStudyTimeText
            ? `. Estimated non-study time: ${nonStudyTimeText}`
            : ""
        }${
          studyTimeText ? `. Estimated study time: ${studyTimeText}` : ""
        }. The goal is not to become perfect immediately. The next best action is tiny: open your ${goalText} material and do 5 minutes.`,
      suggestedAction: `Do a 5-minute reset: open ${goalText} material now.`,
      historyInsight: `Recent non-study pages: ${recentNonStudyCount}. Domain switches: ${domainSwitchCount}.`,
    };
  }

  if (decision.type === "ask_user") {
    return {
      title: "Is this helping your study?",
      message:
        ai?.followUpQuestion ||
        `I am not fully sure if this page supports ${goalText}. Is it helping your study?`,
      voiceText:
        aiVoiceText ||
        `I am not sure if this page helps your study. Please confirm.`,
      chatMessage:
        `I am unsure whether ${domainText} supports your goal: ${goalText}. Please confirm so I can learn your pattern better.`,
      suggestedAction: "Confirm whether this page is study-related.",
      historyInsight:
        "AI confidence is not high enough, so user confirmation is useful.",
    };
  }

  if (decision.pattern === "recovered_to_study") {
    return {
      title: "Good recovery",
      message: `You returned to ${goalText}. Good job recovering from distraction.`,
      voiceText: "",
      chatMessage: `Good recovery. You returned to ${goalText}. I saved this as a positive focus recovery.`,
      suggestedAction: `Continue ${goalText} for the next 5 minutes.`,
      historyInsight: "User returned from a non-study page to study.",
    };
  }

  return {
    title: "Return to your study goal",
    message:
      aiMotivation ||
      `This page does not seem connected to ${goalText}. Go back now while it is still easy to recover.`,
    voiceText:
      aiVoiceText ||
      `This looks unrelated to your study goal. Please return to your study goal.`,
    chatMessage:
      `This page does not look connected to ${goalText}. You can still recover quickly. Go back to your study page and continue with one small task.`,
    suggestedAction: `Return to ${goalText} and complete one small task.`,
    historyInsight: "Current page appears unrelated to the study goal.",
  };
}

function buildPopupPayload({ popupDecision, motivation, activity = null, page = {}, ai = {} }) {
  if (!popupDecision?.shouldShow) {
    return {
      shouldShow: false,
      type: "none",
      title: "",
      message: "",
      voiceText: "",
      chatMessage:
        popupDecision?.pattern === "recovered_to_study"
          ? motivation?.chatMessage || ""
          : "",
      suggestedAction: motivation?.suggestedAction || "",
      historyInsight: motivation?.historyInsight || "",
      priority: "low",
      pattern: popupDecision?.pattern || "",
      reason: popupDecision?.reason || "",
      recentNonStudyCount: popupDecision?.history?.recentNonStudyCount || 0,
      recentPopupCount: popupDecision?.history?.recentPopupCount || 0,
      recentRecoveredCount: popupDecision?.history?.recentRecoveryCount || 0,
      createdAt: null,
    };
  }

  return {
    shouldShow: true,
    type: popupDecision.type || "intervention",
    title: motivation.title || "AI Study Coach",
    message: motivation.message || ai?.motivation || "",
    voiceText: motivation.voiceText || ai?.voiceText || "",
    chatMessage: motivation.chatMessage || motivation.message || "",
    suggestedAction: motivation.suggestedAction || "",
    historyInsight: motivation.historyInsight || "",
    priority: popupDecision.priority || "medium",
    pattern: popupDecision.pattern || "",
    reason: popupDecision.reason || "",
    recentNonStudyCount: popupDecision.history?.recentNonStudyCount || 0,
    recentPopupCount: popupDecision.history?.recentPopupCount || 0,
    recentRecoveredCount: popupDecision.history?.recentRecoveryCount || 0,
    page: {
      url: page.url || "",
      domain: page.domain || "",
      title: page.title || "",
    },
    activityId: activity ? publicId(activity) : "",
    createdAt: now(),
  };
}

function buildCoachMessage({ popup, activity = null, ai = {}, goal = "" }) {
  if (!popup?.chatMessage && !popup?.message) return null;

  return {
    id: activity ? publicId(activity) : `coach-${Date.now()}`,
    activityId: activity ? publicId(activity) : "",
    role: "assistant",
    type: popup?.shouldShow ? "motivation" : "history",
    title: popup.title || "AI Study Coach",
    text: popup.chatMessage || popup.message || "",
    voiceText: popup.voiceText || "",
    suggestedAction: popup.suggestedAction || "",
    historyInsight: popup.historyInsight || "",
    priority: popup.priority || "low",
    pattern: popup.pattern || "",
    goal: goal || "",
    aiType: ai?.type || "unknown",
    createdAt: nowIso(),
  };
}

function buildRefocusPayload({ ai, goal, popupDecision, popup }) {
  if (normalizeAiType(ai?.type) !== "non-study") {
    return {
      status:
        popupDecision?.pattern === "recovered_to_study"
          ? "self_recovered"
          : "none",
      recoveredAt:
        popupDecision?.pattern === "recovered_to_study" ? now() : undefined,
      message: "",
      voiceText: "",
      reason: popupDecision?.reason || "",
    };
  }

  return {
    status: "triggered",
    triggeredAt: now(),
    message:
      popup?.message ||
      ai?.motivation ||
      `Let's return to your study goal: ${goal}. Open one useful study page now.`,
    voiceText:
      popup?.voiceText ||
      ai?.voiceText ||
      `This looks distracting. Let's return to ${goal} now.`,
    reason:
      popupDecision?.reason ||
      ai?.reason ||
      "This page looks unrelated to your current study goal.",
  };
}

function buildVoiceSessionPayload({ popup, ai, popupDecision }) {
  const shouldSpeak = Boolean(popup?.shouldShow && popup?.voiceText);
  const needsConversation = Boolean(ai?.needsUserCheck || ai?.type === "partial");

  return {
    status: shouldSpeak
      ? "speaking"
      : needsConversation
      ? "asking"
      : "not-started",
    stage: shouldSpeak || needsConversation ? 1 : 0,
    turns:
      shouldSpeak || popup?.chatMessage
        ? [
            {
              role: "assistant",
              text: popup.voiceText || popup.chatMessage || popup.message || "",
              stage: 1,
              at: now(),
            },
          ]
        : [],
    finalDecisionMade: normalizeAiType(ai?.type) !== "partial",
    shouldContinueConversation: needsConversation,
    stopReason: popup?.shouldShow
      ? "Agentic motivation generated from page decision and recent history."
      : popupDecision?.pattern === "recovered_to_study"
      ? "User returned to study page. No intervention needed."
      : "No intervention needed.",
  };
}

function buildDecisionPayload({ ai, popupDecision, fusion }) {
  const action =
    popupDecision?.type === "ask_user"
      ? "ask"
      : popupDecision?.shouldShow
      ? popupDecision.priority === "high"
        ? "refocus"
        : "intervene"
      : "continue";

  return {
    action,
    reason: ai?.decisionReason || ai?.reason || popupDecision?.reason || "",
    severity: popupDecision?.priority || ai?.severity || "low",
    adaptiveLevel:
      popupDecision?.priority === "high"
        ? 2
        : popupDecision?.priority === "medium"
        ? 1
        : 0,
    pattern: popupDecision?.pattern || "",
    recentNonStudyCount: popupDecision?.history?.recentNonStudyCount || 0,
    recentPopupCount: popupDecision?.history?.recentPopupCount || 0,
    recentRecoveredCount: popupDecision?.history?.recentRecoveryCount || 0,
    fusion: fusion || {},
  };
}

function buildInterventionPayload({ popupDecision }) {
  if (!popupDecision?.shouldShow) {
    return {
      shownCount: 0,
      ignoredCount: 0,
      lastShownAt: null,
      strictMode: false,
    };
  }

  return {
    shownCount: 1,
    ignoredCount: 0,
    lastShownAt: now(),
    strictMode:
      popupDecision.priority === "high" ||
      popupDecision.type === "strict-intervention",
  };
}

function buildExplainability(ai = {}, popupDecision = {}, fusion = {}) {
  const bullets = safeArray(ai?.explainability?.bullets);
  const evidence = safeArray(ai?.explainability?.evidence);

  const fallback = [
    popupDecision?.reason || ai?.reason || "AI analyzed page against study goal.",
  ];

  if (popupDecision?.history?.recentNonStudyCount) {
    fallback.push(
      `Recent non-study pages: ${popupDecision.history.recentNonStudyCount}`
    );
  }

  if (popupDecision?.history?.domainSwitchCount) {
    fallback.push(
      `Different distracting sites: ${popupDecision.history.domainSwitchCount}`
    );
  }

  return {
    bullets: bullets.length ? bullets : fallback.slice(0, 5),
    evidence: evidence.length
      ? evidence
      : [
          `AI confidence: ${Math.round((ai?.confidence || 0) * 100)}%`,
          `Relevance score: ${Math.round(fusion?.relevanceScore || 0)}%`,
          `Behavior score: ${Math.round(fusion?.behaviorScore || 0)}%`,
        ],
    userVisibleReason:
      ai?.explainability?.userVisibleReason ||
      popupDecision?.reason ||
      ai?.reason ||
      "AI compared your page with your study goal and recent behavior.",
  };
}

/* -------------------------------------------------------------------------- */
/* Emit helpers                                                                */
/* -------------------------------------------------------------------------- */

async function emitSafely(deviceId, eventName, payload) {
  try {
    const cleanDeviceId = cleanId(deviceId);
    const targetUserId = cleanId(payload?.userId || payload?.activity?.userId || "");

    emitStudyEvent(
      {
        deviceId: cleanDeviceId,
        userId: targetUserId,
      },
      eventName,
      {
        ...payload,
        deviceId: payload?.deviceId || cleanDeviceId,
        userId: payload?.userId || targetUserId,
      }
    );
  } catch (error) {
    console.warn(`[study.service] emit ${eventName} failed:`, error.message);
  }
}

async function emitRealtimeBundle({ deviceId, userId = "", activity, dashboard, popup, coachMessage }) {
  const publicActivity = buildPublicActivity(activity);

  const bundle = {
    deviceId,
    userId,
    activity: publicActivity,
    dashboard,
    popup,
    coachMessage,
    at: nowIso(),
  };

  await emitSafely(deviceId, "study:update", bundle);
  await emitSafely(deviceId, "dashboard:update", bundle);

  if (popup?.shouldShow) {
    await emitSafely(deviceId, "study:popup", {
      deviceId,
      userId,
      popup,
      activity: publicActivity,
      coachMessage,
      at: nowIso(),
    });

    await emitSafely(deviceId, "study:voice-updated", {
      deviceId,
      userId,
      voiceText: popup.voiceText || "",
      status: popup.voiceText ? "speaking" : "idle",
      popup,
      activityId: publicActivity?.id || "",
      at: nowIso(),
    });
  }

  if (coachMessage) {
    await emitSafely(deviceId, "study:coach-message", {
      deviceId,
      userId,
      coachMessage,
      activityId: publicActivity?.id || "",
      at: nowIso(),
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Conversation / memory helpers                                               */
/* -------------------------------------------------------------------------- */

async function saveCoachMessage({ deviceId, userId = "", sessionId = null, activityId = "", coachMessage = null }) {
  if (!coachMessage?.text) return null;

  try {
    const conversation = await StudyConversation.create({
      deviceId,
      userId,
      sessionId,
      activityId,
      role: "assistant",
      text: coachMessage.text,
      voiceText: coachMessage.voiceText || "",
      type: coachMessage.type || "motivation",
      metadata: {
        title: coachMessage.title || "",
        suggestedAction: coachMessage.suggestedAction || "",
        historyInsight: coachMessage.historyInsight || "",
        priority: coachMessage.priority || "",
        pattern: coachMessage.pattern || "",
      },
      createdAt: now(),
    });

    return conversation;
  } catch (error) {
    console.warn("[study.service] save coach message failed:", error.message);
    return null;
  }
}

async function getRecentConversations({ deviceId, userId = "", sessionId = "", limit = 10 }) {
  try {
    const query = {
      deviceId: cleanId(deviceId),
    };

    if (userId) query.userId = cleanId(userId);
    if (sessionId) query.sessionId = sessionId;

    return StudyConversation.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  } catch {
    return [];
  }
}

async function updatePatternMemory({ deviceId, userId = "", goal = "", domain = "", aiType = "", feedback = "" }) {
  if (!deviceId || !domain) return null;

  try {
    const cleanDeviceId = cleanId(deviceId);
    const cleanUserId = cleanId(userId);
    const cleanGoal = cleanText(goal);
    const cleanDomain = cleanText(domain).toLowerCase().replace(/^www\./, "");
    const type = normalizeAiType(aiType);
    const goalHash = makePatternGoalHash(cleanGoal);
    const patternKey = makePatternKey({ domain: cleanDomain, pageType: "page" });

    const delta =
      feedback === "correct"
        ? 10
        : feedback === "wrong"
          ? -10
          : type === "study"
            ? 3
            : type === "non-study"
              ? -3
              : 0;

    const inc = {
      totalCount: 1,
      memoryScore: delta,
    };

    if (type === "study") inc.studyCount = 1;
    else if (type === "partial") inc.partialCount = 1;
    else if (type === "non-study") inc.nonStudyCount = 1;

    if (feedback === "correct") inc.positiveCount = 1;
    if (feedback === "wrong") inc.negativeCount = 1;

    const memory = await PatternMemory.findOneAndUpdate(
      {
        deviceId: cleanDeviceId,
        goalHash,
        patternKey,
      },
      {
        $inc: inc,
        $set: {
          userId: cleanUserId,
          goal: cleanGoal,
          domain: cleanDomain,
          pageType: "page",
          lastType: type,
          learnedType: type,
          correctedType: feedback ? type : "unknown",
          lastFeedback: feedback || "",
          confidence: type === "study" ? 0.8 : type === "non-study" ? 0.2 : 0.5,
          lastSeenAt: now(),
          updatedAt: now(),
        },
        $setOnInsert: {
          deviceId: cleanDeviceId,
          goalHash,
          patternKey,
          createdAt: now(),
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    if (memory) {
      const clampedScore = clamp100(memory.memoryScore, 50);
      if (clampedScore !== memory.memoryScore) {
        memory.memoryScore = clampedScore;
        await memory.save();
      }
    }

    return memory;
  } catch (error) {
    console.warn("[study.service] pattern memory update failed:", error.message);
    return null;
  }
}


/* -------------------------------------------------------------------------- */
/* Compatibility goal helpers                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Controller compatibility:
 * study.controller.js calls setStudyGoal(req.body)
 */
export async function setStudyGoal(payload = {}) {
  return upsertStudyGoal(payload);
}

/**
 * Controller compatibility:
 * It can be called as:
 * - getStudyGoal("device-id")
 * - getStudyGoal({ deviceId, userId })
 */
export async function getGoalDoc(input, options = {}) {
  const cleanDeviceId =
    typeof input === "object" ? cleanId(input.deviceId) : cleanId(input);
  const cleanUserId =
    typeof input === "object"
      ? cleanId(input.userId || options.userId || "")
      : cleanId(options.userId || "");

  if (!cleanDeviceId) {
    throw new Error("deviceId is required");
  }

  const query = {
    deviceId: cleanDeviceId,
    active: true,
  };

  if (cleanUserId) {
    query.userId = cleanUserId;
  }

  const goal = await StudyGoal.findOne(query).sort({ updatedAt: -1 });
  return goal;
}

/**
 * IMPORTANT:
 * If Part 4.1 already has export async function getStudyGoal({ deviceId... }),
 * remove that older function and keep this one.
 */
export async function getStudyGoal(input, options = {}) {
  return getGoalDoc(input, options);
}

async function getOrCreateActiveSession({
  deviceId,
  userId = "",
  goal = "",
  deviceType = "extension",
  label = "Study device",
}) {
  const cleanDeviceId = cleanId(deviceId);
  const cleanUserId = cleanId(userId);

  if (!cleanDeviceId) {
    throw new Error("deviceId is required");
  }

  let session = await StudySession.findOne({
    deviceId: cleanDeviceId,
    userId: cleanUserId,
    active: true,
    status: "active",
  }).sort({ startedAt: -1 });

  if (session) return session;

  const finalGoal = cleanText(goal);

  if (!finalGoal) return null;

  session = await StudySession.create({
    deviceId: cleanDeviceId,
    userId: cleanUserId,
    goal: finalGoal,
    active: true,
    status: "active",
    startedAt: now(),
    reason: "Auto-started from incoming extension signal",
  });

  emitStudyEvent(
    {
      deviceId: cleanDeviceId,
      userId: cleanUserId,
    },
    "study:session-started",
    {
      session,
      deviceId: cleanDeviceId,
      userId: cleanUserId,
      autoStarted: true,
    }
  );

  return session;
}

async function incrementSessionTotals({ sessionId, aiType, popupShown = false }) {
  if (!sessionId) return;

  const type = normalizeAiType(aiType);

  const inc = {
    "totals.activities": 1,
  };

  if (type === "study") inc["totals.study"] = 1;
  if (type === "partial") inc["totals.partial"] = 1;
  if (type === "non-study") inc["totals.nonStudy"] = 1;
  if (popupShown) inc["totals.interventions"] = 1;

  try {
    await StudySession.findByIdAndUpdate(sessionId, {
      $inc: inc,
    });
  } catch (error) {
    console.warn("[study.service] session totals update failed:", error.message);
  }
}

/* -------------------------------------------------------------------------- */
/* Corrected permanent coach conversation save                                 */
/* -------------------------------------------------------------------------- */

/**
 * This version matches your StudyConversation schema.
 * It appends an assistant turn instead of creating wrong top-level text fields.
 *
 * If Part 4.2 has another saveCoachMessage() function, remove the old one and
 * keep this version.
 */
async function saveCoachMessageToHistory({
  deviceId,
  userId = "",
  sessionId = null,
  activityId = null,
  goal = "",
  coachMessage = null,
}) {
  if (!coachMessage?.text) return null;

  try {
    const query = {
      deviceId: cleanId(deviceId),
      status: "active",
    };

    if (userId) query.userId = cleanId(userId);
    if (sessionId) query.sessionId = sessionId;

    const conversation = await StudyConversation.findOneAndUpdate(
      query,
      {
        $set: {
          deviceId: cleanId(deviceId),
          userId: cleanId(userId),
          sessionId: sessionId || undefined,
          activityId: activityId || undefined,
          goal,
          status: "active",
          lastAiType: coachMessage.aiType || "unknown",
          lastMessageAt: now(),
          summary:
            coachMessage.historyInsight ||
            coachMessage.suggestedAction ||
            coachMessage.title ||
            "",
          updatedAt: now(),
        },
        $push: {
          turns: {
            role: "assistant",
            text: coachMessage.text,
            source: "extension",
            stage: 1,
            activityId: activityId || undefined,
            metadata: {
              title: coachMessage.title || "",
              voiceText: coachMessage.voiceText || "",
              suggestedAction: coachMessage.suggestedAction || "",
              historyInsight: coachMessage.historyInsight || "",
              priority: coachMessage.priority || "",
              pattern: coachMessage.pattern || "",
              type: coachMessage.type || "motivation",
            },
            at: now(),
          },
        },
        $setOnInsert: {
          createdAt: now(),
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    return conversation;
  } catch (error) {
    console.warn("[study.service] save coach message failed:", error.message);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Dashboard / analytics helpers                                               */
/* -------------------------------------------------------------------------- */

function getRangeStart(range = "all") {
  const r = String(range || "all").toLowerCase();
  const d = new Date();

  if (r === "today") {
    d.setHours(0, 0, 0, 0);
    return d;
  }

  if (r === "week") {
    d.setDate(d.getDate() - 7);
    return d;
  }

  if (r === "month") {
    d.setDate(d.getDate() - 30);
    return d;
  }

  return null;
}

function getActivityDwellMs(item = {}) {
  return Math.max(
    1000,
    safeNumber(item?.behavior?.dwellMs || item?.behavior?.durationMs, 0)
  );
}

function getActivityConfidence(item = {}) {
  const raw =
    item?.decision?.finalConfidence ??
    item?.ai?.finalConfidence ??
    item?.ai?.confidence ??
    item?.ai?.focusScore ??
    item?.signals?.finalConfidence;

  const n = Number(raw);

  if (!Number.isFinite(n)) return 0.5;

  return n > 1 ? clamp100(n, 50) / 100 : clamp01(n, 0.5);
}

function getActivityRiskText(item = {}) {
  return [
    item?.page?.domain,
    item?.page?.title,
    item?.page?.url,
    item?.page?.visibleText,
    item?.page?.text,
    item?.ai?.reason,
    item?.ai?.motivation,
    item?.popup?.message,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isRiskyEntertainmentActivity(item = {}) {
  return /youtube|instagram|facebook|tiktok|reels|shorts|music|song|instrumental|movie|netflix|entertainment|anime|drama|game|gaming|spotify/.test(
    getActivityRiskText(item)
  );
}

function isStudySignalActivity(item = {}) {
  return /ielts|writing|lecture|course|documentation|tutorial|assignment|practice|problem|coding|programming|paper|research|study|exam|class|lesson|notes/.test(
    getActivityRiskText(item)
  );
}

function getActivityFocusValue(item = {}) {
  const type = getAiTypeFromActivity(item);
  const confidence = getActivityConfidence(item);
  const behavior = item?.behavior || {};
  const tabSwitches = safeNumber(behavior.tabSwitches, 0);
  const idleMs = safeNumber(behavior.idleMs, 0);
  const typingCount = safeNumber(behavior.typingCount || behavior.keyEvents, 0);
  const scrollSpeed = safeNumber(behavior.scrollSpeed, 0);
  const risky = isRiskyEntertainmentActivity(item);
  const studySignal = isStudySignalActivity(item);

  if (type === "study") {
    let score = 72 + confidence * 28;
    if (typingCount >= 5) score += 4;
    if (tabSwitches >= 4) score -= 10;
    if (idleMs >= 90000) score -= 8;
    return clamp100(score, 70);
  }

  if (type === "non-study") {
    let score = (1 - confidence) * 20;
    if (risky) score -= 8;
    if (tabSwitches >= 3) score -= 5;
    return clamp100(score, 5);
  }

  /**
   * Partial is NOT a fixed 45 anymore.
   * Partial focus is calculated from real confidence + page risk + behavior.
   */
  let score = 30 + confidence * 30;

  if (risky) score = 8 + confidence * 22;
  if (studySignal) score += 12;
  if (typingCount >= 5) score += 8;
  if (scrollSpeed >= 900 && risky) score -= 10;
  if (tabSwitches >= 4) score -= 8;
  if (idleMs >= 90000) score -= 6;

  return clamp100(score, 25);
}

function buildStatsFromActivities(rows = []) {
  const total = rows.length;

  const study = rows.filter((x) => getAiTypeFromActivity(x) === "study").length;
  const partial = rows.filter((x) => getAiTypeFromActivity(x) === "partial").length;
  const distracted = rows.filter(
    (x) => getAiTypeFromActivity(x) === "non-study"
  ).length;

  const interventions = rows.filter((x) => x?.popup?.shouldShow).length;
  const recoveries = rows.filter(
    (x) => x?.timelineEvent === "recovered_to_study"
  ).length;

  const studyTimeMs = rows
    .filter((x) => getAiTypeFromActivity(x) === "study")
    .reduce((sum, x) => sum + getActivityDwellMs(x), 0);

  const nonStudyTimeMs = rows
    .filter((x) => getAiTypeFromActivity(x) === "non-study")
    .reduce((sum, x) => sum + getActivityDwellMs(x), 0);

  const weightedTotalMs = rows.reduce((sum, item) => {
    return sum + getActivityDwellMs(item);
  }, 0);

  const weightedFocusMs = rows.reduce((sum, item) => {
    const dwell = getActivityDwellMs(item);
    const focusValue = getActivityFocusValue(item);
    return sum + dwell * (focusValue / 100);
  }, 0);

  const focusScore =
    weightedTotalMs > 0
      ? clamp100(Math.round((weightedFocusMs / weightedTotalMs) * 100), 0)
      : 0;

  return {
    total,
    study,
    partial,
    distracted,
    nonStudy: distracted,
    interventions,
    recoveries,
    focusScore,
    studyTimeMs,
    nonStudyTimeMs,
    studyTimeText: formatMinutes(studyTimeMs),
    nonStudyTimeText: formatMinutes(nonStudyTimeMs),
  };
}

function buildGraphFromActivities(rows = []) {
  const byHour = new Map();

  rows.forEach((item) => {
    const d = new Date(item.createdAt || item.updatedAt || Date.now());
    const hour = `${String(d.getHours()).padStart(2, "0")}:00`;

    if (!byHour.has(hour)) {
      byHour.set(hour, {
        label: hour,
        study: 0,
        partial: 0,
        nonStudy: 0,
        focusScore: 0,
        weightedFocusMs: 0,
        totalMs: 0,
      });
    }

    const bucket = byHour.get(hour);
    const type = getAiTypeFromActivity(item);

    if (type === "study") bucket.study += 1;
    else if (type === "partial") bucket.partial += 1;
    else if (type === "non-study") bucket.nonStudy += 1;

    const dwell = getActivityDwellMs(item);
    const focusValue = getActivityFocusValue(item);

    bucket.totalMs += dwell;
    bucket.weightedFocusMs += dwell * (focusValue / 100);

    bucket.focusScore =
      bucket.totalMs > 0
        ? clamp100(Math.round((bucket.weightedFocusMs / bucket.totalMs) * 100), 0)
        : 0;
  });

  return Array.from(byHour.values())
    .sort((a, b) => String(a.label).localeCompare(String(b.label)))
    .map(({ weightedFocusMs, totalMs, ...item }) => item);
}

function buildTimelineItem(item = {}) {
  return {
    id: publicId(item),
    activityId: publicId(item),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    deviceId: item.deviceId || "",
    userId: item.userId || "",
    sessionId: publicId(item.sessionId) || "",
    goal: item.goal || "",
    page: item.page || {},
    behavior: item.behavior || {},
    ai: item.ai || {},
    decision: item.decision || {},
    timelineEvent: item.timelineEvent || "unknown",
    refocus: item.refocus || {},
    popup: item.popup || {},
    voiceSession: item.voiceSession || {},
    feedback: item.feedback || {},
  };
}

function buildInsightsFromRows(rows = [], stats = {}) {
  const insights = [];

  if (stats.nonStudyTimeMs > stats.studyTimeMs && stats.nonStudyTimeMs > 0) {
    insights.push({
      type: "warning",
      title: "Non-study time is higher",
      message: `You spent about ${stats.nonStudyTimeText} on non-study pages and ${stats.studyTimeText} on study pages.`,
      priority: "high",
    });
  }

  const loopCount = rows.filter(
    (x) => x.timelineEvent === "distraction_loop"
  ).length;

  if (loopCount >= 2) {
    insights.push({
      type: "pattern",
      title: "Distraction loop detected",
      message:
        "You entered repeated non-study patterns more than once. A 5-minute reset can help break the loop.",
      priority: "high",
    });
  }

  if (stats.recoveries > 0) {
    insights.push({
      type: "positive",
      title: "Good recovery",
      message: `You recovered back to study ${stats.recoveries} time(s). This is a strong habit signal.`,
      priority: "medium",
    });
  }

  if (!insights.length) {
    insights.push({
      type: "neutral",
      title: "Keep tracking",
      message:
        "Your study pattern will become clearer as more activities are saved.",
      priority: "low",
    });
  }

  return insights;
}



async function buildDashboardData(deviceId, options = {}) {
  const cleanDeviceId = cleanId(deviceId);
  const cleanUserId = cleanId(options.userId || "");
  const range = options.range || "all";
  const rangeStart = getRangeStart(range);

  const query = {
    deviceId: cleanDeviceId,
  };

  if (cleanUserId) query.userId = cleanUserId;
  if (rangeStart) query.createdAt = { $gte: rangeStart };

  const rows = await StudyActivity.find(query)
    .sort({ createdAt: -1 })
    .limit(Number(options.limit || DEFAULT_DASHBOARD_LIMIT))
    .lean();

  const currentSessionState = await getCurrentStudySession({
    deviceId: cleanDeviceId,
    userId: cleanUserId,
  }).catch(() => null);

  const currentSession =
    currentSessionState?.session || currentSessionState?.currentSession || null;

  const goalDoc = await getGoalDoc(cleanDeviceId, {
    userId: cleanUserId,
  }).catch(() => null);

  const connectedDevicesPayload = getConnectedDevices({
    deviceId: cleanDeviceId,
    userId: cleanUserId,
  });

  const connectedDevices = connectedDevicesPayload.devices || [];

  const stats = buildStatsFromActivities(rows);
  const timeline = rows.map(buildTimelineItem);
  const graph = buildGraphFromActivities(rows.slice().reverse());
  const insights = buildInsightsFromRows(rows, stats);

  const latest = rows[0] || null;

  const liveInterventionCard = latest?.popup?.shouldShow
    ? {
        popup: latest.popup,
        page: latest.page,
        activityId: publicId(latest),
        createdAt: latest.createdAt,
      }
    : null;

  const base = {
    deviceId: cleanDeviceId,
    userId: cleanUserId,
    range,

    goal: goalDoc?.goal || currentSession?.goal || "",

    monitoringActive: Boolean(currentSession),
    sessionStatus: currentSession ? "active" : "ended",
    currentSession,

    connectedDevices,
    deviceSummary: connectedDevicesPayload,

    stats,
    focusScore: stats.focusScore,
    studyCount: stats.study,
    distractionCount: stats.distracted,
    partialCount: stats.partial,
    recoveryCount: stats.recoveries,

    timeline,
    activities: timeline,
    recentActivities: timeline.slice(0, 8),

    graph,
    insights,

    currentActivity: latest ? buildTimelineItem(latest) : null,
    latestActivity: latest ? buildTimelineItem(latest) : null,

    liveInterventionCard,

    sessionAnalytics: {
      studyTimeMs: stats.studyTimeMs,
      nonStudyTimeMs: stats.nonStudyTimeMs,
      studyTimeText: stats.studyTimeText,
      nonStudyTimeText: stats.nonStudyTimeText,
      recoveries: stats.recoveries,
      interventions: stats.interventions,
    },

    updatedAt: nowIso(),
  };

  return enrichDashboardPayload({
    base,
    rows,
    stats,
    graph,
    insights,
    connectedDevices,
    currentSession,
    goalDoc,
  });
}













export async function getDashboard(deviceId, options = {}) {
  const cleanDeviceId = cleanId(deviceId);
  if (!cleanDeviceId) throw new Error("deviceId is required");

  return buildDashboardData(cleanDeviceId, options);
}

/* -------------------------------------------------------------------------- */
/* Main realtime signal processing                                             */
/* -------------------------------------------------------------------------- */

async function getRecentActivities({ deviceId, userId = "", sessionId = "", minutes = RECENT_HISTORY_MINUTES, limit = RECENT_HISTORY_LIMIT }) {
  const query = {
    deviceId: cleanId(deviceId),
    createdAt: {
      $gte: new Date(Date.now() - minutes * 60 * 1000),
    },
  };

  if (userId) query.userId = cleanId(userId);
  if (sessionId) query.sessionId = sessionId;

  return StudyActivity.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

function buildFallbackAi({ reason = "AI service unavailable." } = {}) {
  return {
    provider: "fallback",
    mode: "fallback",
    type: "partial",
    confidence: 0.35,
    reason,
    motivation:
      "I could not fully analyze this page yet. Please check if it supports your study goal.",
    voiceText:
      "I am not fully sure about this page. Please confirm if it helps your study goal.",
    reply:
      "I am not fully sure about this page. Please confirm if it helps your study goal.",
    followUpQuestion: "Is this page helping your study goal?",
    needsUserCheck: true,
    decision: "ask",
    decisionReason: reason,
    severity: "medium",
    visualAnalysis: {},
    textAnalysis: {},
    conflict: {
      exists: false,
      kind: "none",
      explanation: "",
    },
    conflictingSignals: [],
    screenshotInfluence: "none",
    explainability: {
      bullets: [reason],
      evidence: [],
      userVisibleReason: reason,
    },
    parseOk: false,
  };
}

async function processStudySignalCore(payload = {}) {
  const cleanDeviceId = cleanId(payload.deviceId);
  const cleanUserId = cleanId(payload.userId || "");

  if (!cleanDeviceId) {
    throw new Error("deviceId is required");
  }

  const page = normalizePage(payload);
  const behavior = normalizeBehavior(payload);

  if (!page.url && !page.title && !page.visibleText) {
    return {
      skipped: true,
      reason: "empty_page_signal",
      popup: {
        shouldShow: false,
        type: "none",
      },
    };
  }

  let goal = cleanText(payload.goal || "");

  if (!goal) {
    const goalDoc = await getGoalDoc(cleanDeviceId, {
      userId: cleanUserId,
    }).catch(() => null);

    goal = goalDoc?.goal || "";
  }

  if (!goal) {
    return {
      skipped: true,
      reason: "goal_required",
      monitoringActive: false,
      popup: {
        shouldShow: false,
        type: "none",
      },
    };
  }

  const session = await getOrCreateActiveSession({
    deviceId: cleanDeviceId,
    userId: cleanUserId,
    goal,
    deviceType: payload.deviceType || "extension",
    label: payload.label || "Chrome extension",
  });

  const sessionId = session?._id || payload.sessionId || null;

  const recentHistory = await getRecentActivities({
    deviceId: cleanDeviceId,
    userId: cleanUserId,
    sessionId,
  });

  const previousActivity = recentHistory[0] || null;

  const relevanceScore = computeRelevanceScore({
    goal,
    page,
  });

  const behaviorScore = computeBehaviorScore(behavior);

  const memoryScore = await getPatternMemoryScore({
    deviceId: cleanDeviceId,
    userId: cleanUserId,
    goal,
    domain: page.domain,
  });

  const conversationMemory = await getRecentConversations({
    deviceId: cleanDeviceId,
    userId: cleanUserId,
    sessionId,
    limit: 8,
  });

  let ai;

  try {
    ai = await analyzeRealtimeWithCloudGemma({
      ...payload,
      goal,
      page,
      behavior,
      relevanceScore,
      behaviorScore,
      memoryScore,
      previousState: previousActivity
        ? {
            type: getAiTypeFromActivity(previousActivity),
            domain: previousActivity.page?.domain || "",
            title: previousActivity.page?.title || "",
            timelineEvent: previousActivity.timelineEvent || "",
          }
        : null,
      conversationMemory,
    });
  } catch (error) {
    console.warn("[study.service] realtime Gemma failed:", error.message);
    ai = buildFallbackAi({
      reason: error.message || "Cloud Gemma realtime analysis failed.",
    });
  }

  ai = {
    ...ai,
    type: normalizeAiType(ai.type),
    confidence: clamp01(ai.confidence, 0.35),
  };

  const fusion = fuseDecision({
    ai,
    relevanceScore,
    behaviorScore,
    memoryScore,
  });

  const popupDecision = buildPopupDecisionFromHistory({
    ai,
    goal,
    currentDomain: page.domain,
    previousActivity,
    recentHistory,
  });

  const motivation = buildAgenticMotivation({
    decision: popupDecision,
    ai,
    goal,
    currentDomain: page.domain,
  });

  let popup = buildPopupPayload({
    popupDecision,
    motivation,
    activity: null,
    page,
    ai,
  });

  const refocus = buildRefocusPayload({
    ai,
    goal,
    popupDecision,
    popup,
  });

  const decision = buildDecisionPayload({
    ai,
    popupDecision,
    fusion,
  });

  const explainability = buildExplainability(ai, popupDecision, fusion);

  const intervention = buildInterventionPayload({
    popupDecision,
  });

  const voiceSession = buildVoiceSessionPayload({
    popup,
    ai,
    popupDecision,
  });

  const activity = await StudyActivity.create({
    userId: cleanUserId,
    deviceId: cleanDeviceId,
    goal,
    sessionId,

    page: {
      url: page.url,
      domain: page.domain,
      title: page.title,
      topic: page.topic,
      isBlank: page.isBlank,
      isPdf: page.isPdf,
      isRestricted: page.isRestricted,
      isSpa: page.isSpa,
      hasIframes: page.hasIframes,
      textLength: page.textLength,
    },

    behavior,

    signals: {
      relevanceScore,
      behaviorScore,
      memoryScore,
      triggerReason: payload.triggerReason || popupDecision.reason || "",
      hasScreenshot: Boolean(page.hasScreenshot),
      contentQuality: page.textLength > 300 ? "rich" : "thin",
      edgeCase: page.isRestricted
        ? "restricted"
        : page.isPdf
        ? "pdf"
        : page.isBlank
        ? "blank"
        : "",
    },

    ai: {
      type: ai.type,
      confidence: ai.confidence,
      reason: ai.reason || "",
      motivation: motivation.message || ai.motivation || "",
      voiceText: motivation.voiceText || ai.voiceText || "",
      needsUserCheck: Boolean(ai.needsUserCheck),
      reflection: ai.reflection || "",
      visualAnalysis: ai.visualAnalysis || {},
      textAnalysis: ai.textAnalysis || {},
      conflict: ai.conflict || {},
      conflictingSignals: ai.conflictingSignals || [],
      screenshotInfluence: ai.screenshotInfluence || "none",
    },

    decision,
    explainability,
    intervention,
    timelineEvent: popupDecision.timelineEvent || aiTypeToTimeline(ai.type),
    refocus,
    popup,
    voiceSession,

    feedback: {
      userAnswer: "",
      voiceAnswer: "",
      correctedType: "",
      reason: "",
    },
  });

  popup = {
    ...popup,
    activityId: publicId(activity),
  };

  const coachMessage = buildCoachMessage({
    popup,
    activity,
    ai,
    goal,
  });

  if (coachMessage) {
    await saveCoachMessageToHistory({
      deviceId: cleanDeviceId,
      userId: cleanUserId,
      sessionId,
      activityId: activity._id,
      goal,
      coachMessage: {
        ...coachMessage,
        aiType: ai.type,
      },
    });
  }

  /**
   * Update activity after _id exists so popup has activityId.
   */
  try {
    await StudyActivity.findByIdAndUpdate(activity._id, {
      $set: {
        popup,
        "ai.motivation": popup.message || ai.motivation || "",
        "ai.voiceText": popup.voiceText || ai.voiceText || "",
      },
    });
    activity.popup = popup;
    activity.ai.motivation = popup.message || activity.ai.motivation;
    activity.ai.voiceText = popup.voiceText || activity.ai.voiceText;
  } catch (error) {
    console.warn("[study.service] post activity popup update failed:", error.message);
  }

  await incrementSessionTotals({
    sessionId,
    aiType: ai.type,
    popupShown: Boolean(popup.shouldShow),
  });

  await updatePatternMemory({
    deviceId: cleanDeviceId,
    userId: cleanUserId,
    goal,
    domain: page.domain,
    aiType: ai.type,
  });

  const dashboard = await buildDashboardData(cleanDeviceId, {
    userId: cleanUserId,
    limit: DEFAULT_DASHBOARD_LIMIT,
  }).catch((error) => {
    console.warn("[study.service] dashboard after signal failed:", error.message);
    return null;
  });

  await emitRealtimeBundle({
    deviceId: cleanDeviceId,
    userId: cleanUserId,
    activity,
    dashboard,
    popup,
    coachMessage,
  });

  /**
   * Deep analysis is non-blocking and guarded.
   * It runs only when the realtime result is uncertain/risky or screenshot evidence exists.
   */
  if (shouldRunDeepAnalysis({ ai, popupDecision, page, behavior })) {
    runDeepAnalysisInBackground({
      activityId: activity._id,
      payload,
      goal,
      page,
      behavior,
      previousActivity,
      recentHistory,
      conversationMemory,
    });
  }

  return {
    activity: buildPublicActivity(activity),
    popup,
    coachMessage,
    dashboard,
    ai,
    decision,
    refocus,
    timelineEvent: activity.timelineEvent,
    skipped: false,
  };
}


function shouldRunDeepAnalysis({ ai = {}, popupDecision = {}, page = {}, behavior = {} } = {}) {
  return Boolean(
    normalizeAiType(ai.type) === "partial" ||
      ai.needsUserCheck === true ||
      ["ask", "intervene", "refocus"].includes(popupDecision.action) ||
      popupDecision.shouldShow === true ||
      page.hasScreenshot === true ||
      page.screenshotBase64 ||
      safeNumber(behavior.tabSwitches, 0) > 0
  );
}

export async function processStudySignal(payload = {}) {
  const cleanDeviceId = cleanId(payload.deviceId);
  if (!cleanDeviceId) {
    throw new Error("deviceId is required");
  }

  const lockKey = `${cleanDeviceId}:${cleanId(payload.userId || "anon")}`;

  if (activeAiRequests.has(lockKey)) {
    return activeAiRequests.get(lockKey);
  }

  const job = processStudySignalCore(payload);
  activeAiRequests.set(lockKey, job);

  try {
    return await job;
  } finally {
    activeAiRequests.delete(lockKey);
  }
}

async function runDeepAnalysisInBackground({
  activityId,
  payload,
  goal,
  page,
  behavior,
  previousActivity,
  recentHistory,
  conversationMemory,
}) {
  const deepKey = String(activityId || "");
  if (!deepKey || activeDeepAnalysis.has(deepKey)) return;
  activeDeepAnalysis.add(deepKey);

  setTimeout(async () => {
    try {
      const deep = await analyzeDeepWithCloudGemma({
        ...payload,
        goal,
        page,
        behavior,
        previousState: previousActivity
          ? {
              type: getAiTypeFromActivity(previousActivity),
              domain: previousActivity.page?.domain || "",
              title: previousActivity.page?.title || "",
              timelineEvent: previousActivity.timelineEvent || "",
            }
          : null,
        recentHistory: recentHistory.slice(0, 10),
        conversationMemory,
      });

      await StudyActivity.findByIdAndUpdate(activityId, {
        $set: {
          "ai.visualAnalysis": deep.visualAnalysis || {},
          "ai.textAnalysis": deep.textAnalysis || {},
          "ai.conflict": deep.conflict || {},
          "ai.conflictingSignals": deep.conflictingSignals || [],
          "ai.screenshotInfluence": deep.screenshotInfluence || "none",
          "ai.reflection": deep.reflection || "",
          explainability: deep.explainability || {},
        },
      });
    } catch (error) {
      console.warn("[study.service] deep analysis failed:", error.message);
    } finally {
      activeDeepAnalysis.delete(deepKey);
    }
  }, 0);
}

/* -------------------------------------------------------------------------- */
/* Batch signal processing                                                     */
/* -------------------------------------------------------------------------- */

export async function processStudySignalBatch(payload = {}) {
  const signals = safeArray(payload.signals);

  if (!signals.length) {
    return {
      processed: 0,
      results: [],
      popup: {
        shouldShow: false,
        type: "none",
      },
    };
  }

  const results = [];

  for (const signal of signals) {
    try {
      const result = await processStudySignal({
        ...signal,
        deviceId: signal.deviceId || payload.deviceId,
        userId: signal.userId || payload.userId || "",
        goal: signal.goal || payload.goal || "",
        source: signal.source || payload.source || "chrome-extension-batch",
        deviceType: signal.deviceType || payload.deviceType || "extension",
        label: signal.label || payload.label || "Chrome extension",
      });

      results.push({
        ok: true,
        ...result,
      });
    } catch (error) {
      results.push({
        ok: false,
        message: error.message,
      });
    }
  }

  const latestPopup = [...results]
    .reverse()
    .find((item) => item?.popup?.shouldShow)?.popup || {
    shouldShow: false,
    type: "none",
  };

  const latestCoachMessage =
    [...results].reverse().find((item) => item?.coachMessage)?.coachMessage ||
    null;

  return {
    processed: results.length,
    results,
    popup: latestPopup,
    coachMessage: latestCoachMessage,
    latest: results[results.length - 1] || null,
  };
}

/* -------------------------------------------------------------------------- */
/* Timeline / history                                                          */
/* -------------------------------------------------------------------------- */

export async function getTimeline(deviceId, options = {}) {
  const cleanDeviceId = cleanId(deviceId);
  const cleanUserId = cleanId(options.userId || "");
  const limit = Math.min(Number(options.limit || 80), 200);
  const range = options.range || "all";
  const rangeStart = getRangeStart(range);

  if (!cleanDeviceId) {
    throw new Error("deviceId is required");
  }

  const query = {
    deviceId: cleanDeviceId,
  };

  if (cleanUserId) query.userId = cleanUserId;
  if (options.sessionId) query.sessionId = options.sessionId;
  if (rangeStart) query.createdAt = { $gte: rangeStart };

  const rows = await StudyActivity.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return {
    deviceId: cleanDeviceId,
    userId: cleanUserId,
    range,
    count: rows.length,
    items: rows.map(buildTimelineItem),
    timeline: rows.map(buildTimelineItem),
    updatedAt: nowIso(),
  };
}

export async function getInsights(deviceId, options = {}) {
  const cleanDeviceId = cleanId(deviceId);
  const cleanUserId = cleanId(options.userId || "");
  const range = options.range || "week";
  const rangeStart = getRangeStart(range);

  if (!cleanDeviceId) {
    throw new Error("deviceId is required");
  }

  const query = {
    deviceId: cleanDeviceId,
  };

  if (cleanUserId) query.userId = cleanUserId;
  if (rangeStart) query.createdAt = { $gte: rangeStart };

  const rows = await StudyActivity.find(query)
    .sort({ createdAt: -1 })
    .limit(300)
    .lean();

  const stats = buildStatsFromActivities(rows);
  const graph = buildGraphFromActivities(rows.slice().reverse());
  const insights = buildInsightsFromRows(rows, stats);

  const domainMap = new Map();

  rows.forEach((item) => {
    const domain = item?.page?.domain || "unknown";
    const type = getAiTypeFromActivity(item);

    if (!domainMap.has(domain)) {
      domainMap.set(domain, {
        domain,
        total: 0,
        study: 0,
        partial: 0,
        nonStudy: 0,
      });
    }

    const bucket = domainMap.get(domain);
    bucket.total += 1;
    if (type === "study") bucket.study += 1;
    if (type === "partial") bucket.partial += 1;
    if (type === "non-study") bucket.nonStudy += 1;
  });

  const domains = Array.from(domainMap.values()).sort((a, b) => {
    return b.nonStudy - a.nonStudy || b.total - a.total;
  });

  return {
    deviceId: cleanDeviceId,
    userId: cleanUserId,
    range,
    stats,
    graph,
    insights,
    domains,
    updatedAt: nowIso(),
  };
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

export async function getStudySessions(deviceId, options = {}) {
  const cleanDeviceId = cleanId(deviceId);
  const cleanUserId = cleanId(options.userId || "");
  const limit = Math.min(Number(options.limit || 30), 100);

  if (!cleanDeviceId) {
    throw new Error("deviceId is required");
  }

  const query = {
    deviceId: cleanDeviceId,
  };

  if (cleanUserId) query.userId = cleanUserId;

  const sessions = await StudySession.find(query)
    .sort({ startedAt: -1, createdAt: -1 })
    .limit(limit)
    .lean();

  return {
    deviceId: cleanDeviceId,
    userId: cleanUserId,
    sessions,
    count: sessions.length,
  };
}

export async function getConnectedStudyDevices({ deviceId = "", userId = "" } = {}) {
  const cleanDeviceId = cleanId(deviceId);
  const cleanUserId = cleanId(userId);

  const connected = getConnectedDevices({
    deviceId: cleanDeviceId,
    userId: cleanUserId,
  });

  let savedDevices = [];

  try {
    const query = {};

    if (cleanUserId) query.userId = cleanUserId;
    if (cleanDeviceId && !cleanUserId) query.deviceId = cleanDeviceId;

    savedDevices = await UserDeviceLink.find(query)
      .sort({ lastSeenAt: -1 })
      .limit(50)
      .lean();
  } catch {}

  const socketDevices = connected.devices || [];

  const merged = new Map();

  savedDevices.forEach((device) => {
    const key = `${device.deviceId || ""}-${device.deviceType || ""}`;
    merged.set(key, {
      ...device,
      online: false,
      source: "saved",
    });
  });

  socketDevices.forEach((device) => {
    const key = `${device.deviceId || ""}-${device.deviceType || ""}`;
    merged.set(key, {
      ...merged.get(key),
      ...device,
      online: true,
      source: "socket",
    });
  });

  return {
    devices: Array.from(merged.values()),
    onlineCount: socketDevices.length,
    totalCount: merged.size,
  };
}

/* -------------------------------------------------------------------------- */
/* Conversations / AI coach chat                                               */
/* -------------------------------------------------------------------------- */

function normalizeConversationTurn(turn = {}) {
  return {
    role: turn.role || "assistant",
    text: turn.text || "",
    source: turn.source || "system",
    stage: turn.stage || 0,
    activityId: turn.activityId ? String(turn.activityId) : "",
    metadata: turn.metadata || {},
    at: turn.at || turn.createdAt || null,
  };
}

export async function getStudyConversations(deviceId, options = {}) {
  const cleanDeviceId = cleanId(deviceId);
  const cleanUserId = cleanId(options.userId || "");
  const limit = Math.min(Number(options.limit || 20), 100);

  if (!cleanDeviceId) {
    throw new Error("deviceId is required");
  }

  const query = {
    deviceId: cleanDeviceId,
  };

  if (cleanUserId) query.userId = cleanUserId;
  if (options.sessionId) query.sessionId = options.sessionId;
  if (options.activityId) query.activityId = options.activityId;

  const conversations = await StudyConversation.find(query)
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(limit)
    .lean();

  const messages = conversations.flatMap((conversation) => {
    return safeArray(conversation.turns).map((turn) => ({
      conversationId: publicId(conversation),
      sessionId: conversation.sessionId ? String(conversation.sessionId) : "",
      goal: conversation.goal || "",
      lastAiType: conversation.lastAiType || "",
      ...normalizeConversationTurn(turn),
    }));
  });

  messages.sort((a, b) => {
    return new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime();
  });

  return {
    deviceId: cleanDeviceId,
    userId: cleanUserId,
    conversations,
    messages,
    count: conversations.length,
    updatedAt: nowIso(),
  };
}

/* -------------------------------------------------------------------------- */
/* Feedback                                                                    */
/* -------------------------------------------------------------------------- */

export async function submitUserFeedback(payload = {}) {
  const cleanDeviceId = cleanId(payload.deviceId);
  const cleanUserId = cleanId(payload.userId || "");
  const activityId = cleanId(payload.activityId);

  if (!cleanDeviceId) {
    throw new Error("deviceId is required");
  }

  const correctedType = normalizeAiType(
    payload.correctedType || payload.userAnswer || payload.answer || ""
  );

  const feedbackValue =
    correctedType === "study" ||
    correctedType === "partial" ||
    correctedType === "non-study"
      ? correctedType
      : cleanText(payload.userAnswer || payload.answer || "");

  const activity = await StudyActivity.findOneAndUpdate(
    {
      _id: activityId,
      deviceId: cleanDeviceId,
    },
    {
      $set: {
        "feedback.userAnswer": feedbackValue,
        "feedback.voiceAnswer": payload.voiceAnswer || "",
        "feedback.correctedType": correctedType === "unknown" ? "" : correctedType,
        "feedback.reason": payload.reason || "",
        "feedback.at": now(),
        timelineEvent: "feedback_saved",
      },
    },
    {
      new: true,
    }
  );

  if (!activity) {
    throw new Error("Activity not found");
  }

  await updatePatternMemory({
    deviceId: cleanDeviceId,
    userId: cleanUserId || activity.userId || "",
    goal: activity.goal || "",
    domain: activity.page?.domain || "",
    aiType: correctedType === "unknown" ? activity.ai?.type : correctedType,
    feedback: "correct",
  });

  const publicActivity = buildPublicActivity(activity);

  await emitSafely(cleanDeviceId, "study:feedback-updated", {
    deviceId: cleanDeviceId,
    userId: cleanUserId || activity.userId || "",
    activity: publicActivity,
    feedback: activity.feedback,
  });

  return {
    activity: publicActivity,
    feedback: activity.feedback,
  };
}

export async function markPopupIgnored(payload = {}) {
  const cleanDeviceId = cleanId(payload.deviceId);
  const cleanUserId = cleanId(payload.userId || "");
  const activityId = cleanId(payload.activityId);

  if (!cleanDeviceId) {
    throw new Error("deviceId is required");
  }

  const activity = await StudyActivity.findOneAndUpdate(
    {
      _id: activityId,
      deviceId: cleanDeviceId,
    },
    {
      $inc: {
        "intervention.ignoredCount": 1,
      },
      $set: {
        "intervention.lastIgnoredAt": now(),
      },
    },
    {
      new: true,
    }
  );

  if (!activity) {
    throw new Error("Activity not found");
  }

  const publicActivity = buildPublicActivity(activity);

  await emitSafely(cleanDeviceId, "study:intervention-ignored", {
    deviceId: cleanDeviceId,
    userId: cleanUserId || activity.userId || "",
    activity: publicActivity,
    activityId,
    at: nowIso(),
  });

  return {
    activity: publicActivity,
  };
}

/* -------------------------------------------------------------------------- */
/* Voice reply / agentic AI chat                                               */
/* -------------------------------------------------------------------------- */

export async function processVoiceReply(payload = {}) {
  const cleanDeviceId = cleanId(payload.deviceId);
  const cleanUserId = cleanId(payload.userId || "");
  const activityId = cleanId(payload.activityId);

  if (!cleanDeviceId) {
    throw new Error("deviceId is required");
  }

  const userMessage = cleanText(
    payload.message || payload.voiceAnswer || payload.userAnswer || ""
  );

  if (!userMessage) {
    throw new Error("message is required");
  }

  const activityQuery = activityId
    ? { _id: activityId, deviceId: cleanDeviceId }
    : { deviceId: cleanDeviceId };

  if (!activityId && cleanUserId) activityQuery.userId = cleanUserId;

  const activity = await StudyActivity.findOne(activityQuery).sort({ createdAt: -1 });

  if (!activity) {
    const goalDoc = await getGoalDoc(cleanDeviceId, { userId: cleanUserId }).catch(() => null);
    const session = await getOrCreateActiveSession({
      deviceId: cleanDeviceId,
      userId: cleanUserId,
      goal: goalDoc?.goal || payload.goal || "General study focus",
      deviceType: payload.deviceType || "extension",
      label: payload.label || "Chrome extension",
    });

    const nowDate = now();
    const synthetic = await StudyActivity.create({
      deviceId: cleanDeviceId,
      userId: cleanUserId,
      sessionId: session?._id || null,
      goal: goalDoc?.goal || payload.goal || "General study focus",
      source: payload.source || "voice-coach",
      deviceType: payload.deviceType || "extension",
      page: {
        url: payload.page?.url || "",
        domain: payload.page?.domain || "voice-coach",
        title: payload.page?.title || "Voice AI Coach",
      },
      behavior: {},
      ai: {
        type: "partial",
        confidence: 0.4,
        reason: "Voice conversation started without an existing page activity.",
        voiceText: "Tell me what you need help with for your study goal.",
      },
      decision: { finalType: "partial", finalConfidence: 40 },
      popup: { shouldShow: false, type: "voice" },
      timelineEvent: "voice_conversation",
      createdAt: nowDate,
      updatedAt: nowDate,
    });

    return processVoiceReply({ ...payload, activityId: publicId(synthetic) });
  }

  const sessionId = activity.sessionId || null;

  const conversations = await getRecentConversations({
    deviceId: cleanDeviceId,
    userId: cleanUserId || activity.userId || "",
    sessionId,
    limit: 8,
  });

  let aiReply;

  try {
    aiReply = await analyzeVoiceReplyWithAgenticGemma({
      deviceId: cleanDeviceId,
      userId: cleanUserId || activity.userId || "",
      goal: activity.goal || "",
      activity: buildPublicActivity(activity),
      page: activity.page || {},
      behavior: activity.behavior || {},
      previousAi: activity.ai || {},
      previousDecision: activity.decision || {},
      userMessage,
      message: userMessage,
      conversationStage: safeNumber(activity.voiceSession?.stage || 1, 1),
      conversationMemory: conversations,
      screenshotBase64: payload.screenshotBase64 || "",
    });
  } catch (error) {
    console.warn("[study.service] voice Gemma failed:", error.message);

    aiReply = {
      type: "partial",
      correctedType: "partial",
      confidence: 0.35,
      decision: "ask",
      reason: error.message || "Voice AI failed",
      reply:
        "I understand. Please tell me if this page is helping your study goal or distracting you.",
      voiceText:
        "I understand. Is this page helping your study goal or distracting you?",
      shouldContinueConversation: true,
      finalDecisionMade: false,
      conversationStage: safeNumber(activity.voiceSession?.stage || 1, 1) + 1,
      stopReason: "Fallback voice response",
      memoryNote: "Voice fallback used.",
    };
  }

  const nextStage = safeNumber(aiReply.conversationStage || 1, 1);

  activity.voiceSession = {
    ...(activity.voiceSession || {}),
    status: aiReply.shouldContinueConversation ? "asking" : "completed",
    stage: nextStage,
    shouldContinueConversation: Boolean(aiReply.shouldContinueConversation),
    finalDecisionMade: Boolean(aiReply.finalDecisionMade),
    stopReason: aiReply.stopReason || "",
    turns: [
      ...safeArray(activity.voiceSession?.turns),
      {
        role: "user",
        text: userMessage,
        stage: nextStage,
        at: now(),
      },
      {
        role: "assistant",
        text: aiReply.voiceText || aiReply.reply || "",
        stage: nextStage,
        at: now(),
      },
    ],
  };

  activity.feedback = {
    ...(activity.feedback || {}),
    voiceAnswer: userMessage,
    correctedType: aiReply.correctedType || aiReply.type || "",
    reason: aiReply.reason || "",
    at: now(),
  };

  if (aiReply.finalDecisionMade && aiReply.correctedType) {
    activity.ai.type = normalizeAiType(aiReply.correctedType);
    activity.ai.confidence = clamp01(aiReply.confidence, activity.ai.confidence || 0.5);
    activity.ai.reason = aiReply.reason || activity.ai.reason;
    activity.ai.voiceText = aiReply.voiceText || activity.ai.voiceText;
    activity.ai.motivation = aiReply.reply || activity.ai.motivation;
  }

  activity.timelineEvent = "voice_conversation";

  await activity.save();

  const coachMessage = {
    id: publicId(activity),
    activityId: publicId(activity),
    role: "assistant",
    type: "voice-reply",
    title: "AI Coach",
    text: aiReply.reply || aiReply.voiceText || "",
    voiceText: aiReply.voiceText || aiReply.reply || "",
    suggestedAction: aiReply.followUpQuestion || "",
    historyInsight: aiReply.memoryNote || "",
    priority: aiReply.decision === "refocus" ? "high" : "medium",
    pattern: activity.decision?.pattern || "",
    goal: activity.goal || "",
    aiType: aiReply.correctedType || aiReply.type || "",
    createdAt: nowIso(),
  };

  await saveCoachMessageToHistory({
    deviceId: cleanDeviceId,
    userId: cleanUserId || activity.userId || "",
    sessionId,
    activityId: activity._id,
    goal: activity.goal || "",
    coachMessage,
  });

  const publicActivity = buildPublicActivity(activity);

  await emitSafely(cleanDeviceId, "study:voice-updated", {
    deviceId: cleanDeviceId,
    userId: cleanUserId || activity.userId || "",
    activity: publicActivity,
    voice: activity.voiceSession,
    coachMessage,
    at: nowIso(),
  });

  await emitSafely(cleanDeviceId, "study:coach-message", {
    deviceId: cleanDeviceId,
    userId: cleanUserId || activity.userId || "",
    activityId: publicId(activity),
    coachMessage,
    at: nowIso(),
  });

  return {
    activity: publicActivity,
    voice: activity.voiceSession,
    coachMessage,
    ai: aiReply,
  };
}

/* -------------------------------------------------------------------------- */
/* Legacy aliases used by controllers                                          */
/* -------------------------------------------------------------------------- */

export async function getStudyDashboard(deviceId, options = {}) {
  return getDashboard(deviceId, options);
}

export async function getStudyTimeline(deviceId, options = {}) {
  return getTimeline(deviceId, options);
}

export async function getStudyInsights(deviceId, options = {}) {
  return getInsights(deviceId, options);
}

export async function handleStudySignal(payload = {}) {
  return processStudySignal(payload);
}

export async function handleStudySignalBatch(payload = {}) {
  return processStudySignalBatch(payload);
}

export async function saveStudyFeedback(payload = {}) {
  return submitUserFeedback(payload);
}

export async function handlePopupIgnored(payload = {}) {
  return markPopupIgnored(payload);
}

export async function handleVoiceReply(payload = {}) {
  return processVoiceReply(payload);
}

/* -------------------------------------------------------------------------- */
/* Default export                                                              */
/* -------------------------------------------------------------------------- */

export default {
  upsertStudyGoal,
  setStudyGoal,
  getStudyGoal,
  startStudySession,
  endStudySession,
  getCurrentStudySession,

  processStudySignal,
  processStudySignalBatch,
  handleStudySignal,
  handleStudySignalBatch,

  getDashboard,
  getStudyDashboard,
  getTimeline,
  getStudyTimeline,
  getInsights,
  getStudyInsights,
  getStudySessions,
  getConnectedStudyDevices,
  getStudyConversations,

  submitUserFeedback,
  saveStudyFeedback,
  markPopupIgnored,
  handlePopupIgnored,

  processVoiceReply,
  handleVoiceReply,
};