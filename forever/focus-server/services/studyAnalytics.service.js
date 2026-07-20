import StudyActivity from "../models/StudyActivity.js";

/**
 * File purpose:
 * Builds dashboard data for mobile/web.
 *
 * Preserves old frontend compatibility:
 * - returns stats.focusScore
 * - returns stats.study
 * - returns stats.distracted
 * - returns timeline
 *
 * Completes missing Feature 1 parts:
 * - live graph data
 * - timeline visualization
 * - session analytics
 * - explainability for Trust UI
 */
function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function normalizeDeviceArgs(deviceIdOrArgs, options = {}) {
  if (deviceIdOrArgs && typeof deviceIdOrArgs === "object") {
    return {
      deviceId: String(deviceIdOrArgs.deviceId || "").trim(),
      options: {
        ...deviceIdOrArgs,
        ...options,
        userId: String(options.userId || deviceIdOrArgs.userId || "").trim(),
      },
    };
  }

  return {
    deviceId: String(deviceIdOrArgs || "").trim(),
    options: {
      ...options,
      userId: String(options.userId || "").trim(),
    },
  };
}

function buildQuery(deviceId, userId = "") {
  if (!deviceId && !userId) return {};

  if (userId && deviceId) {
    return { $or: [{ userId }, { deviceId }] };
  }

  if (userId) return { userId };
  return { deviceId };
}

function minutes(ms = 0) {
  return Math.round(Number(ms || 0) / 60000);
}

function typeScore(type) {
  if (type === "study") return 100;
  if (type === "partial") return 55;
  if (type === "non-study") return 10;
  return 35;
}

function timelineItem(item) {
  return {
    _id: item._id,
    at: item.createdAt,

    title: item.page?.title || item.page?.domain || "Untitled page",
    url: item.page?.url,
    domain: item.page?.domain,

    type: item.ai?.type || "unknown",
    confidence: item.ai?.confidence || 0,

    decision: item.decision?.action,
    severity: item.decision?.severity,

    reason: item.ai?.reason,
    visual: item.ai?.visualAnalysis,
    conflict: item.ai?.conflict,
    explainability: item.explainability,
    behavior: item.behavior,
  };
}

export async function buildDashboard(deviceIdOrArgs, rawOptions = {}) {
  const { deviceId, options } = normalizeDeviceArgs(deviceIdOrArgs, rawOptions);
  const userId = options.userId || "";

  const query = buildQuery(deviceId, userId);

  const items = await StudyActivity.find({
    ...query,
    createdAt: { $gte: todayStart() },
  })
    .sort({ createdAt: -1 })
    .limit(150)
    .lean();

  const study = items.filter((i) => i.ai?.type === "study").length;
  const partial = items.filter((i) => i.ai?.type === "partial").length;
  const nonStudy = items.filter((i) => i.ai?.type === "non-study").length;

  const total = Math.max(items.length, 1);

  const focusScore = Math.round(((study + partial * 0.5) / total) * 100);

  const studyMs = items.reduce((sum, item) => {
    return ["study", "partial"].includes(item.ai?.type)
      ? sum + Number(item.behavior?.dwellMs || 0)
      : sum;
  }, 0);

  const distractedMs = items.reduce((sum, item) => {
    return item.ai?.type === "non-study"
      ? sum + Number(item.behavior?.dwellMs || 0)
      : sum;
  }, 0);

  const oldest = items[items.length - 1];
  const newest = items[0];

  const sessionMinutes =
    oldest && newest
      ? Math.max(
          1,
          minutes(new Date(newest.createdAt) - new Date(oldest.createdAt))
        )
      : 0;

  const graph = items
    .slice()
    .reverse()
    .map((item, index) => ({
      index,
      at: item.createdAt,
      label: new Date(item.createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      score: typeScore(item.ai?.type),
      type: item.ai?.type || "unknown",
      domain: item.page?.domain || "",
      confidence: Math.round(Number(item.ai?.confidence || 0) * 100),
    }));

  const timeline = items.slice(0, 30).map(timelineItem);

  const liveInterventionCard =
    items.find((i) =>
      ["ask", "intervene", "refocus"].includes(i.decision?.action)
    ) || null;

  const insights = [];

  if (focusScore >= 80) {
    insights.push("Excellent focus today. Keep this rhythm.");
  } else if (focusScore >= 50) {
    insights.push("Good progress, but some distractions reduced your flow.");
  } else {
    insights.push("Focus is low today. Try one short focused session now.");
  }

  if (nonStudy > 0) {
    insights.push(`You had ${nonStudy} likely distraction moments today.`);
  }

  const conflictCount = items.filter((i) => i.ai?.conflict?.exists).length;

  if (conflictCount > 0) {
    insights.push(
      `${conflictCount} activities had text-vs-screenshot or behavior conflict.`
    );
  }

  return {
    focusScore,
    studyCount: study,
    partialCount: partial,
    distractionCount: nonStudy,

    studyTimeMinutes: minutes(studyMs),
    distractedMinutes: minutes(distractedMs),
    sessions: items.length,

    sessionAnalytics: {
      totalActivities: items.length,
      sessionMinutes,
      studyMinutes: minutes(studyMs),
      distractedMinutes: minutes(distractedMs),
      conflicts: conflictCount,
      interventions: items.filter((i) =>
        ["ask", "intervene", "refocus"].includes(i.decision?.action)
      ).length,
    },

    graph,
    timeline,
    insights,
    liveInterventionCard,
    recent: items.slice(0, 10),

    // Old mobile screen compatibility.
    stats: {
      focusScore,
      study,
      partial,
      distracted: nonStudy,
      studyTimeMinutes: minutes(studyMs),
      sessions: items.length,
      insights,
    },
  };
}

export async function buildTimeline(deviceIdOrArgs, rawOptions = {}) {
  const { deviceId, options } = normalizeDeviceArgs(deviceIdOrArgs, rawOptions);
  const userId = options.userId || "";
  const limit = Number.isFinite(Number(options.limit))
    ? Math.max(1, Math.min(200, Number(options.limit)))
    : 80;

  const query = buildQuery(deviceId, userId);

  const items = await StudyActivity.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return items.map(timelineItem);
}

export async function buildInsights(deviceIdOrArgs, rawOptions = {}) {
  const dashboard = await buildDashboard(deviceIdOrArgs, rawOptions);

  return {
    focusScore: dashboard.focusScore,
    insights: dashboard.insights,
    sessionAnalytics: dashboard.sessionAnalytics,
  };
}