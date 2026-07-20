// server/services/study.dynamicPayload.service.js

/**
 * Dynamic dashboard payload builder.
 *
 * Fixes:
 * - No hardcoded partial = 45%.
 * - No static cards.
 * - Removes raw JSON from hero/subtitle/reason/motivation.
 * - Uses backend stats/graph produced from real StudyActivity records.
 * - Keeps existing frontend-friendly shapes:
 *   smartSuggestions, focusTips, coachMotivation, liveActivity,
 *   domainPatterns, momentum, charts, hero, emptyStates, premiumCards.
 */

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampPercent(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function publicId(item) {
  return String(item?._id || item?.id || item?.activityId || "");
}

function looksLikeRawJson(value = "") {
  const text = cleanText(value);

  return (
    text.startsWith("{") ||
    text.startsWith("[") ||
    text.includes('"type"') ||
    text.includes('"confidence"') ||
    text.includes('"voiceText"') ||
    text.includes('"decision"') ||
    text.includes('"motivation"')
  );
}

function cleanUserText(value = "", fallback = "") {
  const text = cleanText(value);
  if (!text) return fallback;
  if (looksLikeRawJson(text)) return fallback;
  return text;
}

function getAiType(item = {}) {
  const raw = cleanText(
    item?.ai?.type ||
      item?.decision?.finalType ||
      item?.decision?.type ||
      item?.type ||
      item?.computed?.decision ||
      item?.timelineEvent ||
      ""
  ).toLowerCase();

  if (raw === "study") return "study";
  if (raw === "partial") return "partial";

  if (
    raw === "non-study" ||
    raw === "non_study" ||
    raw === "nonstudy" ||
    raw.includes("non")
  ) {
    return "non-study";
  }

  if (raw.includes("study") && !raw.includes("non")) return "study";

  if (
    raw.includes("partial") ||
    raw.includes("confirm") ||
    raw.includes("check") ||
    raw.includes("needs") ||
    raw.includes("ask")
  ) {
    return "partial";
  }

  return "unknown";
}

function getDomain(item = {}) {
  return cleanText(item?.page?.domain || item?.domain || "");
}

function getTitle(item = {}) {
  return cleanUserText(
    item?.page?.title ||
      item?.title ||
      item?.ai?.topic ||
      item?.topic ||
      getDomain(item) ||
      "",
    getDomain(item) || "Study activity"
  );
}

function getReason(item = {}) {
  return cleanUserText(
    item?.ai?.reason ||
      item?.decision?.reason ||
      item?.popup?.reason ||
      item?.ai?.decisionReason ||
      item?.reason ||
      "",
    "AI is checking this page against your study goal."
  );
}

function getMotivation(item = {}) {
  return cleanUserText(
    item?.popup?.message ||
      item?.popup?.chatMessage ||
      item?.ai?.motivation ||
      item?.ai?.voiceText ||
      item?.ai?.reply ||
      "",
    ""
  );
}

function getCreatedAt(item = {}) {
  return item?.createdAt || item?.updatedAt || item?.timestamp || item?.at || null;
}

function formatMinutes(ms = 0) {
  const mins = Math.round(Math.max(0, safeNumber(ms, 0)) / 60000);

  if (mins <= 0) return "0m";
  if (mins < 60) return `${mins}m`;

  const h = Math.floor(mins / 60);
  const m = mins % 60;

  return m ? `${h}h ${m}m` : `${h}h`;
}

function formatTime(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return "Recent";

  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return "";

  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
    item?.signals?.finalConfidence ??
    item?.ai?.finalConfidence ??
    item?.ai?.confidence;

  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.5;

  return n > 1 ? clampPercent(n, 50) / 100 : Math.max(0, Math.min(1, n));
}

function getActivityFocusValue(item = {}) {
  const type = getAiType(item);
  const confidence = getActivityConfidence(item);

  const relevanceScore = clampPercent(item?.signals?.relevanceScore, 50);
  const behaviorScore = clampPercent(item?.signals?.behaviorScore, 50);
  const patternScore = clampPercent(
    item?.signals?.patternScore ?? item?.signals?.memoryScore,
    50
  );

  if (type === "study") {
    return clampPercent(
      confidence * 55 +
        relevanceScore * 0.25 +
        behaviorScore * 0.15 +
        patternScore * 0.05,
      70
    );
  }

  if (type === "non-study") {
    return clampPercent(
      (1 - confidence) * 35 +
        relevanceScore * 0.25 +
        behaviorScore * 0.1 +
        patternScore * 0.05,
      0
    );
  }

  /**
   * Partial is dynamic now.
   * It depends on real AI confidence + relevance + behavior + memory.
   */
  return clampPercent(
    confidence * 35 +
      relevanceScore * 0.35 +
      behaviorScore * 0.2 +
      patternScore * 0.1,
    30
  );
}

function deriveStats(rows = [], providedStats = {}) {
  const hasProvidedFocus = Number.isFinite(Number(providedStats.focusScore));

  if (hasProvidedFocus && providedStats.__alreadyDynamic) {
    return providedStats;
  }

  const study = rows.filter((x) => getAiType(x) === "study").length;
  const partial = rows.filter((x) => getAiType(x) === "partial").length;
  const nonStudy = rows.filter((x) => getAiType(x) === "non-study").length;

  const recoveries = rows.filter((x) =>
    ["recovered_to_study", "self_recovered"].includes(x?.timelineEvent)
  ).length;

  const interventions = rows.filter((x) => x?.popup?.shouldShow).length;

  const studyTimeMs = rows
    .filter((x) => getAiType(x) === "study")
    .reduce((sum, item) => sum + getActivityDwellMs(item), 0);

  const nonStudyTimeMs = rows
    .filter((x) => getAiType(x) === "non-study")
    .reduce((sum, item) => sum + getActivityDwellMs(item), 0);

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
      ? clampPercent((weightedFocusMs / weightedTotalMs) * 100, 0)
      : clampPercent(providedStats.focusScore, 0);

  return {
    ...providedStats,
    total: safeNumber(providedStats.total, rows.length),
    study: safeNumber(providedStats.study, study),
    partial: safeNumber(providedStats.partial, partial),
    distracted: safeNumber(providedStats.distracted, nonStudy),
    nonStudy: safeNumber(providedStats.nonStudy, nonStudy),
    interventions: safeNumber(providedStats.interventions, interventions),
    recoveries: safeNumber(providedStats.recoveries, recoveries),
    studyTimeMs: safeNumber(providedStats.studyTimeMs, studyTimeMs),
    nonStudyTimeMs: safeNumber(providedStats.nonStudyTimeMs, nonStudyTimeMs),
    focusScore,
    studyTimeText: providedStats.studyTimeText || formatMinutes(studyTimeMs),
    nonStudyTimeText:
      providedStats.nonStudyTimeText || formatMinutes(nonStudyTimeMs),
    __alreadyDynamic: true,
  };
}

function domainStats(rows = []) {
  const map = new Map();

  rows.forEach((item) => {
    const domain = getDomain(item) || "unknown";
    const type = getAiType(item);

    if (!map.has(domain)) {
      map.set(domain, {
        domain,
        total: 0,
        study: 0,
        partial: 0,
        nonStudy: 0,
        latestFocusValue: 0,
        lastSeenAt: getCreatedAt(item),
        latestTitle: getTitle(item),
        latestReason: getReason(item),
      });
    }

    const bucket = map.get(domain);

    bucket.total += 1;

    if (type === "study") bucket.study += 1;
    if (type === "partial") bucket.partial += 1;
    if (type === "non-study") bucket.nonStudy += 1;

    const oldTime = new Date(bucket.lastSeenAt || 0).getTime();
    const nextTime = new Date(getCreatedAt(item) || 0).getTime();

    if (nextTime >= oldTime) {
      bucket.lastSeenAt = getCreatedAt(item);
      bucket.latestTitle = getTitle(item) || bucket.latestTitle;
      bucket.latestReason = getReason(item) || bucket.latestReason;
      bucket.latestFocusValue = getActivityFocusValue(item);
    }
  });

  return Array.from(map.values()).sort((a, b) => {
    return b.nonStudy - a.nonStudy || b.partial - a.partial || b.total - a.total;
  });
}

function buildLiveActivity(rows = []) {
  return rows.slice(0, 12).map((item, index) => {
    const type = getAiType(item);
    const focusValue = getActivityFocusValue(item);

    return {
      id: publicId(item) || `live-${index}`,
      activityId: publicId(item),
      title: getTitle(item) || getDomain(item) || "Study activity",
      domain: getDomain(item),
      reason: getReason(item),
      motivation: getMotivation(item),
      type,
      focusValue,
      status:
        type === "study"
          ? "focused"
          : type === "partial"
            ? "checking"
            : type === "non-study"
              ? "distraction"
              : "unknown",
      popupShown: Boolean(item?.popup?.shouldShow),
      createdAt: getCreatedAt(item),
      timeLabel: formatTime(getCreatedAt(item)),
      dateLabel: formatDate(getCreatedAt(item)),
      ai: item?.ai || {},
      page: item?.page || {},
      popup: item?.popup || {},
      feedback: item?.feedback || {},
    };
  });
}

function buildSmartSuggestions({ goal = "", rows = [], stats = {}, domains = [] }) {
  const suggestions = [];

  const latest = rows[0] || null;
  const latestType = getAiType(latest);
  const topDistraction = domains.find((d) => d.nonStudy > 0);
  const topPartial = domains.find((d) => d.partial > 0);

  if (!cleanText(goal)) {
    suggestions.push({
      id: "set-goal",
      title: "Set your study goal",
      subtitle:
        "Your AI coach needs your current goal before it can judge pages accurately.",
      tag: "Required",
      priority: "high",
      action: "open_settings",
      source: "backend_dynamic",
    });
  }

  if (latestType === "non-study") {
    suggestions.push({
      id: `leave-current-distraction`,
      title: `Return from ${getDomain(latest) || "this page"}`,
      subtitle:
        getReason(latest) ||
        "The latest page was detected as unrelated to your current study goal.",
      tag: "Refocus now",
      priority: "high",
      action: "start_refocus",
      source: "backend_dynamic",
      domain: getDomain(latest),
      activityId: publicId(latest),
    });
  }

  if (latestType === "partial") {
    suggestions.push({
      id: `confirm-current-page`,
      title: "Confirm this uncertain page",
      subtitle:
        "Tell the AI coach if this page is helping your goal so it can learn your pattern.",
      tag: "Teach AI",
      priority: "medium",
      action: "open_activity",
      source: "backend_dynamic",
      activityId: publicId(latest),
    });
  }

  if (topDistraction) {
    suggestions.push({
      id: `reduce-${topDistraction.domain}`,
      title: `Review ${topDistraction.domain} pattern`,
      subtitle: `${topDistraction.nonStudy} non-study signal(s) were detected from this context.`,
      tag: "Pattern",
      priority: topDistraction.nonStudy >= 3 ? "high" : "medium",
      action: "review_domain",
      source: "backend_dynamic",
      domain: topDistraction.domain,
    });
  }

  if (topPartial) {
    suggestions.push({
      id: `clarify-${topPartial.domain}`,
      title: `Clarify ${topPartial.domain}`,
      subtitle: `${topPartial.partial} uncertain signal(s) need feedback so the coach can learn.`,
      tag: "Teach AI",
      priority: "medium",
      action: "open_activity",
      source: "backend_dynamic",
      domain: topPartial.domain,
    });
  }

  if (safeNumber(stats.study, 0) > 0 && safeNumber(stats.recoveries, 0) > 0) {
    suggestions.push({
      id: "repeat-recovery-pattern",
      title: "Repeat your recovery pattern",
      subtitle: `You recovered ${stats.recoveries} time(s). Use the same behavior when distraction appears again.`,
      tag: "Working",
      priority: "medium",
      action: "view_progress",
      source: "backend_dynamic",
    });
  }

  if (!suggestions.length) {
    suggestions.push({
      id: "continue-current-focus",
      title: "Continue current focus path",
      subtitle: "Your latest activity does not show a strong distraction pattern.",
      tag: "Stable",
      priority: "low",
      action: "continue",
      source: "backend_dynamic",
    });
  }

  return suggestions.slice(0, 5);
}

function buildFocusTips({ goal = "", rows = [], stats = {}, domains = [] }) {
  const tips = [];

  const latest = rows[0] || null;
  const latestDomain = getDomain(latest);
  const topDistraction = domains.find((d) => d.nonStudy > 0);

  if (safeNumber(stats.partial, 0) > 0) {
    tips.push({
      id: "give-feedback",
      title: "Give feedback on uncertain pages",
      subtitle: `${stats.partial} page(s) need confirmation. Your answer improves future detection.`,
      source: "backend_dynamic",
    });
  }

  if (topDistraction) {
    tips.push({
      id: `watch-repeat-${topDistraction.domain}`,
      title: `Watch repeated visits to ${topDistraction.domain}`,
      subtitle: "The coach detected this as your strongest recent distraction pattern.",
      source: "backend_dynamic",
      domain: topDistraction.domain,
    });
  }

  if (latestDomain && getAiType(latest) === "study") {
    tips.push({
      id: `continue-${latestDomain}`,
      title: `Continue with ${latestDomain}`,
      subtitle: "Your latest activity looks aligned with your study direction.",
      source: "backend_dynamic",
      domain: latestDomain,
    });
  }

  if (cleanText(goal)) {
    tips.push({
      id: "goal-anchor",
      title: "Use your goal as the filter",
      subtitle: `Before opening a page, ask: does this help "${goal}" right now?`,
      source: "backend_dynamic",
    });
  }

  return tips.slice(0, 4);
}

function buildCoachMotivation({ goal = "", rows = [], stats = {} }) {
  const latest = rows[0] || null;
  const type = getAiType(latest);

  const aiText = getMotivation(latest);

  if (aiText) {
    return {
      title:
        type === "non-study"
          ? "Refocus message from AI Coach"
          : type === "partial"
            ? "AI Coach needs your confirmation"
            : "AI Coach update",
      message: aiText,
      source: "gemma_activity",
      activityId: publicId(latest),
      domain: getDomain(latest),
      type,
    };
  }

  if (safeNumber(stats.recoveries, 0) > 0) {
    return {
      title: "Recovery is progress",
      message: `You came back to study ${stats.recoveries} time(s). That recovery habit matters more than perfection.`,
      source: "backend_dynamic",
      type: "recovery",
    };
  }

  if (safeNumber(stats.distracted || stats.nonStudy, 0) > 0) {
    return {
      title: "One reset can change the session",
      message: `You have ${
        stats.distracted || stats.nonStudy
      } distraction signal(s). Close the unrelated page and return to your current goal.`,
      source: "backend_dynamic",
      type: "non-study",
    };
  }

  if (cleanText(goal)) {
    return {
      title: "Ready for your next study signal",
      message: `Your coach is ready to track pages that support: ${goal}`,
      source: "backend_dynamic",
      type: "ready",
    };
  }

  return {
    title: "Set your goal to begin",
    message: "Save a study goal so your coach can judge pages using your real intention.",
    source: "backend_dynamic",
    type: "setup",
  };
}

function buildDomainPatterns(domains = []) {
  return domains.slice(0, 8).map((domain) => {
    const riskScore = domain.total
      ? clampPercent((domain.nonStudy / domain.total) * 100)
      : 0;

    return {
      ...domain,
      riskScore,
      label:
        riskScore >= 70
          ? "High distraction"
          : riskScore >= 35
            ? "Mixed"
            : "Mostly safe",
      lastSeenLabel: formatTime(domain.lastSeenAt),
    };
  });
}

function buildProgressMomentum({ rows = [], stats = {}, graph = [] }) {
  const lastSeven = safeArray(graph).slice(-7);

  const days = lastSeven.map((item, index) => ({
    id: `momentum-${index}`,
    label: item?.label || item?.day || `${index + 1}`,
    focusScore: clampPercent(item?.focusScore ?? item?.value ?? item?.score ?? 0),
    study: safeNumber(item?.study, 0),
    partial: safeNumber(item?.partial, 0),
    nonStudy: safeNumber(item?.nonStudy, 0),
  }));

  const distractionBase = safeNumber(stats.distracted || stats.nonStudy, 0);

  const recoveryRate =
    distractionBase > 0
      ? clampPercent((safeNumber(stats.recoveries, 0) / distractionBase) * 100)
      : safeNumber(stats.recoveries, 0) > 0
        ? 100
        : 0;

  return {
    days,
    focusScore: clampPercent(stats.focusScore, 0),
    recoveryRate,
    totalSignals: rows.length,
    studySignals: safeNumber(stats.study, 0),
    partialSignals: safeNumber(stats.partial, 0),
    distractionSignals: distractionBase,
    studyTimeText: formatMinutes(stats.studyTimeMs),
    nonStudyTimeText: formatMinutes(stats.nonStudyTimeMs),
  };
}

function buildChartPayload({ graph = [], stats = {} }) {
  const line = safeArray(graph).map((item, index) => ({
    id: `line-${index}`,
    label: item?.label || item?.hour || item?.day || `${index + 1}`,
    focusScore: clampPercent(item?.focusScore ?? item?.value ?? item?.score ?? 0),
    study: safeNumber(item?.study, 0),
    partial: safeNumber(item?.partial, 0),
    nonStudy: safeNumber(item?.nonStudy, 0),
  }));

  const pie = [
    {
      name: "Study",
      value: safeNumber(stats.study, 0),
    },
    {
      name: "Partial",
      value: safeNumber(stats.partial, 0),
    },
    {
      name: "Distraction",
      value: safeNumber(stats.distracted || stats.nonStudy, 0),
    },
  ].filter((item) => item.value > 0);

  const bars = line.map((item) => ({
    label: item.label,
    value: item.study,
    study: item.study,
    partial: item.partial,
    nonStudy: item.nonStudy,
  }));

  const distractionBase = safeNumber(stats.distracted || stats.nonStudy, 0);

  return {
    line,
    pie,
    bars,
    progress: [
      {
        label: "Focus",
        value: clampPercent(stats.focusScore, 0),
      },
      {
        label: "Recovery",
        value:
          distractionBase > 0
            ? clampPercent(
                (safeNumber(stats.recoveries, 0) / Math.max(distractionBase, 1)) *
                  100
              )
            : 0,
      },
    ],
  };
}

function buildHeroState({ goal = "", rows = [], stats = {}, monitoringActive = false }) {
  const latest = rows[0] || null;
  const type = getAiType(latest);

  let title = "Ready to guard your focus";
  let subtitle = cleanText(goal)
    ? `Current goal: ${goal}`
    : "Set a study goal to activate real AI monitoring.";

  if (monitoringActive && type === "study") {
    title = "You are in focus mode";
    subtitle = getDomain(latest)
      ? `Latest focused signal from ${getDomain(latest)}`
      : subtitle;
  }

  if (monitoringActive && type === "partial") {
    title = "AI is checking this activity";
    subtitle =
      getReason(latest) ||
      "The coach needs confirmation before learning this pattern.";
  }

  if (monitoringActive && type === "non-study") {
    title = "Distraction detected";
    subtitle =
      getReason(latest) ||
      "The latest activity does not look aligned with your goal.";
  }

  return {
    title: cleanUserText(title, "AI Study Coach"),
    subtitle: cleanUserText(subtitle, "AI is checking your study activity."),
    monitoringActive: Boolean(monitoringActive),
    latestType: type,
    latestDomain: getDomain(latest),
    goal,
    focusScore: clampPercent(stats.focusScore, 0),
  };
}

function buildEmptyStates({ goal = "", rows = [], stats = {} }) {
  return {
    hasGoal: Boolean(cleanText(goal)),
    hasActivities: rows.length > 0,
    hasStudy: safeNumber(stats.study, 0) > 0,
    hasPartial: safeNumber(stats.partial, 0) > 0,
    hasDistractions: safeNumber(stats.distracted || stats.nonStudy, 0) > 0,
    activityMessage: rows.length
      ? ""
      : "No browser activity has been saved yet. Start a session from the dashboard or extension.",
    graphMessage: rows.length
      ? ""
      : "Charts will appear after the backend receives real StudyActivity records.",
    devicesMessage:
      "Connect the Chrome extension with the same device ID to enable live monitoring.",
  };
}

export function enrichDashboardPayload({
  base = {},
  rows = [],
  stats = {},
  graph = [],
  insights = [],
  connectedDevices = [],
  currentSession = null,
  goalDoc = null,
} = {}) {
  const goal = cleanText(base.goal || goalDoc?.goal || currentSession?.goal || "");
  const dynamicStats = deriveStats(rows, stats);
  const domains = domainStats(rows);
  const monitoringActive = Boolean(base.monitoringActive || currentSession);

  const smartSuggestions = buildSmartSuggestions({
    goal,
    rows,
    stats: dynamicStats,
    domains,
  });

  const focusTips = buildFocusTips({
    goal,
    rows,
    stats: dynamicStats,
    domains,
  });

  const coachMotivation = buildCoachMotivation({
    goal,
    rows,
    stats: dynamicStats,
  });

  const liveActivity = buildLiveActivity(rows);
  const domainPatterns = buildDomainPatterns(domains);

  const momentum = buildProgressMomentum({
    rows,
    stats: dynamicStats,
    graph,
  });

  const charts = buildChartPayload({
    graph,
    stats: dynamicStats,
  });

  const hero = buildHeroState({
    goal,
    rows,
    stats: dynamicStats,
    monitoringActive,
  });

  const emptyStates = buildEmptyStates({
    goal,
    rows,
    stats: dynamicStats,
  });

  const latest = rows[0] || null;

  return {
    ...base,

    goal,
    monitoringActive,
    currentSession,

    stats: {
      ...(base.stats || {}),
      ...dynamicStats,
    },

    focusScore: dynamicStats.focusScore,

    smartSuggestions,
    focusTips,
    coachMotivation,
    liveActivity,
    domainPatterns,
    momentum,
    charts,
    hero,
    emptyStates,

    latestActivity: latest
      ? {
          id: publicId(latest),
          activityId: publicId(latest),
          title: getTitle(latest),
          domain: getDomain(latest),
          reason: getReason(latest),
          motivation: getMotivation(latest),
          type: getAiType(latest),
          focusValue: getActivityFocusValue(latest),
          createdAt: getCreatedAt(latest),
          page: latest.page || {},
          ai: latest.ai || {},
          popup: latest.popup || {},
          feedback: latest.feedback || {},
        }
      : null,

    premiumCards: {
      focusScore: clampPercent(dynamicStats.focusScore, 0),
      studyTimeText: formatMinutes(dynamicStats.studyTimeMs),
      distractionCount: safeNumber(dynamicStats.distracted || dynamicStats.nonStudy, 0),
      recoveryCount: safeNumber(dynamicStats.recoveries, 0),
      partialCount: safeNumber(dynamicStats.partial, 0),
      studyCount: safeNumber(dynamicStats.study, 0),
      totalCount: safeNumber(dynamicStats.total, rows.length),
      deviceCount: safeArray(connectedDevices).length,
    },

    uiCopy: {
      dashboardStatus: monitoringActive ? "Session active" : "Session paused",
      coachStatus: latest ? "AI Coach synced" : "Waiting for browser signals",
      deviceStatus: safeArray(connectedDevices).length
        ? "Devices synced"
        : "No live extension detected",
    },
  };
}