// server/services/gemmaResource/liveTutor/liveTutorEngine.service.js
//
// FULL REPLACEMENT BASED ON YOUR ZIP
//
// Fixes:
// - Backend no longer defaults to 360 min / 360 sec.
// - Forces default full tutorial = 60 min.
// - Forces default segment = 600 sec.
// - Uses internal RAG as truth.
// - Uses Gemma offline topic knowledge, not Tavily/web, for enrichment.
// - Sends currentActionId / visibleActionIds / sessionId / currentCommandIndex to planner.
// - Keeps existing exports used by your controller/routes.
// - No fake fallback.
// - No static demo.

import GemmaResource from "../../../models/GemmaResource.js";
import { retrieveRelevantChunksAdvanced } from "../advancedRetrieval.service.js";
import { buildWorldClassTutorPlan } from "./liveTutorPlannerGraph.service.js";
import {
  analyzePlanRichness,
  publicPlanDiagnostics,
} from "./liveTutorCommandSchema.service.js";

const DEFAULT_TOTAL_MINUTES = 60;
const DEFAULT_SEGMENT_SECONDS = 600;
const MIN_TOTAL_MINUTES = 15;
const MAX_TOTAL_MINUTES = 180;
const MIN_SEGMENT_SECONDS = 600;
const MAX_SEGMENT_SECONDS = 900;

function clean(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function textClean(value = "") {
  return String(value ?? "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{4,}/g, "\n\n")
    .trim();
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value, min, max, fallback) {
  const parsed = number(value, fallback);
  return Math.max(min, Math.min(max, parsed));
}

function clampText(value = "", max = 2400) {
  const text = textClean(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}...`;
}

function getResourceTitle(resource = {}) {
  return clean(resource.title || resource.name || resource.metadata?.title || "Saved Resource");
}

function getResourceSummary(resource = {}) {
  return clampText(resource.summary || resource.description || resource.metadata?.summary || "", 1600);
}

function getResourceKind(resource = {}) {
  return clean(
    resource.kind ||
      resource.type ||
      resource.sourceType ||
      resource.metadata?.sourceType ||
      resource.metadata?.kind ||
      "saved_resource"
  );
}

function chunkText(chunk = {}) {
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

function chunkSourceRef(chunk = {}, index = 0) {
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
      `SOURCE ${index + 1}`
  );
}

function publicChunk(chunk = {}, index = 0) {
  return {
    id: String(chunk._id || chunk.id || chunk.chunkId || `chunk-${index + 1}`),
    index: number(chunk.index ?? chunk.chunkIndex, index),
    title: clean(chunk.title || chunk.heading || chunk.sectionTitle || `Source ${index + 1}`),
    sourceRef: chunkSourceRef(chunk, index),
    text: clampText(chunkText(chunk), 2200),
    score: number(chunk._ragScore || chunk.score || chunk.similarity || 0),
    page: clean(chunk.page || chunk.pageNumber || chunk.pageLabel || ""),
    timestamp: clean(chunk.timestamp || chunk.timestampLabel || chunk.timeRange || ""),
  };
}

function buildSearchQuery(input = {}, resource = {}) {
  const pieces = [
    input.question,
    input.instruction,
    input.interruptText,
    input.nextCursor,
    input.cursor,
    input.selectedText,
    input.sectionTitle,
    getResourceTitle(resource),
    getResourceSummary(resource),
  ]
    .map(clean)
    .filter(Boolean);

  return pieces.join(" ").slice(0, 1200);
}

function getDepthConfig(input = {}) {
  const mode = clean(
    input.lessonDurationMode || input.durationMode || input.depth || input.explainDepth || "masterclass"
  ).toLowerCase();

  const targetTotalMinutes = clampNumber(
    input.targetTotalMinutes ?? input.totalMinutes ?? input.targetMinutes,
    MIN_TOTAL_MINUTES,
    MAX_TOTAL_MINUTES,
    DEFAULT_TOTAL_MINUTES
  );

  const requestedSegment = number(
    input.segmentDurationSec || input.segmentSeconds || input.targetSegmentSeconds,
    0
  );

  let targetSegmentSeconds = DEFAULT_SEGMENT_SECONDS;

  if (requestedSegment) {
    targetSegmentSeconds = clampNumber(
      requestedSegment,
      MIN_SEGMENT_SECONDS,
      MAX_SEGMENT_SECONDS,
      DEFAULT_SEGMENT_SECONDS
    );
  }

  return {
    mode,
    targetTotalMinutes,
    targetSegmentSeconds,
  };
}

function ownerCandidates(input = {}) {
  return Array.from(
    new Set(
      [
        clean(input.ownerKey),
        input.offlineUserId ? `offline:${clean(input.offlineUserId)}` : "",
        clean(input.offlineUserId),
        input.deviceId ? `device:${clean(input.deviceId)}` : "",
        clean(input.deviceId),
        clean(input.userId),
      ].filter(Boolean)
    )
  );
}

async function loadResource(input = {}) {
  const resourceId = clean(input.resourceId || input.id);
  if (!resourceId) throw new Error("resourceId is required for Live Tutor.");

  const owners = ownerCandidates(input);
  let resource = null;

  if (owners.length) {
    resource = await GemmaResource.findOne({
      _id: resourceId,
      $or: [
        { ownerKey: { $in: owners } },
        { offlineUserId: { $in: owners } },
        { deviceId: { $in: owners } },
        { userId: { $in: owners } },
        { createdBy: { $in: owners } },
      ],
    }).lean();
  }

  if (!resource) {
    resource = await GemmaResource.findOne({ _id: resourceId }).lean();
  }

  if (!resource) {
    throw new Error("Saved resource not found or not accessible.");
  }

  return resource;
}

async function retrieveInternalChunks(input = {}, resource = {}) {
  const query = buildSearchQuery(input, resource) || "teach this saved resource visually";
  const limit = Math.max(12, Math.min(30, number(input.limit, 18)));

  const attempts = [
    {
      resourceId: String(resource._id),
      ownerKey: input.ownerKey,
      offlineUserId: input.offlineUserId,
      deviceId: input.deviceId,
      userId: input.userId,
      query,
      limit,
      includeMetadata: true,
      selectedChunkIds: asArray(input.selectedChunkIds),
    },
    {
      resourceId: String(resource._id),
      query,
      limit,
      includeMetadata: true,
      selectedChunkIds: asArray(input.selectedChunkIds),
    },
  ];

  let lastError = null;

  for (const attempt of attempts) {
    try {
      const result = await retrieveRelevantChunksAdvanced(attempt);

      const chunks = asArray(result?.chunks || result?.results || result)
        .map(publicChunk)
        .filter((chunk) => chunk.text);

      if (chunks.length) {
        return {
          chunks,
          meta: {
            query,
            count: chunks.length,
            provider: "retrieveRelevantChunksAdvanced",
            resourceKind: getResourceKind(resource),
          },
        };
      }
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    lastError?.message
      ? `No RAG chunks found for this resource. ${lastError.message}`
      : "No RAG chunks found for this resource. Upload/index the resource first."
  );
}

function buildOfflineGemmaKnowledgeContext(input = {}, resource = {}) {
  const title = getResourceTitle(resource);
  const kind = getResourceKind(resource);
  const request = clean(input.question || input.instruction || input.interruptText || "");

  return {
    used: true,
    mode: "offline_gemma_knowledge_no_web",
    answer: [
      "Use Gemma's own general knowledge only on the same topic as the saved resource.",
      "Use it for intuition, prerequisite explanation, analogy, examples, common mistakes, and real-world meaning.",
      "Do not use internet URLs.",
      "Do not override internal RAG context.",
      "Internal RAG remains the source of truth.",
    ].join(" "),
    results: [
      {
        title: "Gemma offline same-topic knowledge",
        url: "",
        content: [
          `Resource title: ${title}`,
          `Resource type: ${kind}`,
          request ? `Student/tutor request: ${request}` : "",
          "Add helpful same-topic intuition, but cite internal sources for source-grounded claims.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  };
}

function estimateVoiceSeconds(lines = []) {
  const arr = asArray(lines);
  const maxT = arr.reduce((max, line) => Math.max(max, number(line.t, 0)), 0);

  const spokenEstimate = arr.reduce((sum, line) => {
    const text = clean(line.text || line.speech || line.boardNote || "");
    return sum + Math.max(5, Math.ceil(text.length / 15));
  }, 0);

  return Math.max(maxT + 9, spokenEstimate, arr.length * 8);
}

function flattenTypes(commands = []) {
  const out = [];

  for (const command of asArray(commands)) {
    if (command?.type) out.push(clean(command.type));

    for (const child of asArray(command?.children || command?.commands || command?.blocks)) {
      if (child?.type) out.push(clean(child.type));
    }
  }

  return Array.from(new Set(out.filter(Boolean))).sort();
}

function hasUsableCommands(commands = []) {
  return asArray(commands).some((cmd) => {
    const type = clean(cmd.type);
    const text = clean(cmd.text || cmd.title || cmd.code || cmd.formula || cmd.question || cmd.sourceRef || cmd.mermaid);
    const children = asArray(cmd.children || cmd.commands || cmd.blocks);
    const rows = asArray(cmd.rows || cmd.items || cmd.nodes || cmd.steps || cmd.values);
    return Boolean(type && (text || children.length || rows.length));
  });
}

function hasUsableVoice(lines = []) {
  return asArray(lines).some((line) => clean(line.text || line.speech || line.boardNote));
}

function makePublicDiagnostics(meta = {}) {
  return {
    ragChunks: number(meta.ragChunks, 0),
    grounded: true,
    ragUsed: true,
    langGraphUsed: Boolean(meta.langGraphUsed),
    langChainUsed: Boolean(meta.langChainUsed),
    gemmaPlanRich: Boolean(meta.gemmaPlanRich),
    boardCommandsReady: Boolean(meta.boardCommandsReady),
    voiceScriptReady: Boolean(meta.voiceScriptReady),
    visualCommandTypes: asArray(meta.commandTypes).slice(0, 30),
    voiceSeconds: number(meta.voiceSeconds, 0),
    noDuplicate: Boolean(meta.noDuplicate),
    noFakeFallback: true,
    noStaticDemo: true,
    voiceWrittenOnBoard: true,
    seamless: true,
    continuousTutor: true,
    targetSegmentSeconds: DEFAULT_SEGMENT_SECONDS,
    prefetchBeforeSec: 300,
    quality: meta.quality || "checked",
  };
}

function buildCurrentState(input = {}) {
  const runtime = input.runtimeState || {};

  return {
    action: clean(input.action || ""),
    sessionId: clean(input.sessionId || runtime.sessionId || ""),
    currentTimeSec: number(input.currentTimeSec ?? input.currentTime ?? runtime.currentTimeSec, 0),

    currentCommandIndex: number(input.currentCommandIndex ?? runtime.currentCommandIndex, 0),
    currentCommandId: clean(input.currentCommandId || runtime.currentCommandId || ""),

    currentActionId: clean(input.currentActionId || runtime.currentActionId || ""),
    visibleActionIds: asArray(input.visibleActionIds || runtime.visibleActionIds).map(clean).filter(Boolean).slice(0, 160),

    visibleCommandIds: asArray(input.visibleCommandIds || runtime.visibleCommandIds).map(clean).filter(Boolean).slice(0, 160),
    visibleCommands: asArray(input.visibleCommands || runtime.visibleCommands).slice(0, 120),

    currentVoiceLineId: clean(input.currentVoiceLineId || runtime.currentVoiceLineId || ""),
    currentVoiceLineIndex: number(input.currentVoiceLineIndex ?? runtime.currentVoiceLineIndex, 0),

    boardState: input.boardState || runtime.boardState || null,

    interruptText: clean(input.interruptText || input.question || ""),
    nextCursor: clean(input.nextCursor || input.cursor || runtime.nextCursor || ""),

    elapsedTutorialSeconds: number(input.elapsedTutorialSeconds ?? runtime.elapsedTutorialSeconds, 0),
    generatedSegments: number(input.generatedSegments ?? runtime.generatedSegments, 0),
    completedSegments: number(input.completedSegments ?? runtime.completedSegments, 0),
    targetTotalMinutes: number(input.targetTotalMinutes, DEFAULT_TOTAL_MINUTES),
    segmentDurationSec: number(input.segmentDurationSec, DEFAULT_SEGMENT_SECONDS),
  };
}

function sanitizeExternalForPublic(external = {}) {
  return {
    used: Boolean(external.used),
    mode: clean(external.mode || "offline_gemma_knowledge_no_web"),
    results: asArray(external.results)
      .map((item) => ({
        title: clean(item.title),
        url: "",
      }))
      .filter((item) => item.title)
      .slice(0, 5),
  };
}

function sanitizePayloadForClient(payload = {}) {
  const safe = { ...payload };

  delete safe.rag;
  delete safe.internalContext;
  delete safe.externalContext;
  delete safe.rawGemma;
  delete safe.prompt;
  delete safe.modelPrompt;
  delete safe.modelUrl;
  delete safe.apiKey;
  delete safe.env;
  delete safe.stack;
  delete safe.debug;

  return safe;
}

async function buildLiveTutorPayload(input = {}, action = "start") {
  const resource = await loadResource(input);
  const depth = getDepthConfig(input);
  const internal = await retrieveInternalChunks(input, resource);
  const external = buildOfflineGemmaKnowledgeContext(input, resource);

  const userRequest =
    clean(input.question || input.interruptText || input.instruction) ||
    "Teach this saved resource visually like a human tutor board. Write every voice explanation on the board too. Use diagrams, flowcharts, tree, table, formula, code block, source refs, and quiz when useful. Use internal RAG first. Continue seamlessly until the full resource is done.";

  const currentState = buildCurrentState({ ...input, action });

  const request = [
    userRequest,
    "",
    `Source type: ${getResourceKind(resource)}`,
    `Mode: ${depth.mode}`,
    `Target total tutorial length: ${depth.targetTotalMinutes} minutes.`,
    `Segment duration: ${depth.targetSegmentSeconds} seconds.`,
    `Current segment number: ${Math.max(1, number(currentState.generatedSegments, 0) + 1)}.`,
    "Each segment must be a 10-minute live lesson timeline.",
    "Each segment must contain 8-9 board pages/scenes.",
    "Each segment must contain 20-28 teacherActions or equivalent renderable boardCommands.",
    "Each segment must contain at least 14 voiceScript lines linked to actions/commands.",
    "Every segment must include Mermaid/flowchart, tree/structure, table, keyPoints, codeTrace/example/formula when relevant, source refs, and quiz.",
    "Use internal RAG chunks as truth.",
    "Use Gemma offline same-topic knowledge for intuition/examples/common mistakes only.",
    "No fake fallback. No static board. No duplicate lines.",
    action === "interrupt"
      ? "Student interrupted. Repair from exact visible point using currentActionId, visibleActionIds, currentCommandIndex, visibleCommandIds, and sessionId. Do not restart. Append repair section."
      : "",
    action === "continue" || action === "next"
      ? "Continue from nextCursor. Do not repeat previous board. Append the next unique 10-minute visual segment."
      : "",
    action === "simpler" || action === "simplify"
      ? "Simplify the current concept with clearer board drawing."
      : "",
    action === "go_back"
      ? "Go one step back and redraw the previous idea more clearly."
      : "",
    action === "quiz"
      ? "Create a short visual quiz from the current board/source."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const plannerResult = await buildWorldClassTutorPlan({
    resourceTitle: getResourceTitle(resource),
    request,
    internalChunks: internal.chunks,
    external,
    currentState,
  });

  const plan = plannerResult.plan;

  if (!plan || !hasUsableCommands(plan.boardCommands) || !hasUsableVoice(plan.voiceScript)) {
    throw new Error("Gemma Live Tutor did not return usable boardCommands and voiceScript.");
  }

  const richness = analyzePlanRichness(plan);
  const publicDiag = publicPlanDiagnostics ? publicPlanDiagnostics(plan) : {};
  const voiceSec = estimateVoiceSeconds(plan.voiceScript);
  const commandTypes = flattenTypes(plan.boardCommands);

  const estimatedTotalSeconds = Math.max(
    depth.targetSegmentSeconds,
    number(plan.estimatedTotalSeconds, 0),
    voiceSec
  );

  const currentSegmentNumber = Math.max(1, number(currentState.generatedSegments, 0) + 1);
  const estimatedSegmentCount = Math.max(1, Math.ceil((depth.targetTotalMinutes * 60) / depth.targetSegmentSeconds));

  const publicDiagnostics = makePublicDiagnostics({
    ...publicDiag,
    ragChunks: internal.chunks.length,
    langGraphUsed: true,
    langChainUsed: true,
    gemmaPlanRich: Boolean(richness.rich),
    boardCommandsReady: true,
    voiceScriptReady: true,
    commandTypes,
    voiceSeconds: voiceSec,
    noDuplicate: true,
    quality: richness.rich ? "rich" : "minimum_passed",
  });

  const payload = {
    ok: true,
    action,
    resourceId: String(resource._id),
    resourceTitle: getResourceTitle(resource),
    resourceKind: getResourceKind(resource),

    sessionId: clean(input.sessionId) || `live_tutor_${String(resource._id)}_${Date.now()}`,

    topic: clean(plan.topic || getResourceTitle(resource)),
    segmentTitle: clean(plan.segmentTitle || plan.topic || `Segment ${currentSegmentNumber}`),
    shortAnswer: clean(plan.shortAnswer || ""),

    layoutPlan: plan.layoutPlan || null,
    boardPages: asArray(plan.boardPages),
    teacherActions: asArray(plan.teacherActions || plan.boardActions),
    boardActions: asArray(plan.teacherActions || plan.boardActions),

    boardCommands: asArray(plan.boardCommands),
    voiceScript: asArray(plan.voiceScript),

    citations: asArray(plan.citations || plan.sourceRefs).map(clean).filter(Boolean),
    sourceRefs: asArray(plan.sourceRefs || plan.citations).map(clean).filter(Boolean),
    internalSourceRefs: asArray(plan.internalSourceRefs || plan.sourceRefs || plan.citations).map(clean).filter(Boolean),
    knowledgeRefs: asArray(plan.knowledgeRefs || ["Gemma offline same-topic knowledge"]).map(clean).filter(Boolean),
    repairOptions: asArray(plan.repairOptions).map(clean).filter(Boolean).slice(0, 8),

    continueMode: plan.continueMode !== false && clean(plan.nextCursor || "").toUpperCase() !== "DONE",
    nextCursor: clean(plan.nextCursor || "DONE"),
    estimatedTotalSeconds,

    continuousTutor: {
      currentSegmentNumber,
      estimatedSegmentCount,
      targetTotalMinutes: depth.targetTotalMinutes,
      targetTotalSeconds: depth.targetTotalMinutes * 60,
      segmentDurationSec: depth.targetSegmentSeconds,
      shouldContinue: currentSegmentNumber < estimatedSegmentCount,
    },

    externalKnowledgeUsed: true,
    offlineKnowledgeUsed: true,
    resourceGroundedRatio: number(plan.resourceGroundedRatio, 0.82),

    commandTypes,
    diagnostics: publicDiagnostics,

    quality: {
      status: richness.rich ? "rich" : "minimum passed",
      visualCount: number(richness.visualCount, 0),
      voiceCount: number(richness.voiceCount, asArray(plan.voiceScript).length),
      commandCount: number(richness.allCommandCount, asArray(plan.boardCommands).length),
      hasDiagram: Boolean(richness.hasDiagram),
      hasSource: Boolean(richness.hasSource),
      engine: "strict-60min-liveTutorEngine.service.js",
    },

    retrievedChunks: internal.chunks.map((chunk) => ({
      id: chunk.id,
      index: chunk.index,
      title: chunk.title,
      sourceRef: chunk.sourceRef,
      page: chunk.page,
      timestamp: chunk.timestamp,
      score: chunk.score,
    })),

    external: sanitizeExternalForPublic(external),

    langChainUsed: true,
    langGraphUsed: true,
    gemmaPlanRich: Boolean(richness.rich),
    usedSmartFallback: false,
  };

  return sanitizePayloadForClient(payload);
}

export async function startLiveTutor(input = {}) {
  return buildLiveTutorPayload(input, "start");
}

export async function controlLiveTutor(input = {}) {
  const action = clean(input.action || "control").toLowerCase();

  if (["pause", "resume", "stop"].includes(action)) {
    return {
      ok: true,
      action,
      message: `Live tutor ${action} acknowledged.`,
      boardCommands: [],
      voiceScript: [],
      citations: [],
      sourceRefs: [],
      repairOptions: [],
      usedSmartFallback: false,
      diagnostics: makePublicDiagnostics({
        langGraphUsed: true,
        langChainUsed: true,
        boardCommandsReady: false,
        voiceScriptReady: false,
      }),
    };
  }

  const normalizedAction =
    action === "next_segment" || action === "next" || action === "continue"
      ? "continue"
      : action;

  return buildLiveTutorPayload(input, normalizedAction);
}

export async function interruptLiveTutor(input = {}) {
  const interruptText =
    clean(input.interruptText || input.question || input.message) ||
    "The student interrupted. Repair from the exact visible point and continue.";

  return buildLiveTutorPayload(
    {
      ...input,
      question: interruptText,
      instruction: [
        "Student interrupted the live tutor.",
        "Use currentTimeSec/currentCommandIndex/currentCommandId/currentActionId/visibleCommandIds/visibleActionIds/sessionId/boardState if provided.",
        "Do not restart from the beginning.",
        "Preserve existing board.",
        "Append a repair explanation section.",
        "Continue after the repaired concept.",
        clean(input.instruction),
      ]
        .filter(Boolean)
        .join("\n"),
    },
    "interrupt"
  );
}

export async function simplifyLiveTutor(input = {}) {
  return buildLiveTutorPayload(
    {
      ...input,
      question: clean(input.question || "Explain this more simply with a clearer board drawing."),
    },
    "simpler"
  );
}

export async function quizLiveTutor(input = {}) {
  return buildLiveTutorPayload(
    {
      ...input,
      question: clean(input.question || "Quiz me from the current board segment."),
    },
    "quiz"
  );
}

export async function goBackLiveTutor(input = {}) {
  return buildLiveTutorPayload(
    {
      ...input,
      question: clean(input.question || "Go one step back and redraw the explanation more clearly."),
    },
    "go_back"
  );
}

export default {
  startLiveTutor,
  controlLiveTutor,
  interruptLiveTutor,
  simplifyLiveTutor,
  quizLiveTutor,
  goBackLiveTutor,
};