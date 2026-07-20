// server/services/gemmaResource/liveTutor/liveTutorLessonPlanner.service.js
//
// Long-session lesson planner for Gemma Resource Live Tutor.
// This file does NOT fake boardCommands.
// It only plans/records lesson segments, cursors, stop points, completed segments,
// and next teaching position so the real engine can generate the next segment
// from RAG + Gemma.
//
// Goal:
// saved resource / uploaded PDF / saved YouTube transcript
// → teach one high-quality segment
// → remember nextCursor
// → continue segment-by-segment until DONE/user stop
// → interrupt remembers exact stop point.

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function textClean(value = "") {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{4,}/g, "\n\n")
    .trim();
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function makeCursor(prefix = "segment") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeCursor(value = "") {
  const cursor = clean(value);
  if (!cursor) return "";
  return cursor.slice(0, 600);
}

function isDoneCursor(cursor = "") {
  return normalizeCursor(cursor).toUpperCase() === "DONE";
}

function getResourceTitle(resource = {}) {
  return clean(resource.title || resource.name || resource.metadata?.title || "Saved Resource");
}

function getResourceSummary(resource = {}) {
  return textClean(
    resource.summary ||
      resource.description ||
      resource.metadata?.summary ||
      resource.rawAiPlan?.summary ||
      ""
  ).slice(0, 1800);
}

function getResourceSourceType(resource = {}) {
  return clean(resource.sourceType || resource.type || resource.metadata?.sourceType || "saved_resource");
}

function getChunkText(chunk = {}) {
  return textClean(
    chunk.text ||
      chunk.content ||
      chunk.cleanedText ||
      chunk.pageText ||
      chunk.transcript ||
      chunk.snippet ||
      chunk.summary ||
      ""
  );
}

function getChunkSourceRef(chunk = {}, index = 0) {
  return clean(
    chunk.sourceRef ||
      chunk.ref ||
      chunk.timeRange ||
      chunk.timestamp ||
      chunk.timestampLabel ||
      chunk.pageLabel ||
      chunk.page ||
      chunk.pageNumber ||
      chunk.chunkId ||
      chunk.id ||
      chunk._id ||
      `source-${index + 1}`
  );
}

function normalizeSource(chunk = {}, index = 0) {
  return {
    id: clean(chunk.id || chunk._id || chunk.chunkId || `source-${index + 1}`),
    index: num(chunk.index, index),
    title: clean(chunk.title || chunk.heading || chunk.sectionTitle || `Source ${index + 1}`),
    sourceRef: getChunkSourceRef(chunk, index),
    preview: getChunkText(chunk).slice(0, 700),
    score: num(chunk.score || chunk._ragScore, 0),
  };
}

function normalizeSourcesFromPlan(plan = {}) {
  const retrieved = asArray(plan.retrievedChunks).map(normalizeSource);

  if (retrieved.length) return retrieved.slice(0, 40);

  return asArray(plan.citations || plan.sourceRefs)
    .map((ref, index) => ({
      id: `citation-${index + 1}`,
      index,
      title: clean(ref?.title || ref?.resourceTitle || `Source ${index + 1}`),
      sourceRef: clean(ref?.sourceRef || ref?.ref || ref?.page || ref?.timestamp || ref || `Source ${index + 1}`),
      preview: clean(ref?.text || ref?.preview || ""),
      score: 0,
    }))
    .slice(0, 40);
}

function maxVoiceTime(voiceScript = []) {
  return asArray(voiceScript).reduce((max, line) => Math.max(max, num(line?.t, 0)), 0);
}

function countCommands(boardCommands = []) {
  let total = 0;

  for (const command of asArray(boardCommands)) {
    total += 1;
    total += asArray(command?.children).length;
  }

  return total;
}

function getSegmentTitle(plan = {}, fallback = "Live tutor segment") {
  return clean(plan.segmentTitle || plan.raw?.segmentTitle || plan.topic || fallback);
}

function getNextCursorFromPlan(plan = {}) {
  return normalizeCursor(plan.nextCursor || plan.raw?.nextCursor || plan.runtimeState?.nextCursor || "");
}

function planSaysContinue(plan = {}) {
  const cursor = getNextCursorFromPlan(plan);
  if (isDoneCursor(cursor)) return false;
  return plan.continueMode !== false && plan.raw?.continueMode !== false;
}

function buildSegmentRecord({ plan = {}, input = {}, action = "start", status = "ready" } = {}) {
  const nextCursor = getNextCursorFromPlan(plan);

  return {
    segmentId: clean(plan.segmentId || makeCursor("seg")),
    action: clean(action || input.action || "start"),
    status,
    title: getSegmentTitle(plan),
    topic: clean(plan.topic || ""),
    intent: clean(plan.intent || ""),
    domain: clean(plan.domain || ""),
    startedAt: nowIso(),
    completedAt: "",
    durationSec: Math.max(0, Math.ceil(maxVoiceTime(plan.voiceScript))),
    commandCount: countCommands(plan.boardCommands),
    voiceLineCount: asArray(plan.voiceScript).length,
    citationCount: asArray(plan.citations || plan.sourceRefs).length,
    nextCursor,
    continueMode: planSaysContinue(plan),
    request: {
      question: clean(input.question || ""),
      interruptText: clean(input.interruptText || ""),
      cursor: normalizeCursor(input.nextCursor || input.cursor || input.runtimeState?.nextCursor || ""),
      currentCommandIndex: num(input.currentCommandIndex, 0),
      currentVoiceTime: num(input.currentVoiceTime || input.currentTime, 0),
      visibleCommandIds: asArray(input.visibleCommandIds),
    },
    stopPoint: null,
    weakParts: [],
    sources: normalizeSourcesFromPlan(plan).slice(0, 12),
    diagnostics: plan.diagnostics || {},
  };
}

export function createInitialLessonPlan({ resource, firstPlan = {}, input = {} } = {}) {
  const nextCursor = getNextCursorFromPlan(firstPlan) || "Continue with the next important section of the saved resource.";
  const sourceMap = normalizeSourcesFromPlan(firstPlan);

  return {
    planId: makeCursor("lesson"),
    resourceId: clean(resource?._id || input.resourceId || firstPlan.resourceId || ""),
    resourceTitle: getResourceTitle(resource),
    resourceSourceType: getResourceSourceType(resource),
    resourceSummary: getResourceSummary(resource),

    status: planSaysContinue(firstPlan) ? "active" : "done",
    startedAt: nowIso(),
    updatedAt: nowIso(),
    completedAt: "",

    autoContinue: input.autoContinue !== false,
    fullResourceMode: true,

    currentCursor: "",
    nextCursor,
    done: !planSaysContinue(firstPlan),
    stoppedByUser: false,

    segmentsGenerated: 1,
    segmentsCompleted: 0,
    totalVoiceSecondsGenerated: Math.ceil(maxVoiceTime(firstPlan.voiceScript)),
    totalCommandsGenerated: countCommands(firstPlan.boardCommands),

    sourceMap,
    completedSourceRefs: [],
    remainingHint: nextCursor,

    segmentHistory: [
      buildSegmentRecord({
        plan: firstPlan,
        input,
        action: input.action || "start",
        status: "ready",
      }),
    ],

    interruptHistory: [],

    memory: {
      lastQuestion: clean(input.question || input.interruptText || ""),
      lastWeakPart: "",
      lastExplainedTopic: getSegmentTitle(firstPlan, getResourceTitle(resource)),
      lastBoardState: {},
      lastVisibleCommandIds: [],
      lastCommandIndex: 0,
      lastVoiceTime: 0,
      exactResumeInstruction: "",
    },
  };
}

export function ensureLessonPlan({ existingLessonPlan = null, resource, currentPlan = {}, input = {} } = {}) {
  if (existingLessonPlan?.planId) {
    return {
      ...existingLessonPlan,
      updatedAt: nowIso(),
    };
  }

  return createInitialLessonPlan({
    resource,
    firstPlan: currentPlan,
    input,
  });
}

export function appendGeneratedSegment({ lessonPlan, segmentPlan = {}, input = {}, action = "continue" } = {}) {
  const base = lessonPlan?.planId
    ? lessonPlan
    : createInitialLessonPlan({
        resource: null,
        firstPlan: segmentPlan,
        input,
      });

  const nextCursor = getNextCursorFromPlan(segmentPlan);
  const continueMode = planSaysContinue(segmentPlan);
  const record = buildSegmentRecord({
    plan: segmentPlan,
    input,
    action,
    status: "ready",
  });

  const sourceRefs = normalizeSourcesFromPlan(segmentPlan)
    .map((source) => source.sourceRef)
    .filter(Boolean);

  const sourceMap = [...asArray(base.sourceMap), ...normalizeSourcesFromPlan(segmentPlan)];
  const dedupedSources = [];
  const seen = new Set();

  for (const source of sourceMap) {
    const key = clean(source.sourceRef || source.id || source.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    dedupedSources.push(source);
  }

  return {
    ...base,
    status: continueMode ? "active" : "done",
    updatedAt: nowIso(),
    completedAt: continueMode ? base.completedAt || "" : nowIso(),

    currentCursor: normalizeCursor(input.nextCursor || input.cursor || base.nextCursor || ""),
    nextCursor: continueMode ? nextCursor || "Continue with the next resource segment." : "DONE",
    done: !continueMode,
    stoppedByUser: false,

    segmentsGenerated: num(base.segmentsGenerated, 0) + 1,
    totalVoiceSecondsGenerated:
      num(base.totalVoiceSecondsGenerated, 0) + Math.ceil(maxVoiceTime(segmentPlan.voiceScript)),
    totalCommandsGenerated: num(base.totalCommandsGenerated, 0) + countCommands(segmentPlan.boardCommands),

    sourceMap: dedupedSources.slice(0, 160),
    completedSourceRefs: Array.from(
      new Set([...asArray(base.completedSourceRefs), ...sourceRefs].filter(Boolean))
    ),

    remainingHint: continueMode ? nextCursor : "DONE",
    segmentHistory: [...asArray(base.segmentHistory), record].slice(-200),

    memory: {
      ...(base.memory || {}),
      lastQuestion: clean(input.question || input.interruptText || base.memory?.lastQuestion || ""),
      lastExplainedTopic: getSegmentTitle(segmentPlan, base.memory?.lastExplainedTopic || ""),
      exactResumeInstruction: continueMode ? nextCursor : "DONE",
    },
  };
}

export function markCurrentSegmentCompleted({ lessonPlan, runtimeState = {} } = {}) {
  if (!lessonPlan?.planId) return lessonPlan;

  const history = asArray(lessonPlan.segmentHistory);
  if (!history.length) return lessonPlan;

  const updated = history.map((segment, index) => {
    if (index !== history.length - 1) return segment;
    if (segment.status === "completed") return segment;

    return {
      ...segment,
      status: "completed",
      completedAt: nowIso(),
      stopPoint: {
        reason: "segment_completed",
        currentCommandIndex: num(runtimeState.currentCommandIndex, segment.request?.currentCommandIndex || 0),
        currentVoiceTime: num(runtimeState.currentVoiceTime || runtimeState.currentTime, segment.durationSec || 0),
        visibleCommandIds: asArray(runtimeState.visibleCommandIds),
        boardState: runtimeState.boardState || {},
        savedAt: nowIso(),
      },
    };
  });

  return {
    ...lessonPlan,
    updatedAt: nowIso(),
    segmentsCompleted: num(lessonPlan.segmentsCompleted, 0) + 1,
    segmentHistory: updated,
    memory: {
      ...(lessonPlan.memory || {}),
      lastBoardState: runtimeState.boardState || lessonPlan.memory?.lastBoardState || {},
      lastVisibleCommandIds: asArray(runtimeState.visibleCommandIds),
      lastCommandIndex: num(runtimeState.currentCommandIndex, lessonPlan.memory?.lastCommandIndex || 0),
      lastVoiceTime: num(runtimeState.currentVoiceTime || runtimeState.currentTime, lessonPlan.memory?.lastVoiceTime || 0),
    },
  };
}

export function recordTutorInterrupt({ lessonPlan, input = {}, runtimeState = {} } = {}) {
  if (!lessonPlan?.planId) return lessonPlan;

  const current = {
    interruptId: makeCursor("interrupt"),
    at: nowIso(),
    question: clean(input.interruptText || input.question || input.instruction || ""),
    currentCursor: normalizeCursor(input.nextCursor || input.cursor || lessonPlan.nextCursor || ""),
    currentCommandIndex: num(input.currentCommandIndex, runtimeState.currentCommandIndex || 0),
    currentVoiceTime: num(input.currentVoiceTime || input.currentTime, runtimeState.currentVoiceTime || 0),
    visibleCommandIds: asArray(input.visibleCommandIds || runtimeState.visibleCommandIds),
    boardState: input.boardState || runtimeState.boardState || {},
    action: clean(input.action || "interrupt"),
  };

  const exactResumeInstruction = [
    `Student interrupted at command index ${current.currentCommandIndex}.`,
    `Voice time: ${current.currentVoiceTime}s.`,
    current.question ? `Student asked: ${current.question}` : "",
    current.currentCursor ? `Continue cursor: ${current.currentCursor}` : "",
    "Repair the weak point first, then continue from this same point.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    ...lessonPlan,
    updatedAt: nowIso(),
    interruptHistory: [...asArray(lessonPlan.interruptHistory), current].slice(-100),
    memory: {
      ...(lessonPlan.memory || {}),
      lastQuestion: current.question,
      lastWeakPart: current.question,
      lastBoardState: current.boardState,
      lastVisibleCommandIds: current.visibleCommandIds,
      lastCommandIndex: current.currentCommandIndex,
      lastVoiceTime: current.currentVoiceTime,
      exactResumeInstruction,
    },
  };
}

export function stopLessonPlan({ lessonPlan, reason = "user_stop" } = {}) {
  if (!lessonPlan?.planId) return lessonPlan;

  return {
    ...lessonPlan,
    status: reason === "done" ? "done" : "stopped",
    done: reason === "done" || isDoneCursor(lessonPlan.nextCursor),
    stoppedByUser: reason !== "done",
    updatedAt: nowIso(),
    completedAt: reason === "done" ? nowIso() : lessonPlan.completedAt || "",
    stopReason: reason,
  };
}

export function getContinuationPayload({ lessonPlan, input = {} } = {}) {
  const nextCursor = normalizeCursor(
    input.nextCursor ||
      input.cursor ||
      input.runtimeState?.nextCursor ||
      lessonPlan?.nextCursor ||
      lessonPlan?.remainingHint ||
      ""
  );

  return {
    nextCursor: isDoneCursor(nextCursor) ? "DONE" : nextCursor || "Continue with the next resource segment.",
    continueMode: !isDoneCursor(nextCursor),
    lessonMemory: {
      planId: lessonPlan?.planId || "",
      segmentsGenerated: num(lessonPlan?.segmentsGenerated, 0),
      segmentsCompleted: num(lessonPlan?.segmentsCompleted, 0),
      lastExplainedTopic: clean(lessonPlan?.memory?.lastExplainedTopic || ""),
      lastQuestion: clean(lessonPlan?.memory?.lastQuestion || ""),
      exactResumeInstruction: clean(lessonPlan?.memory?.exactResumeInstruction || ""),
      completedSourceRefs: asArray(lessonPlan?.completedSourceRefs).slice(-30),
    },
  };
}

export function shouldAutoContinue({ lessonPlan } = {}) {
  if (!lessonPlan?.planId) return false;
  if (lessonPlan.stoppedByUser) return false;
  if (lessonPlan.done) return false;
  if (isDoneCursor(lessonPlan.nextCursor)) return false;
  return lessonPlan.autoContinue !== false;
}

export default {
  createInitialLessonPlan,
  ensureLessonPlan,
  appendGeneratedSegment,
  markCurrentSegmentCompleted,
  recordTutorInterrupt,
  stopLessonPlan,
  getContinuationPayload,
  shouldAutoContinue,
};