// server/services/gemmaResource/liveTutor/liveTutorSession.service.js
//
// FULL REPLACEMENT
//
// Robust session save layer for real long Live Tutor.
//
// Fixes:
// - No old 360 default. Uses 60 min total + 600 sec segment.
// - Preserves rich Gemma payload: boardPages, layoutPlan, teacherActions, boardCommands, voiceScript.
// - Saves sessions safely into LiveTutorBoard without stripping actionId/pageId/linkedCommandIds.
// - For continue/interrupt, saves merged board in DB but returns only the NEW segment to frontend,
//   so frontend append logic does not duplicate the old board.
// - Appends DB timeline with time offsets.
// - Supports interrupt exact state: currentActionId, visibleActionIds, currentCommandIndex,
//   visibleCommandIds, sessionId.
// - Avoids enum validation crashes.
// - No fake fallback.
// - No static demo.
// - Keeps controller export compatibility.

import mongoose from "mongoose";
import LiveTutorBoard from "../../../models/LiveTutorBoard.js";
import {
  startLiveTutor,
  controlLiveTutor,
  interruptLiveTutor,
} from "./liveTutorEngine.service.js";

const DEFAULT_TOTAL_MINUTES = 60;
const DEFAULT_SEGMENT_SECONDS = 600;

function clean(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function raw(value = "") {
  return String(value ?? "").replace(/\r/g, "\n").trim();
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const text = clean(value).toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(text)) return true;
  if (["false", "0", "no", "n", "off"].includes(text)) return false;
  return fallback;
}

function isObjectId(value = "") {
  return /^[a-f0-9]{24}$/i.test(String(value || ""));
}

function newId(prefix = "id") {
  return `${prefix}_${new mongoose.Types.ObjectId().toString()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function uniqueStrings(values = [], max = 120) {
  return Array.from(
    new Set(
      asArray(values)
        .map(clean)
        .filter(Boolean)
    )
  ).slice(0, max);
}

function safeJson(value, fallback = {}) {
  try {
    if (!value) return fallback;
    if (typeof value === "string") return JSON.parse(value);
    return value;
  } catch {
    return fallback;
  }
}

function getIdentity(input = {}) {
  const offlineUserId = clean(
    input.offlineUserId ||
      input.gemmaOfflineUserId ||
      input.localUserId ||
      input.identity?.offlineUserId ||
      ""
  );

  const deviceId = clean(input.deviceId || input.identity?.deviceId || "");

  const explicitOwnerKey = clean(input.ownerKey || input.identity?.ownerKey || "");

  const ownerKey =
    explicitOwnerKey ||
    (offlineUserId ? `offline:${offlineUserId}` : "") ||
    (deviceId ? `device:${deviceId}` : "") ||
    "guest:unknown";

  const ownerType = ownerKey.startsWith("offline:")
    ? "offline"
    : ownerKey.startsWith("device:")
      ? "device"
      : ownerKey.startsWith("user:")
        ? "user"
        : explicitOwnerKey
          ? "ownerKey"
          : "guest";

  return {
    offlineUserId,
    deviceId,
    ownerKey,
    ownerType,
  };
}

function normalizeAction(input = {}) {
  const action = clean(input.action || input.control || "").toLowerCase();

  if (["next_segment", "next", "continue", "resume_segment"].includes(action)) return "continue";
  if (["simpler", "simplify", "go_back", "quiz"].includes(action)) return "interrupt";
  if (["start", "continue", "interrupt", "pause", "resume", "stop", "delete", "clear"].includes(action)) return action;

  if (input.sessionId && clean(input.interruptText || input.question)) return "interrupt";
  return input.sessionId ? "continue" : "start";
}

function commandTime(command = {}) {
  return num(command.t ?? command.time ?? command.second ?? command.startAt, 0);
}

function voiceTime(line = {}) {
  return num(line.t ?? line.time ?? line.second ?? line.startAt, 0);
}

function maxVoiceTime(voiceScript = []) {
  return asArray(voiceScript).reduce((max, line) => Math.max(max, voiceTime(line)), 0);
}

function maxCommandTime(commands = []) {
  let max = 0;

  for (const command of asArray(commands)) {
    const parentT = commandTime(command);
    max = Math.max(max, parentT);

    for (const child of asArray(command.children || command.blocks || command.commands)) {
      const childT = commandTime(child);
      max = Math.max(max, childT < parentT ? parentT + childT : childT);
    }
  }

  return max;
}

function estimateVoiceDuration(voiceScript = []) {
  return asArray(voiceScript).reduce((sum, line) => {
    const text = clean(line.text || line.speech || line.boardNote || "");
    return sum + Math.max(5, Math.ceil(text.length / 15));
  }, 0);
}

function segmentDuration(payload = {}) {
  return Math.max(
    DEFAULT_SEGMENT_SECONDS,
    maxVoiceTime(payload.voiceScript),
    maxCommandTime(payload.boardCommands),
    num(payload.estimatedTotalSeconds, 0),
    num(payload.diagnostics?.voiceDurationSec, 0),
    estimateVoiceDuration(payload.voiceScript)
  );
}

function shiftCommand(command = {}, offsetSec = 0) {
  const t = commandTime(command) + offsetSec;

  return {
    ...command,
    t,
    time: command.time === undefined ? command.time : num(command.time, 0) + offsetSec,
    second: command.second === undefined ? command.second : num(command.second, 0) + offsetSec,
    children: asArray(command.children || command.blocks || command.commands).map((child) => {
      const childT = commandTime(child);
      const absoluteChildT = childT < commandTime(command) ? commandTime(command) + childT : childT;

      return {
        ...child,
        t: absoluteChildT + offsetSec,
      };
    }),
  };
}

function shiftVoice(line = {}, offsetSec = 0) {
  return {
    ...line,
    t: voiceTime(line) + offsetSec,
    time: line.time === undefined ? line.time : num(line.time, 0) + offsetSec,
    second: line.second === undefined ? line.second : num(line.second, 0) + offsetSec,
  };
}

function normalizeVoiceScript(value = [], segmentIndex = 0) {
  return asArray(value)
    .map((line, index) => {
      if (typeof line === "string") {
        return {
          id: newId("voice"),
          t: index * 9,
          text: clean(line),
          speech: clean(line),
          boardNote: clean(line),
          language: "",
          actionId: "",
          linkedCommandIds: [],
          sourceRef: "",
          segmentIndex,
          meta: {},
          order: index,
          original: { text: clean(line) },
        };
      }

      const text = clean(line?.text || line?.speech || line?.line || line?.content || line?.voiceText || "");
      const boardNote = clean(line?.boardNote || line?.note || line?.summary || text);

      return {
        ...line,
        id: clean(line?.id || line?.voiceId || newId("voice")),
        voiceId: clean(line?.voiceId || line?.id || ""),
        t: voiceTime(line),
        text,
        speech: clean(line?.speech || text),
        boardNote,
        language: clean(line?.language || line?.lang || ""),
        actionId: clean(line?.actionId || line?.teacherActionId || line?.linkedActionId || ""),
        linkedCommandIds: asArray(line?.linkedCommandIds || line?.commandIds).map(clean).filter(Boolean),
        sourceRef: clean(line?.sourceRef || line?.ref || line?.citation || ""),
        segmentIndex: num(line?.segmentIndex, segmentIndex),
        meta: line?.meta || {},
        original: line,
        order: index,
      };
    })
    .filter((line) => clean(line.text || line.speech || line.boardNote));
}

function normalizeCommands(value = [], segmentIndex = 0) {
  return asArray(value)
    .map((cmd, index) => {
      if (typeof cmd === "string") {
        return {
          id: newId("cmd"),
          type: "write",
          t: index * 6,
          slot: "auto",
          title: "",
          text: clean(cmd),
          content: clean(cmd),
          sourceRef: "",
          emphasis: "normal",
          children: [],
          nodes: [],
          edges: [],
          items: [],
          rows: [],
          columns: [],
          code: "",
          language: "",
          formula: "",
          mermaid: "",
          question: "",
          choices: [],
          answer: "",
          explanation: "",
          actionId: "",
          pageId: "page_1",
          data: { text: clean(cmd) },
          segmentIndex,
          order: index,
        };
      }

      return {
        ...cmd,
        id: clean(cmd?.id || cmd?.commandId || newId("cmd")),
        commandId: clean(cmd?.commandId || cmd?.id || ""),
        type: clean(cmd?.type || "write"),
        t: commandTime(cmd),
        slot: clean(cmd?.slot || cmd?.columnId || cmd?.column || "auto"),
        pageId: clean(cmd?.pageId || cmd?.page || "page_1"),
        actionId: clean(cmd?.actionId || cmd?.teacherActionId || ""),
        title: clean(cmd?.title || cmd?.heading || ""),
        text: clean(cmd?.text || cmd?.content || cmd?.question || cmd?.formula || ""),
        content: clean(cmd?.content || cmd?.text || ""),
        sourceRef: clean(cmd?.sourceRef || cmd?.ref || cmd?.citation || ""),
        emphasis: clean(cmd?.emphasis || "normal"),
        children: asArray(cmd?.children || cmd?.blocks || cmd?.commands),
        nodes: asArray(cmd?.nodes),
        edges: asArray(cmd?.edges),
        items: asArray(cmd?.items),
        rows: asArray(cmd?.rows),
        columns: asArray(cmd?.columns),
        code: String(cmd?.code || ""),
        language: clean(cmd?.language || cmd?.lang || ""),
        formula: clean(cmd?.formula || cmd?.latex || ""),
        mermaid: String(cmd?.mermaid || ""),
        question: clean(cmd?.question || ""),
        choices: asArray(cmd?.choices || cmd?.options),
        answer: clean(cmd?.answer || ""),
        explanation: clean(cmd?.explanation || ""),
        data: cmd,
        segmentIndex: num(cmd?.segmentIndex, segmentIndex),
        order: index,
      };
    })
    .filter((cmd) => clean(cmd.type));
}

function normalizeTeacherActions(value = [], segmentIndex = 0) {
  return asArray(value)
    .map((action, index) => ({
      ...action,
      id: clean(action?.id || action?.actionId || newId("act")),
      type: clean(action?.type || action?.action || "drawText"),
      t: num(action?.t ?? action?.time ?? action?.second, index * 8),
      pageId: clean(action?.pageId || action?.page || "page_1"),
      columnId: clean(action?.columnId || action?.slot || ""),
      text: clean(action?.text || action?.title || action?.speech || action?.question || action?.formula || ""),
      speech: clean(action?.speech || action?.voice || action?.text || ""),
      sourceRef: clean(action?.sourceRef || action?.ref || action?.citation || ""),
      segmentIndex,
      order: index,
    }))
    .filter((action) => clean(action.type));
}

function makeTimeline(payload = {}, offsetMs = 0) {
  const steps = [];

  for (const command of asArray(payload.boardCommands)) {
    const t = commandTime(command);

    steps.push({
      stepId: newId("step"),
      atMs: offsetMs + Math.round(t * 1000),
      action: "write_block",
      blockId: clean(command.id || ""),
      text: clean(command.title || command.text || command.question || command.formula || command.sourceRef || ""),
      data: command,
    });

    for (const child of asArray(command.children || command.blocks || command.commands)) {
      const childT = commandTime(child);
      const absoluteT = childT < t ? t + childT : childT;

      steps.push({
        stepId: newId("step"),
        atMs: offsetMs + Math.round(absoluteT * 1000),
        action: "write_block",
        blockId: clean(child.id || ""),
        text: clean(child.title || child.text || child.question || child.formula || ""),
        data: {
          ...child,
          parentId: command.id,
        },
      });
    }
  }

  for (const line of asArray(payload.voiceScript)) {
    const t = voiceTime(line);

    steps.push({
      stepId: newId("voice"),
      atMs: offsetMs + Math.round(t * 1000),
      action: "speak",
      blockId: clean(asArray(line.linkedCommandIds)[0] || ""),
      text: clean(line.text || line.speech || line.boardNote || ""),
      data: line,
    });
  }

  return steps.sort((a, b) => num(a.atMs) - num(b.atMs));
}

function blockType(type = "") {
  const t = clean(type || "unknown");

  const allowed = new Set([
    "boardPage",
    "section",
    "heading",
    "write",
    "paragraph",
    "text",
    "formulaBox",
    "formula",
    "table",
    "dryRunTable",
    "dpTable",
    "compareBox",
    "compare",
    "codeBox",
    "code",
    "array",
    "hashmap",
    "stack",
    "queue",
    "tree",
    "recursionTree",
    "flowDiagram",
    "flow",
    "timeline",
    "diagram",
    "classDiagram",
    "sequenceDiagram",
    "mermaidDiagram",
    "arrow",
    "bracketNote",
    "callout",
    "highlight",
    "underline",
    "sketchPath",
    "complexityNote",
    "sourceRef",
    "quizCheck",
    "quiz",
    "repair",
    "dry_run_table",
    "pause",
    "erase",
    "voiceLine",
    "unknown",
  ]);

  return allowed.has(t) ? t : "unknown";
}

function pagePurpose(intent = "") {
  const p = clean(intent || "visual_lesson");

  const allowed = new Set([
    "visual_lesson",
    "auto_teach",
    "external_question",
    "internal_resource",
    "interrupt_answer",
    "continue",
    "dry_run",
    "compare",
    "quiz",
    "simplify",
    "go_back",
    "explain_marked_area",
    "resource_lesson",
    "code_tutor",
    "unknown",
  ]);

  return allowed.has(p) ? p : "visual_lesson";
}

function makePages(payload = {}) {
  const commands = normalizeCommands(payload.boardCommands);
  const boardPages = asArray(payload.boardPages);

  if (boardPages.length) {
    return boardPages.map((page, pageIndex) => {
      const pageId = clean(page.id || page.pageId || `page_${pageIndex + 1}`);
      const pageCommands = commands.filter((command) => clean(command.pageId || "page_1") === pageId);

      return {
        pageId,
        title: clean(page.title || page.heading || `Scene ${pageIndex + 1}`),
        purpose: pagePurpose(payload.intent),
        autoExpanded: true,
        meta: page,
        blocks: pageCommands.map((command, index) => ({
          blockId: clean(command.id || `cmd_${pageIndex}_${index}`),
          type: blockType(command.type),
          title: clean(command.title || command.text || ""),
          content: clean(command.text || command.code || command.formula || command.mermaid || command.question || ""),
          data: command,
          order: index,
          editable: true,
          generatedBy: "ai",
          linkedTranscriptTime: commandTime(command),
          style: {
            emphasis: clean(command.emphasis || "normal"),
            colorHint: clean(command.color || ""),
          },
          linkedRect: {},
        })),
      };
    });
  }

  return [
    {
      pageId: newId("page"),
      title: clean(payload.topic || payload.segmentTitle || "Live Tutor Board"),
      purpose: pagePurpose(payload.intent),
      autoExpanded: true,
      meta: {},
      blocks: commands.map((command, index) => ({
        blockId: clean(command.id || `cmd_${index}`),
        type: blockType(command.type),
        title: clean(command.title || command.text || ""),
        content: clean(command.text || command.code || command.formula || command.mermaid || command.question || ""),
        data: command,
        order: index,
        editable: true,
        generatedBy: "ai",
        linkedTranscriptTime: commandTime(command),
        style: {
          emphasis: clean(command.emphasis || "normal"),
          colorHint: clean(command.color || ""),
        },
        linkedRect: {},
      })),
    },
  ];
}

function publicSessionFromBoard(board = null, extra = {}) {
  if (!board) return null;

  const obj = typeof board.toObject === "function" ? board.toObject() : board;

  return {
    ok: true,
    sessionId: String(obj._id || extra.sessionId || ""),
    boardId: String(obj._id || extra.boardId || ""),
    sessionKey: clean(obj.sessionKey || extra.sessionKey || ""),
    resourceId: String(obj.resourceId || extra.resourceId || ""),
    status: clean(obj.status || extra.status || "ready"),

    topic: clean(obj.topic || obj.title || extra.topic || ""),
    segmentTitle: clean(obj.segmentTitle || extra.segmentTitle || ""),
    intent: clean(obj.intent || extra.intent || ""),
    domain: clean(obj.domain || extra.domain || ""),
    topicFamily: clean(obj.topicFamily || extra.topicFamily || ""),

    continueMode: obj.continueMode !== false && clean(obj.nextCursor || extra.nextCursor).toUpperCase() !== "DONE",
    nextCursor: clean(obj.nextCursor || extra.nextCursor || ""),

    externalKnowledgeUsed: Boolean(obj.externalKnowledgeUsed || extra.externalKnowledgeUsed),
    offlineKnowledgeUsed: Boolean(obj.offlineKnowledgeUsed || extra.offlineKnowledgeUsed || obj.externalKnowledgeUsed),
    resourceGroundedRatio: num(obj.resourceGroundedRatio, extra.resourceGroundedRatio ?? 0.8),

    shortAnswer: clean(obj.shortAnswer || extra.shortAnswer || ""),

    layoutPlan: obj.layoutPlan || extra.layoutPlan || null,
    boardPages: asArray(obj.boardPages || extra.boardPages),
    teacherActions: asArray(obj.teacherActions || obj.boardActions || extra.teacherActions || extra.boardActions),
    boardActions: asArray(obj.teacherActions || obj.boardActions || extra.teacherActions || extra.boardActions),

    boardCommands: asArray(obj.boardCommands || obj.commands || extra.boardCommands),
    voiceScript: asArray(obj.voiceScript || extra.voiceScript),
    voiceText: clean(obj.voiceText || extra.voiceText || ""),

    repairOptions: asArray(obj.repairOptions || extra.repairOptions),
    citations: asArray(obj.citations || obj.sourceRefs || extra.citations),
    sourceRefs: asArray(obj.sourceRefs || obj.citations || extra.sourceRefs),
    internalSourceRefs: asArray(obj.internalSourceRefs || extra.internalSourceRefs),
    knowledgeRefs: asArray(obj.knowledgeRefs || extra.knowledgeRefs),

    retrievedChunks: asArray(obj.retrievedChunks || extra.retrievedChunks),
    replayTimeline: asArray(obj.replayTimeline || extra.replayTimeline),
    pages: asArray(obj.pages || extra.pages),

    runtimeState: obj.runtimeState || extra.runtimeState || {},
    continuousTutor: obj.continuousTutor || extra.continuousTutor || {},
    diagnostics: obj.diagnostics || extra.diagnostics || {},
    quality: obj.quality || extra.quality || {},

    privacy: {
      ownerType: clean(obj.ownerType || extra.ownerType || ""),
      ownerKey: clean(obj.ownerKey || extra.ownerKey || ""),
    },

    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

async function findBoardBySession({ sessionId, ownerKey, resourceId }) {
  if (!sessionId || !isObjectId(sessionId)) return null;

  const query = {
    _id: sessionId,
    isDeleted: { $ne: true },
  };

  if (ownerKey) query.ownerKey = ownerKey;
  if (resourceId && isObjectId(resourceId)) query.resourceId = resourceId;

  return LiveTutorBoard.findOne(query);
}

function buildRuntimeState({ payload = {}, input = {}, existing = null, status = "playing", bufferedToSec = 0, segmentIndex = 0 }) {
  return {
    ...(existing?.runtimeState || {}),
    ...(payload.runtimeState || {}),

    status,
    nextCursor: clean(payload.nextCursor || ""),
    continueMode: payload.continueMode !== false && clean(payload.nextCursor || "").toUpperCase() !== "DONE",

    currentTime: num(input.currentTime ?? input.currentTimeSec, existing?.runtimeState?.currentTime || 0),
    currentTimeSec: num(input.currentTimeSec ?? input.currentTime, existing?.runtimeState?.currentTimeSec || 0),
    currentVoiceTime: num(input.currentVoiceTime || input.currentTime || input.currentTimeSec, existing?.runtimeState?.currentVoiceTime || 0),

    currentCommandIndex: num(input.currentCommandIndex, existing?.runtimeState?.currentCommandIndex || 0),
    currentCommandId: clean(input.currentCommandId || existing?.runtimeState?.currentCommandId || ""),

    currentActionId: clean(input.currentActionId || existing?.runtimeState?.currentActionId || ""),
    visibleActionIds: asArray(input.visibleActionIds || existing?.runtimeState?.visibleActionIds),

    currentVoiceLineId: clean(input.currentVoiceLineId || existing?.runtimeState?.currentVoiceLineId || ""),
    currentVoiceLineIndex: num(input.currentVoiceLineIndex, existing?.runtimeState?.currentVoiceLineIndex || 0),

    visibleCommandIds: asArray(input.visibleCommandIds || existing?.runtimeState?.visibleCommandIds),

    segmentDurationSec: num(payload.estimatedTotalSeconds || input.segmentDurationSec, DEFAULT_SEGMENT_SECONDS),
    bufferedToSec,
    latestSegmentDurationSec: num(payload.estimatedTotalSeconds, DEFAULT_SEGMENT_SECONDS),
    segmentIndex,
    segmentCount: segmentIndex + 1,

    targetTotalMinutes: num(input.targetTotalMinutes, existing?.runtimeState?.targetTotalMinutes || DEFAULT_TOTAL_MINUTES),
    targetTotalSeconds: num(input.targetTotalMinutes, existing?.runtimeState?.targetTotalMinutes || DEFAULT_TOTAL_MINUTES) * 60,
    lessonDurationMode: clean(input.lessonDurationMode || existing?.runtimeState?.lessonDurationMode || "masterclass"),

    boardState: input.boardState || existing?.runtimeState?.boardState || null,
    updatedAt: nowIso(),
  };
}

function makeBoardDoc(payload = {}, input = {}) {
  const identity = getIdentity(input);
  const segmentIndex = 0;

  const normalizedCommands = normalizeCommands(payload.boardCommands, segmentIndex);
  const normalizedVoice = normalizeVoiceScript(payload.voiceScript, segmentIndex);
  const normalizedActions = normalizeTeacherActions(payload.teacherActions || payload.boardActions, segmentIndex);

  const durationSec = segmentDuration({
    ...payload,
    boardCommands: normalizedCommands,
    voiceScript: normalizedVoice,
  });

  const runtimeState = buildRuntimeState({
    payload,
    input,
    status: clean(payload.status || "playing"),
    bufferedToSec: durationSec,
    segmentIndex,
  });

  return {
    resourceId: payload.resourceId,
    sessionKey: clean(payload.sessionKey || `gemma_live_tutor_${new mongoose.Types.ObjectId().toString()}`),

    ownerType: identity.ownerType,
    ownerKey: identity.ownerKey,
    offlineUserId: identity.offlineUserId,
    deviceId: identity.deviceId,

    status: clean(payload.status || "playing"),
    title: clean(payload.topic || "Live Tutor Board"),
    topic: clean(payload.topic || ""),
    segmentTitle: clean(payload.segmentTitle || ""),
    intent: clean(payload.intent || "resource_lesson"),
    domain: clean(payload.domain || ""),
    topicFamily: clean(payload.topicFamily || ""),

    continueMode: payload.continueMode !== false && clean(payload.nextCursor || "").toUpperCase() !== "DONE",
    nextCursor: clean(payload.nextCursor || ""),

    externalKnowledgeUsed: Boolean(payload.externalKnowledgeUsed),
    offlineKnowledgeUsed: Boolean(payload.offlineKnowledgeUsed || payload.externalKnowledgeUsed),
    resourceGroundedRatio: num(payload.resourceGroundedRatio, 0.8),

    shortAnswer: clean(payload.shortAnswer || ""),

    layoutPlan: payload.layoutPlan || {},
    boardPages: asArray(payload.boardPages),
    teacherActions: normalizedActions,
    boardActions: normalizedActions,

    boardCommands: normalizedCommands,
    commands: normalizedCommands,

    voiceScript: normalizedVoice,
    voiceText: clean(payload.voiceText || normalizedVoice.map((line) => line.text).join(" ")),

    repairOptions: asArray(payload.repairOptions),
    citations: uniqueStrings(payload.citations || payload.sourceRefs, 120),
    sourceRefs: uniqueStrings(payload.sourceRefs || payload.citations, 120),
    internalSourceRefs: uniqueStrings(payload.internalSourceRefs || payload.sourceRefs || payload.citations, 120),
    knowledgeRefs: uniqueStrings(payload.knowledgeRefs || ["Gemma offline same-topic knowledge"], 40),
    retrievedChunks: asArray(payload.retrievedChunks),

    replayTimeline: makeTimeline({
      ...payload,
      boardCommands: normalizedCommands,
      voiceScript: normalizedVoice,
    }),

    pages: makePages({
      ...payload,
      boardCommands: normalizedCommands,
    }),

    runtimeState,
    continuousTutor: payload.continuousTutor || {
      targetTotalMinutes: num(input.targetTotalMinutes, DEFAULT_TOTAL_MINUTES),
      targetTotalSeconds: num(input.targetTotalMinutes, DEFAULT_TOTAL_MINUTES) * 60,
      segmentDurationSec: num(input.segmentDurationSec, DEFAULT_SEGMENT_SECONDS),
      currentSegmentNumber: 1,
      estimatedSegmentCount: Math.ceil((num(input.targetTotalMinutes, DEFAULT_TOTAL_MINUTES) * 60) / DEFAULT_SEGMENT_SECONDS),
      shouldContinue: true,
    },

    diagnostics: {
      ...(payload.diagnostics || {}),
      savedBySessionService: true,
      schemaCompatible: true,
      sessionLayerDefaultTotalMinutes: DEFAULT_TOTAL_MINUTES,
      sessionLayerDefaultSegmentSeconds: DEFAULT_SEGMENT_SECONDS,
    },

    quality: payload.quality || {},

    boardState: input.boardState || {},

    editHistory: [
      {
        action: "start",
        at: new Date(),
        note: "Live tutor session started from real RAG + Gemma board plan.",
        data: {
          durationSec,
          nextCursor: clean(payload.nextCursor || ""),
          commandCount: normalizedCommands.length,
          voiceCount: normalizedVoice.length,
        },
      },
    ],
  };
}

function makeAppendPatch(existingBoard = {}, payload = {}, input = {}) {
  const oldCommands = asArray(existingBoard.boardCommands || existingBoard.commands);
  const oldVoice = asArray(existingBoard.voiceScript);
  const oldActions = asArray(existingBoard.teacherActions || existingBoard.boardActions);
  const oldTimeline = asArray(existingBoard.replayTimeline);
  const oldPages = asArray(existingBoard.pages);
  const oldBoardPages = asArray(existingBoard.boardPages);

  const previousBufferedToSec = Math.max(
    num(existingBoard.runtimeState?.bufferedToSec, 0),
    segmentDuration({
      boardCommands: oldCommands,
      voiceScript: oldVoice,
      diagnostics: existingBoard.diagnostics,
    })
  );

  const segmentIndex = num(existingBoard.runtimeState?.segmentCount, oldPages.length || 1);

  const normalizedCommands = normalizeCommands(payload.boardCommands, segmentIndex);
  const normalizedVoice = normalizeVoiceScript(payload.voiceScript, segmentIndex);
  const normalizedActions = normalizeTeacherActions(payload.teacherActions || payload.boardActions, segmentIndex);

  const newSegmentDuration = segmentDuration({
    ...payload,
    boardCommands: normalizedCommands,
    voiceScript: normalizedVoice,
  });

  const offsetSec = previousBufferedToSec + 1.5;
  const offsetMs = Math.round(offsetSec * 1000);

  const shiftedCommands = normalizedCommands.map((cmd) => shiftCommand(cmd, offsetSec));
  const shiftedVoice = normalizedVoice.map((line) => shiftVoice(line, offsetSec));
  const shiftedActions = normalizedActions.map((action) => ({
    ...action,
    t: num(action.t, 0) + offsetSec,
  }));

  const mergedCommands = [...oldCommands, ...shiftedCommands];
  const mergedVoice = [...oldVoice, ...shiftedVoice];
  const mergedActions = [...oldActions, ...shiftedActions];

  const bufferedToSec = offsetSec + newSegmentDuration;

  const newPages = makePages({
    ...payload,
    boardCommands: shiftedCommands,
  });

  const runtimeState = buildRuntimeState({
    payload,
    input,
    existing: existingBoard,
    status: clean(payload.status || "playing"),
    bufferedToSec,
    segmentIndex,
  });

  return {
    $set: {
      status: clean(payload.status || "playing"),
      title: clean(payload.topic || existingBoard.topic || existingBoard.title || "Live Tutor Board"),
      topic: clean(payload.topic || existingBoard.topic || existingBoard.title || ""),
      segmentTitle: clean(payload.segmentTitle || existingBoard.segmentTitle || ""),
      intent: clean(payload.intent || existingBoard.intent || "resource_lesson"),
      domain: clean(payload.domain || existingBoard.domain || ""),
      topicFamily: clean(payload.topicFamily || existingBoard.topicFamily || ""),

      continueMode: payload.continueMode !== false && clean(payload.nextCursor || "").toUpperCase() !== "DONE",
      nextCursor: clean(payload.nextCursor || ""),

      externalKnowledgeUsed: Boolean(existingBoard.externalKnowledgeUsed || payload.externalKnowledgeUsed),
      offlineKnowledgeUsed: Boolean(existingBoard.offlineKnowledgeUsed || payload.offlineKnowledgeUsed || payload.externalKnowledgeUsed),
      resourceGroundedRatio: num(payload.resourceGroundedRatio, existingBoard.resourceGroundedRatio ?? 0.8),

      shortAnswer: clean(payload.shortAnswer || existingBoard.shortAnswer || ""),

      layoutPlan: payload.layoutPlan || existingBoard.layoutPlan || {},
      boardPages: [...oldBoardPages, ...asArray(payload.boardPages)],

      teacherActions: mergedActions,
      boardActions: mergedActions,

      boardCommands: mergedCommands,
      commands: mergedCommands,

      voiceScript: mergedVoice,
      voiceText: mergedVoice.map((line) => clean(line.text || line.speech)).filter(Boolean).join(" "),

      repairOptions: uniqueStrings([...asArray(existingBoard.repairOptions), ...asArray(payload.repairOptions)], 20),
      citations: uniqueStrings([...asArray(existingBoard.citations), ...asArray(payload.citations || payload.sourceRefs)], 160),
      sourceRefs: uniqueStrings([...asArray(existingBoard.sourceRefs), ...asArray(payload.sourceRefs || payload.citations)], 160),
      internalSourceRefs: uniqueStrings([...asArray(existingBoard.internalSourceRefs), ...asArray(payload.internalSourceRefs || payload.sourceRefs || payload.citations)], 160),
      knowledgeRefs: uniqueStrings([...asArray(existingBoard.knowledgeRefs), ...asArray(payload.knowledgeRefs || ["Gemma offline same-topic knowledge"])], 80),
      retrievedChunks: [...asArray(existingBoard.retrievedChunks), ...asArray(payload.retrievedChunks)].slice(-180),

      replayTimeline: [
        ...oldTimeline,
        ...makeTimeline(
          {
            ...payload,
            boardCommands: normalizedCommands,
            voiceScript: normalizedVoice,
          },
          offsetMs
        ),
      ].sort((a, b) => num(a.atMs) - num(b.atMs)),

      pages: [...oldPages, ...newPages],

      runtimeState,
      continuousTutor: {
        ...(existingBoard.continuousTutor || {}),
        ...(payload.continuousTutor || {}),
        segmentDurationSec: num(input.segmentDurationSec, DEFAULT_SEGMENT_SECONDS),
        targetTotalMinutes: num(input.targetTotalMinutes, DEFAULT_TOTAL_MINUTES),
        targetTotalSeconds: num(input.targetTotalMinutes, DEFAULT_TOTAL_MINUTES) * 60,
      },

      diagnostics: {
        ...(existingBoard.diagnostics || {}),
        ...(payload.diagnostics || {}),
        savedBySessionService: true,
        schemaCompatible: true,
        seamlessAutoContinue: true,
        appendedSegment: true,
        appendedOffsetSec: offsetSec,
        bufferedToSec,
        sessionLayerDefaultTotalMinutes: DEFAULT_TOTAL_MINUTES,
        sessionLayerDefaultSegmentSeconds: DEFAULT_SEGMENT_SECONDS,
      },

      quality: payload.quality || existingBoard.quality || {},
      boardState: input.boardState || existingBoard.boardState || {},

      updatedAt: new Date(),
    },

    $push: {
      editHistory: {
        action: clean(input.action || "continue") === "interrupt" ? "interrupt" : "continue",
        at: new Date(),
        note: "Live tutor segment appended.",
        data: {
          requestedAction: clean(input.action || "continue"),
          currentTime: num(input.currentTime ?? input.currentTimeSec, 0),
          currentActionId: clean(input.currentActionId || ""),
          visibleActionIds: asArray(input.visibleActionIds),
          currentCommandIndex: num(input.currentCommandIndex, 0),
          visibleCommandIds: asArray(input.visibleCommandIds),
          newSegmentDuration,
          offsetSec,
          bufferedToSec,
          nextCursor: clean(payload.nextCursor || ""),
        },
      },
    },
  };
}

async function createBoardFromPayload(payload = {}, input = {}) {
  const doc = makeBoardDoc(payload, input);
  const board = await LiveTutorBoard.create(doc);

  return publicSessionFromBoard(board, {
    ...payload,
    sessionId: String(board._id),
    boardId: String(board._id),
    ...getIdentity(input),
  });
}

async function appendPayloadToBoard(board, payload = {}, input = {}) {
  const patch = makeAppendPatch(board, payload, input);

  const updated = await LiveTutorBoard.findOneAndUpdate(
    { _id: board._id },
    patch,
    {
      new: true,
      runValidators: false,
      strict: false,
    }
  );

  return publicSessionFromBoard(updated, {
    ...payload,
    sessionId: String(updated?._id || board._id),
    boardId: String(updated?._id || board._id),
    ...getIdentity(input),
  });
}

function mergePayloadForClient(payload = {}, saved = {}, identity = {}, message = "") {
  return {
    ...saved,
    ...payload,

    ok: true,
    message: message || payload.message || saved.message || "Live tutor ready.",
    saved: true,

    sessionId: saved.sessionId || payload.sessionId,
    boardId: saved.boardId || payload.boardId || saved.sessionId,

    privacy: {
      ownerType: identity.ownerType || saved.privacy?.ownerType || "",
      ownerKey: identity.ownerKey || saved.privacy?.ownerKey || "",
    },

    data: {
      ...saved,
      ...payload,
      sessionId: saved.sessionId || payload.sessionId,
      boardId: saved.boardId || payload.boardId || saved.sessionId,
    },
  };
}

export async function startLiveTutorSession(input = {}) {
  const identity = getIdentity(input);

  const payload = await startLiveTutor({
    ...input,
    ownerKey: identity.ownerKey,
    offlineUserId: identity.offlineUserId,
    deviceId: identity.deviceId,
    targetTotalMinutes: num(input.targetTotalMinutes, DEFAULT_TOTAL_MINUTES),
    segmentDurationSec: num(input.segmentDurationSec, DEFAULT_SEGMENT_SECONDS),
  });

  const saved = await createBoardFromPayload(payload, {
    ...input,
    ...identity,
    action: "start",
    targetTotalMinutes: num(input.targetTotalMinutes, DEFAULT_TOTAL_MINUTES),
    segmentDurationSec: num(input.segmentDurationSec, DEFAULT_SEGMENT_SECONDS),
  });

  return mergePayloadForClient(
    payload,
    saved,
    identity,
    "Live tutor started from saved resource."
  );
}

export async function controlLiveTutorSession(input = {}) {
  const identity = getIdentity(input);
  const action = normalizeAction(input);

  if (action === "pause") return pauseLiveTutorSession(input);
  if (action === "resume") return resumeLiveTutorSession(input);
  if (action === "stop") return stopLiveTutorSession(input);
  if (action === "interrupt") return interruptLiveTutorSession(input);

  const existing = await findBoardBySession({
    sessionId: input.sessionId,
    ownerKey: identity.ownerKey,
    resourceId: input.resourceId,
  });

  if (!existing) {
    throw new Error("Live tutor session not found for this user/device.");
  }

  const payload = await controlLiveTutor({
    ...input,
    action: "continue",
    sessionId: String(existing._id),
    resourceId: String(existing.resourceId || input.resourceId),
    ownerKey: identity.ownerKey,
    offlineUserId: identity.offlineUserId,
    deviceId: identity.deviceId,

    targetTotalMinutes: num(input.targetTotalMinutes, existing.runtimeState?.targetTotalMinutes || DEFAULT_TOTAL_MINUTES),
    segmentDurationSec: num(input.segmentDurationSec, existing.runtimeState?.segmentDurationSec || DEFAULT_SEGMENT_SECONDS),

    nextCursor: clean(input.nextCursor || existing.nextCursor || existing.runtimeState?.nextCursor || ""),

    generatedSegments: num(input.generatedSegments, existing.runtimeState?.segmentCount || 1),
    completedSegments: num(input.completedSegments, existing.runtimeState?.segmentCount || 1),
    elapsedTutorialSeconds: num(input.elapsedTutorialSeconds, existing.runtimeState?.currentTimeSec || 0),
  });

  const saved = await appendPayloadToBoard(existing, payload, {
    ...input,
    ...identity,
    action: "continue",
    targetTotalMinutes: num(input.targetTotalMinutes, existing.runtimeState?.targetTotalMinutes || DEFAULT_TOTAL_MINUTES),
    segmentDurationSec: num(input.segmentDurationSec, existing.runtimeState?.segmentDurationSec || DEFAULT_SEGMENT_SECONDS),
  });

  return mergePayloadForClient(
    payload,
    saved,
    identity,
    "Live tutor next segment appended seamlessly."
  );
}

export async function interruptLiveTutorSession(input = {}) {
  const identity = getIdentity(input);

  const existing = await findBoardBySession({
    sessionId: input.sessionId,
    ownerKey: identity.ownerKey,
    resourceId: input.resourceId,
  });

  if (!existing) {
    throw new Error("Live tutor session not found for interrupt repair.");
  }

  const interruptText = clean(input.interruptText || input.question || input.instruction);
  if (!interruptText) {
    throw new Error("interruptText/question is required.");
  }

  const payload = await interruptLiveTutor({
    ...input,
    action: "interrupt",
    sessionId: String(existing._id),
    resourceId: String(existing.resourceId || input.resourceId),
    ownerKey: identity.ownerKey,
    offlineUserId: identity.offlineUserId,
    deviceId: identity.deviceId,

    targetTotalMinutes: num(input.targetTotalMinutes, existing.runtimeState?.targetTotalMinutes || DEFAULT_TOTAL_MINUTES),
    segmentDurationSec: num(input.segmentDurationSec, existing.runtimeState?.segmentDurationSec || DEFAULT_SEGMENT_SECONDS),

    interruptText,
    question: interruptText,

    nextCursor: clean(input.nextCursor || existing.nextCursor || existing.runtimeState?.nextCursor || ""),

    currentTime: num(input.currentTime ?? input.currentTimeSec, existing.runtimeState?.currentTime || 0),
    currentTimeSec: num(input.currentTimeSec ?? input.currentTime, existing.runtimeState?.currentTimeSec || 0),
    currentVoiceTime: num(input.currentVoiceTime || input.currentTime || input.currentTimeSec, existing.runtimeState?.currentVoiceTime || 0),

    currentCommandIndex: num(input.currentCommandIndex, existing.runtimeState?.currentCommandIndex || 0),
    currentCommandId: clean(input.currentCommandId || existing.runtimeState?.currentCommandId || ""),

    currentActionId: clean(input.currentActionId || existing.runtimeState?.currentActionId || ""),
    visibleActionIds: asArray(input.visibleActionIds || existing.runtimeState?.visibleActionIds),

    currentVoiceLineId: clean(input.currentVoiceLineId || existing.runtimeState?.currentVoiceLineId || ""),
    currentVoiceLineIndex: num(input.currentVoiceLineIndex, existing.runtimeState?.currentVoiceLineIndex || 0),

    visibleCommandIds: asArray(input.visibleCommandIds || existing.runtimeState?.visibleCommandIds),
    boardState: input.boardState || existing.boardState || existing.runtimeState?.boardState || null,

    generatedSegments: num(input.generatedSegments, existing.runtimeState?.segmentCount || 1),
    completedSegments: num(input.completedSegments, existing.runtimeState?.segmentCount || 1),
    elapsedTutorialSeconds: num(input.elapsedTutorialSeconds, existing.runtimeState?.currentTimeSec || 0),
  });

  const saved = await appendPayloadToBoard(existing, payload, {
    ...input,
    ...identity,
    action: "interrupt",
    targetTotalMinutes: num(input.targetTotalMinutes, existing.runtimeState?.targetTotalMinutes || DEFAULT_TOTAL_MINUTES),
    segmentDurationSec: num(input.segmentDurationSec, existing.runtimeState?.segmentDurationSec || DEFAULT_SEGMENT_SECONDS),
  });

  return mergePayloadForClient(
    payload,
    saved,
    identity,
    "Live tutor repaired from exact interrupt point."
  );
}

export async function pauseLiveTutorSession(input = {}) {
  const identity = getIdentity(input);

  const board = await findBoardBySession({
    sessionId: input.sessionId,
    ownerKey: identity.ownerKey,
    resourceId: input.resourceId,
  });

  if (!board) throw new Error("Live tutor session not found.");

  const updated = await LiveTutorBoard.findOneAndUpdate(
    { _id: board._id },
    {
      $set: {
        status: "paused",
        runtimeState: {
          ...(board.runtimeState || {}),
          status: "paused",
          currentTime: num(input.currentTime ?? input.currentTimeSec, board.runtimeState?.currentTime || 0),
          currentTimeSec: num(input.currentTimeSec ?? input.currentTime, board.runtimeState?.currentTimeSec || 0),
          currentVoiceTime: num(input.currentVoiceTime || input.currentTime || input.currentTimeSec, board.runtimeState?.currentVoiceTime || 0),
          currentCommandIndex: num(input.currentCommandIndex, board.runtimeState?.currentCommandIndex || 0),
          currentCommandId: clean(input.currentCommandId || board.runtimeState?.currentCommandId || ""),
          currentActionId: clean(input.currentActionId || board.runtimeState?.currentActionId || ""),
          visibleCommandIds: asArray(input.visibleCommandIds || board.runtimeState?.visibleCommandIds),
          visibleActionIds: asArray(input.visibleActionIds || board.runtimeState?.visibleActionIds),
          updatedAt: nowIso(),
        },
        updatedAt: new Date(),
      },
      $push: {
        editHistory: {
          action: "pause",
          at: new Date(),
          note: "Live tutor paused.",
          data: {
            currentTime: num(input.currentTime ?? input.currentTimeSec, 0),
          },
        },
      },
    },
    { new: true, runValidators: false, strict: false }
  );

  return {
    ...publicSessionFromBoard(updated),
    ok: true,
    message: "Live tutor paused.",
  };
}

export async function resumeLiveTutorSession(input = {}) {
  const identity = getIdentity(input);

  const board = await findBoardBySession({
    sessionId: input.sessionId,
    ownerKey: identity.ownerKey,
    resourceId: input.resourceId,
  });

  if (!board) throw new Error("Live tutor session not found.");

  const updated = await LiveTutorBoard.findOneAndUpdate(
    { _id: board._id },
    {
      $set: {
        status: "playing",
        runtimeState: {
          ...(board.runtimeState || {}),
          status: "playing",
          updatedAt: nowIso(),
        },
        updatedAt: new Date(),
      },
      $push: {
        editHistory: {
          action: "resume",
          at: new Date(),
          note: "Live tutor resumed.",
          data: {},
        },
      },
    },
    { new: true, runValidators: false, strict: false }
  );

  return {
    ...publicSessionFromBoard(updated),
    ok: true,
    message: "Live tutor resumed.",
  };
}

export async function stopLiveTutorSession(input = {}) {
  const identity = getIdentity(input);

  const board = await findBoardBySession({
    sessionId: input.sessionId,
    ownerKey: identity.ownerKey,
    resourceId: input.resourceId,
  });

  if (!board) throw new Error("Live tutor session not found.");

  const updated = await LiveTutorBoard.findOneAndUpdate(
    { _id: board._id },
    {
      $set: {
        status: "stopped",
        continueMode: false,
        runtimeState: {
          ...(board.runtimeState || {}),
          status: "stopped",
          continueMode: false,
          stoppedByUser: true,
          updatedAt: nowIso(),
        },
        updatedAt: new Date(),
      },
      $push: {
        editHistory: {
          action: "stop",
          at: new Date(),
          note: "Live tutor stopped by user.",
          data: {},
        },
      },
    },
    { new: true, runValidators: false, strict: false }
  );

  return {
    ...publicSessionFromBoard(updated),
    ok: true,
    message: "Live tutor stopped.",
  };
}

export async function getLiveTutorSession(input = {}) {
  const identity = getIdentity(input);

  const board = await findBoardBySession({
    sessionId: input.sessionId,
    ownerKey: identity.ownerKey,
    resourceId: input.resourceId,
  });

  if (!board) throw new Error("Live tutor session not found.");

  return {
    ...publicSessionFromBoard(board),
    ok: true,
  };
}

export async function listLiveTutorSessions(input = {}) {
  const identity = getIdentity(input);
  const query = {
    ownerKey: identity.ownerKey,
    isDeleted: { $ne: true },
  };

  if (input.resourceId && isObjectId(input.resourceId)) {
    query.resourceId = input.resourceId;
  }

  const boards = await LiveTutorBoard.find(query)
    .sort({ updatedAt: -1 })
    .limit(num(input.limit, 20));

  return {
    ok: true,
    sessions: boards.map((board) => publicSessionFromBoard(board)),
  };
}

export async function deleteLiveTutorSession(input = {}) {
  const identity = getIdentity(input);

  const board = await findBoardBySession({
    sessionId: input.sessionId,
    ownerKey: identity.ownerKey,
    resourceId: input.resourceId,
  });

  if (!board) throw new Error("Live tutor session not found.");

  await LiveTutorBoard.findOneAndUpdate(
    { _id: board._id },
    {
      $set: {
        isDeleted: true,
        deletedAt: new Date(),
        status: "archived",
      },
      $push: {
        editHistory: {
          action: "delete",
          at: new Date(),
          note: "Live tutor session archived/deleted.",
          data: {},
        },
      },
    },
    { runValidators: false, strict: false }
  );

  return {
    ok: true,
    message: "Live tutor session deleted.",
    sessionId: String(board._id),
  };
}

export const createLiveTutorSession = startLiveTutorSession;
export const startResourceLiveTutorSession = startLiveTutorSession;
export const controlResourceLiveTutorSession = controlLiveTutorSession;
export const interruptResourceLiveTutorSession = interruptLiveTutorSession;
export const pauseResourceLiveTutorSession = pauseLiveTutorSession;
export const resumeResourceLiveTutorSession = resumeLiveTutorSession;
export const stopResourceLiveTutorSession = stopLiveTutorSession;
export const getResourceLiveTutorSession = getLiveTutorSession;
export const listResourceLiveTutorSessions = listLiveTutorSessions;
export const deleteResourceLiveTutorSession = deleteLiveTutorSession;

export const simplifyLiveTutorSession = async (input = {}) =>
  interruptLiveTutorSession({
    ...input,
    action: "interrupt",
    interruptText:
      clean(input.interruptText || input.question) ||
      "Explain the current part more simply from the exact point.",
  });

export const goBackLiveTutorSession = async (input = {}) =>
  interruptLiveTutorSession({
    ...input,
    action: "interrupt",
    interruptText:
      clean(input.interruptText || input.question) ||
      "Go one step back and re-explain from there with a clearer board.",
  });

export const quizLiveTutorSession = async (input = {}) =>
  interruptLiveTutorSession({
    ...input,
    action: "interrupt",
    interruptText:
      clean(input.interruptText || input.question) ||
      "Quiz me on the current idea, then continue.",
  });

export default {
  startLiveTutorSession,
  createLiveTutorSession,
  controlLiveTutorSession,
  interruptLiveTutorSession,
  pauseLiveTutorSession,
  resumeLiveTutorSession,
  stopLiveTutorSession,
  getLiveTutorSession,
  listLiveTutorSessions,
  deleteLiveTutorSession,

  startResourceLiveTutorSession,
  controlResourceLiveTutorSession,
  interruptResourceLiveTutorSession,
  pauseResourceLiveTutorSession,
  resumeResourceLiveTutorSession,
  stopResourceLiveTutorSession,
  getResourceLiveTutorSession,
  listResourceLiveTutorSessions,
  deleteResourceLiveTutorSession,

  simplifyLiveTutorSession,
  goBackLiveTutorSession,
  quizLiveTutorSession,
};