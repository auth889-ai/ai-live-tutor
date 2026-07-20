import crypto from "crypto";

import LiveTutorBoard from "../../models/LiveTutorBoard.js";
import LiveTutorInteraction from "../../models/LiveTutorInteraction.js";

import {
  explainLiveTutorMoment,
  evaluateExplainBack,
  handleInterrupt,
  repairConfusion,
} from "./liveTutorGraph.service.js";

import { runLiveTutorLangGraphWorkflow } from "./liveTutorLangGraph.workflow.js";

import {
  retrieveLiveTutorContext,
  saveLiveTutorMemory,
  indexLiveTutorContext,
} from "./liveTutorRag.service.js";

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function longClean(value = "") {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function trimText(value = "", max = 3000) {
  const text = longClean(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}...`;
}

function uid(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function inferBoardMode(payload = {}, response = {}) {
  if (payload.mode === "dry_run" || response?.dryRun?.available) return "code_dry_run";
  if (payload.mode === "explain_back") return "explain_back";
  if (payload.mode === "repair_confusion") return "repair";

  if (payload.selectedRect?.width > 0 && payload.selectedRect?.height > 0) {
    return "marked_screen";
  }

  if (payload.selectedText) return "selected_text";
  if (payload.platform === "youtube") return "current_video_moment";

  return "webpage_section";
}

function buildSourceContext(payload = {}) {
  const transcriptWindow = payload.transcriptWindow || {};

  return {
    sourceType: payload.platform || "unknown",
    url: clean(payload.url),
    title: clean(payload.title),
    videoId: clean(payload.videoId),
    timestampSeconds: safeNumber(payload.timestampSeconds),
    durationSeconds: safeNumber(payload.durationSeconds),

    currentCaption: trimText(payload.currentCaption || transcriptWindow.current || "", 1200),
    transcriptBefore: trimText(transcriptWindow.before || "", 2500),
    transcriptCurrent: trimText(transcriptWindow.current || payload.currentCaption || "", 1800),
    transcriptAfter: trimText(transcriptWindow.after || "", 2500),

    selectedText: trimText(payload.selectedText || "", 2500),
    visibleTextPreview: trimText(payload.visibleText || payload.pageText || "", 2500),

    markedRect: payload.selectedRect || {},
    markedElements: safeArray(payload.markedElements).slice(0, 12),

    screenshotHash: clean(payload.screenshotHash || payload.cropHash || ""),
  };
}

function createHeadingBlock(title = "", order = 0) {
  return {
    blockId: uid("block"),
    type: "heading",
    title,
    content: title,
    order,
    editable: true,
    generatedBy: "ai",
    style: { emphasis: "important" },
  };
}

function createTextBlock({ title = "", content = "", order = 0, emphasis = "normal" }) {
  return {
    blockId: uid("block"),
    type: "text",
    title,
    content,
    order,
    editable: true,
    generatedBy: "ai",
    style: { emphasis },
  };
}

function createFormulaBlock({ title = "Formula", formula = "", explanation = "", order = 0 }) {
  return {
    blockId: uid("block"),
    type: "formula",
    title,
    content: formula,
    data: { formula, explanation },
    order,
    editable: true,
    generatedBy: "ai",
    style: { emphasis: "important" },
  };
}

function createFlowBlock({ title = "Concept flow", nodes = [], edges = [], order = 0 }) {
  return {
    blockId: uid("block"),
    type: "flow",
    title,
    content: "",
    data: { nodes, edges },
    order,
    editable: true,
    generatedBy: "ai",
    style: { emphasis: "normal" },
  };
}

function createDryRunBlock({ dryRun = {}, order = 0 }) {
  return {
    blockId: uid("block"),
    type: "dry_run_table",
    title: clean(dryRun.title) || "Dry run",
    content: clean(dryRun.stateSummary),
    data: {
      problemType: dryRun.problemType || "",
      columns: safeArray(dryRun.columns),
      rows: safeArray(dryRun.rows),
      currentPointer: dryRun.currentPointer || "",
      stateSummary: dryRun.stateSummary || "",
      complexity: dryRun.complexity || {},
    },
    order,
    editable: true,
    generatedBy: "ai",
    style: { emphasis: "important" },
  };
}

function extractArrayValuesFromDryRun(dryRun = {}) {
  const rows = safeArray(dryRun.rows);
  const joined = JSON.stringify(rows);

  const arrayLike =
    joined.match(/\bnums\s*[:=]\s*\[([0-9,\s-]+)\]/i) ||
    joined.match(/\barr\s*[:=]\s*\[([0-9,\s-]+)\]/i) ||
    joined.match(/\barray\s*[:=]\s*\[([0-9,\s-]+)\]/i) ||
    joined.match(/\[([0-9,\s-]{3,})\]/);

  if (!arrayLike?.[1]) return [];

  return arrayLike[1]
    .split(",")
    .map((x) => clean(x))
    .filter(Boolean)
    .slice(0, 80);
}

function createArraySimulationBlock({ dryRun = {}, order = 0 }) {
  const values = extractArrayValuesFromDryRun(dryRun);
  if (!values.length) return null;

  return {
    blockId: uid("block"),
    type: "array_simulation",
    title: "Array / pointer simulation",
    content: dryRun.currentPointer || "",
    data: {
      values,
      pointer: dryRun.currentPointer || "",
      rows: safeArray(dryRun.rows),
    },
    order,
    editable: true,
    generatedBy: "ai",
    style: { emphasis: "normal" },
  };
}

function createHashMapSimulationBlock({ dryRun = {}, order = 0 }) {
  const rows = safeArray(dryRun.rows);
  const latest = rows[rows.length - 1] || {};

  const candidates = [
    latest.mapAfter,
    latest["map after"],
    latest.hashmap,
    latest.map,
    latest.state,
    dryRun.stateSummary,
    JSON.stringify(rows).match(/\{[^{}]{2,200}\}/)?.[0],
  ]
    .filter(Boolean)
    .join(" ");

  const match = candidates.match(/\{([^}]+)\}/);
  if (!match?.[1]) return null;

  const entries = match[1]
    .split(",")
    .map((pair) => {
      const [key, value] = pair.split(":").map((x) => clean(x));
      return key ? { key, value: value || "" } : null;
    })
    .filter(Boolean)
    .slice(0, 40);

  if (!entries.length) return null;

  return {
    blockId: uid("block"),
    type: "hashmap_simulation",
    title: "HashMap / memory state",
    content: "",
    data: { entries, rows },
    order,
    editable: true,
    generatedBy: "ai",
    style: { emphasis: "normal" },
  };
}

function createRepairBlock({ misconceptionCheck = {}, order = 0 }) {
  const content = [
    misconceptionCheck.likelyConfusion
      ? `Likely confusion: ${misconceptionCheck.likelyConfusion}`
      : "",
    misconceptionCheck.wrongMentalModel
      ? `Wrong mental model: ${misconceptionCheck.wrongMentalModel}`
      : "",
    misconceptionCheck.repairExplanation
      ? `Repair: ${misconceptionCheck.repairExplanation}`
      : "",
    misconceptionCheck.askBackQuestion
      ? `Check question: ${misconceptionCheck.askBackQuestion}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!content) return null;

  return {
    blockId: uid("block"),
    type: "repair",
    title: "Weak-part repair",
    content,
    data: misconceptionCheck,
    order,
    editable: true,
    generatedBy: "ai",
    style: { emphasis: "weak" },
  };
}

function createThinkingBlock({ thinkingScore = {}, order = 0 }) {
  if (!thinkingScore?.reason && !thinkingScore?.nextImprovement) return null;

  return {
    blockId: uid("block"),
    type: "text",
    title: `Thinking score: ${safeNumber(thinkingScore.score)} / 100`,
    content: [
      thinkingScore.level ? `Level: ${thinkingScore.level}` : "",
      thinkingScore.reason ? `Reason: ${thinkingScore.reason}` : "",
      thinkingScore.evidence ? `Evidence: ${thinkingScore.evidence}` : "",
      thinkingScore.nextImprovement ? `Next improvement: ${thinkingScore.nextImprovement}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    data: thinkingScore,
    order,
    editable: true,
    generatedBy: "ai",
    style: { emphasis: "success" },
  };
}

function createExplainBackBlock({ explainBackEvaluation = {}, order = 0 }) {
  const has =
    explainBackEvaluation.studentClaimSummary ||
    safeArray(explainBackEvaluation.correctParts).length ||
    safeArray(explainBackEvaluation.missingParts).length ||
    safeArray(explainBackEvaluation.wrongParts).length ||
    explainBackEvaluation.improvedAnswer;

  if (!has) return null;

  return {
    blockId: uid("block"),
    type: "repair",
    title: `Explain-back evaluation: ${safeNumber(explainBackEvaluation.score)} / 100`,
    content: [
      explainBackEvaluation.studentClaimSummary
        ? `Student claim: ${explainBackEvaluation.studentClaimSummary}`
        : "",
      safeArray(explainBackEvaluation.correctParts).length
        ? `Correct: ${explainBackEvaluation.correctParts.join("; ")}`
        : "",
      safeArray(explainBackEvaluation.missingParts).length
        ? `Missing: ${explainBackEvaluation.missingParts.join("; ")}`
        : "",
      safeArray(explainBackEvaluation.wrongParts).length
        ? `Wrong: ${explainBackEvaluation.wrongParts.join("; ")}`
        : "",
      explainBackEvaluation.improvedAnswer
        ? `Improved answer: ${explainBackEvaluation.improvedAnswer}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    data: explainBackEvaluation,
    order,
    editable: true,
    generatedBy: "ai",
    style: { emphasis: "weak" },
  };
}

function createQuizBlock({ suggestedPractice = [], followUpQuestion = "", order = 0 }) {
  const items = safeArray(suggestedPractice);

  if (!items.length && !followUpQuestion) return null;

  return {
    blockId: uid("block"),
    type: "quiz",
    title: "Check your understanding",
    content: followUpQuestion || "",
    data: {
      questions: items,
      followUpQuestion,
    },
    order,
    editable: true,
    generatedBy: "ai",
    style: { emphasis: "normal" },
  };
}

function createSourcesBlock({ sourcesUsed = [], order = 0 }) {
  const sources = safeArray(sourcesUsed).slice(0, 10);

  if (!sources.length) return null;

  return {
    blockId: uid("block"),
    type: "text",
    title: "Evidence used",
    content: sources
      .map((s, i) => {
        return `${i + 1}. ${s.sourceType || "source"} — ${s.label || ""}\n${s.preview || ""}`;
      })
      .join("\n\n"),
    data: { sources },
    order,
    editable: false,
    generatedBy: "system",
    style: { emphasis: "normal" },
  };
}

function buildBoardBlocksFromResponse(response = {}, workflow = {}) {
  const blocks = [];
  let order = 0;

  blocks.push(createHeadingBlock(response.headline || "Focused Tutor Board", order++));

  if (response.shortAnswer) {
    blocks.push(
      createTextBlock({
        title: "Short answer",
        content: response.shortAnswer,
        order: order++,
        emphasis: "important",
      })
    );
  }

  if (response.explanation) {
    blocks.push(
      createTextBlock({
        title: "Human tutor explanation",
        content: response.explanation,
        order: order++,
      })
    );
  }

  const scratchpad = safeArray(response.tutorScratchpad);

  for (const item of scratchpad.slice(0, 10)) {
    if (item.formula) {
      blocks.push(
        createFormulaBlock({
          title: item.label || "Formula",
          formula: item.formula,
          explanation: item.detail || item.value || "",
          order: order++,
        })
      );
    } else if (item.label || item.detail || item.value) {
      blocks.push(
        createTextBlock({
          title: item.label || "Tutor note",
          content: [item.value, item.detail].filter(Boolean).join("\n"),
          order: order++,
        })
      );
    }
  }

  const visual = safeArray(response.visualBreakdown);

  if (visual.length) {
    blocks.push({
      blockId: uid("block"),
      type: "diagram",
      title: "Step-by-step visual explanation",
      content: "",
      data: {
        steps: visual.map((step, index) => ({
          id: `step_${index + 1}`,
          step: step.step || index + 1,
          title: step.title || `Step ${index + 1}`,
          detail: step.detail || "",
          kind: step.kind || "concept",
          highlight: step.highlight || "",
        })),
      },
      order: order++,
      editable: true,
      generatedBy: "ai",
      style: { emphasis: "important" },
    });
  }

  if (response.dryRun?.available) {
    blocks.push(createDryRunBlock({ dryRun: response.dryRun, order: order++ }));

    const arrayBlock = createArraySimulationBlock({
      dryRun: response.dryRun,
      order: order++,
    });

    if (arrayBlock) blocks.push(arrayBlock);

    const mapBlock = createHashMapSimulationBlock({
      dryRun: response.dryRun,
      order: order++,
    });

    if (mapBlock) blocks.push(mapBlock);
  }

  if (response.roadmap?.nodes?.length) {
    blocks.push(
      createFlowBlock({
        title: "Current concept flow",
        nodes: response.roadmap.nodes,
        edges: response.roadmap.edges || [],
        order: order++,
      })
    );
  }

  const explainBackBlock = createExplainBackBlock({
    explainBackEvaluation: response.explainBackEvaluation || {},
    order: order++,
  });

  if (explainBackBlock) blocks.push(explainBackBlock);

  const repairBlock = createRepairBlock({
    misconceptionCheck: response.misconceptionCheck || {},
    order: order++,
  });

  if (repairBlock) blocks.push(repairBlock);

  const thinkingBlock = createThinkingBlock({
    thinkingScore: response.thinkingScore || {},
    order: order++,
  });

  if (thinkingBlock) blocks.push(thinkingBlock);

  const quizBlock = createQuizBlock({
    suggestedPractice: response.suggestedPractice || [],
    followUpQuestion: response.followUpQuestion || "",
    order: order++,
  });

  if (quizBlock) blocks.push(quizBlock);

  const sourcesBlock = createSourcesBlock({
    sourcesUsed: response.sourcesUsed || [],
    order: order++,
  });

  if (sourcesBlock) blocks.push(sourcesBlock);

  if (workflow?.retrievedContext?.length) {
    blocks.push(
      createTextBlock({
        title: "Retrieved memory/RAG context",
        content: workflow.retrievedContext
          .slice(0, 5)
          .map((hit, index) => {
            return `${index + 1}. ${hit.source || "memory"} · score=${hit.score || 0}\n${
              hit.preview || hit.text || ""
            }`;
          })
          .join("\n\n"),
        order: order++,
        emphasis: "normal",
      })
    );
  }

  return blocks;
}

function buildReplayTimeline(blocks = [], voiceScript = {}) {
  const timeline = [];
  let atMs = 0;

  if (voiceScript.shortSpeech || voiceScript.fullSpeech) {
    timeline.push({
      stepId: uid("replay"),
      atMs,
      action: "speak",
      blockId: "",
      text: voiceScript.shortSpeech || voiceScript.fullSpeech,
      data: null,
    });

    atMs += 500;
  }

  for (const block of blocks) {
    timeline.push({
      stepId: uid("replay"),
      atMs,
      action: "write_block",
      blockId: block.blockId,
      text: block.title || block.content || "",
      data: { blockType: block.type },
    });

    atMs += block.type === "dry_run_table" || block.type.includes("simulation") ? 1800 : 1100;

    if (block.type === "dry_run_table" || block.type.includes("simulation")) {
      timeline.push({
        stepId: uid("replay"),
        atMs,
        action: "advance_simulation",
        blockId: block.blockId,
        text: block.content || "",
        data: block.data || {},
      });

      atMs += 1600;
    }

    if (block.type === "quiz") {
      timeline.push({
        stepId: uid("replay"),
        atMs,
        action: "pause_for_student",
        blockId: block.blockId,
        text: "Pause for explain-back/check question.",
        data: null,
      });
    }
  }

  return timeline;
}

function buildVoiceScript(response = {}, payload = {}, workflow = {}) {
  const voicePlan = workflow.voicePlan || {};
  const languageHint = voicePlan.language || payload.languageHint || "auto";

  const speechParts = [
    response.shortAnswer,
    response.explanation
      ? response.explanation.split(/(?<=[.!?।])\s+/).slice(0, 5).join(" ")
      : "",
    response.misconceptionCheck?.askBackQuestion || response.followUpQuestion || "",
  ].filter(Boolean);

  const fullSpeech = trimText(speechParts.join(" "), 3000);

  return {
    language: languageHint,
    shortSpeech: trimText(response.shortAnswer || response.headline || "", 500),
    fullSpeech,
    interruptResumeLine:
      languageHint === "bangla"
        ? "ঠিক আছে, এখন আমরা আগের বোর্ডের জায়গা থেকে আবার চালিয়ে যাই।"
        : "Okay, now let’s resume from the same board point.",
    askBackPrompt:
      response.misconceptionCheck?.askBackQuestion || response.followUpQuestion || "",
    estimatedSeconds: Math.ceil(fullSpeech.split(/\s+/).filter(Boolean).length / 2.2),
  };
}

async function createBoardFromTutorResult({ payload = {}, tutorResult = {}, workflow = {} }) {
  const response = tutorResult.response || {};
  const boardMode = inferBoardMode(payload, response);
  const blocks = buildBoardBlocksFromResponse(response, workflow);
  const voiceScript = buildVoiceScript(response, payload, workflow);
  const replayTimeline = buildReplayTimeline(blocks, voiceScript);

  const page = {
    pageId: uid("page"),
    title: response.headline || "Focused Tutor Board",
    purpose:
      boardMode === "code_dry_run"
        ? "dry_run"
        : boardMode === "explain_back"
          ? "explain_back"
          : boardMode === "repair"
            ? "repair_confusion"
            : "explain_marked_area",
    blocks,
    autoExpanded: true,
  };

  const board = await LiveTutorBoard.create({
    userId: payload.userId || "guest",
    deviceId: payload.deviceId || "web",
    sessionKey: payload.sessionKey || tutorResult.sessionKey,

    interactionId: tutorResult.interactionId || null,

    title: response.headline || "Live Tutor Board",
    status: "active",
    sourceContext: buildSourceContext(payload),
    boardMode,
    pages: [page],
    voiceScript,
    replayTimeline,
    weakConcepts: response.weakConcepts || workflow.conceptTags || [],
    masteredConcepts: response.masteredConcepts || [],
    rawAiPlan: {
      response,
      workflow: {
        runId: workflow.runId,
        mode: workflow.mode,
        platform: workflow.platform,
        focusInstruction: workflow.focusInstruction,
        conceptTags: workflow.conceptTags,
        tutorStrategy: workflow.tutorStrategy,
        boardPlan: workflow.boardPlan,
        simulationPlan: workflow.simulationPlan,
        retrievedContext: workflow.retrievedContext,
        vision: workflow.vision,
        voicePlan: workflow.voicePlan,
        memoryResult: workflow.memoryResult,
        auditTrail: workflow.auditTrail,
      },
    },
  });

  board.addEditHistory({
    editedBy: "ai",
    action: "create",
    after: {
      blockCount: blocks.length,
      boardMode,
      workflowRunId: workflow.runId || "",
      ragHits: safeArray(workflow.retrievedContext).length,
    },
  });

  await board.save();

  return board;
}

async function runFinalTutorBrainByMode(payload = {}) {
  const mode = payload.mode || "explain_frame";

  if (mode === "explain_back") return evaluateExplainBack(payload);
  if (mode === "interrupt") return handleInterrupt(payload);
  if (mode === "repair_confusion") return repairConfusion(payload);

  return explainLiveTutorMoment(payload);
}

function buildFinalBrainPayload(payload = {}, workflow = {}) {
  return {
    ...payload,

    workflowContext: {
      runId: workflow.runId,
      mode: workflow.mode,
      platform: workflow.platform,
      focusInstruction: workflow.focusInstruction,
      transcriptContext: workflow.transcriptContext,
      conceptTags: workflow.conceptTags || [],
      tutorStrategy: workflow.tutorStrategy,
      boardPlan: workflow.boardPlan,
      simulationPlan: workflow.simulationPlan,
      voicePlan: workflow.voicePlan,
      vision: workflow.vision,
      auditTrail: workflow.auditTrail || [],
    },

    workflow: {
      runId: workflow.runId,
      retrievedContext: workflow.retrievedContext || [],
      conceptTags: workflow.conceptTags || [],
      vision: workflow.vision,
    },

    retrievedContext: workflow.retrievedContext || [],
    conceptTags: workflow.conceptTags || [],
  };
}

async function indexBoardMemoryAfterCreation({ payload = {}, tutorResult = {}, workflow = {}, board = null }) {
  try {
    const result = await indexLiveTutorContext({
      payload,
      tutorResponse: tutorResult.response || {},
      board,
      conceptTags: workflow.conceptTags || tutorResult.response?.weakConcepts || [],
      weakConcepts: tutorResult.response?.weakConcepts || workflow.conceptTags || [],
    });

    return result;
  } catch (error) {
    return {
      ok: false,
      indexed: 0,
      message: error.message,
    };
  }
}

export async function runLiveTutorOrchestrator(payload = {}) {
  const workflow = await runLiveTutorLangGraphWorkflow({
    payload,
    tools: {
      retrieveContext: retrieveLiveTutorContext,

      analyzeVision: async ({ selectedRect, platform, timestampSeconds }) => ({
        available: Boolean(payload.screenshotDataUrl),
        used: Boolean(payload.screenshotDataUrl),
        observations: payload.markedElements || [],
        focus: payload.selectedRect?.width
          ? "Marked rectangle was captured and final Gemma vision call will receive crop/full image through liveTutorGraph.service.js."
          : "Final Gemma vision call will receive full screenshot if available.",
        selectedRect,
        platform,
        timestampSeconds,
        warning: "",
      }),

      generateTutorResponse: async ({ payload: p, retrievedContext, conceptTags, vision, ...graphState }) => {
        const finalPayload = buildFinalBrainPayload(
          {
            ...p,
            mode: p.mode || payload.mode || "explain_frame",
            retrievedContext,
            conceptTags,
          },
          {
            ...graphState,
            retrievedContext,
            conceptTags,
            vision,
          }
        );

        const result = await runFinalTutorBrainByMode(finalPayload);
        return result.response;
      },

      saveMemory: async (memoryPayload) =>
        saveLiveTutorMemory({
          ...memoryPayload,
          payload,
        }),
    },
  });

  let tutorResult = {
    ok: true,
    interactionId: workflow.tutorResponse?.interactionId || null,
    sessionKey: payload.sessionKey || "",
    status: "ready",
    response: workflow.tutorResponse,
    workflow,
    graphTrace: workflow.auditTrail || [],
  };

  if (!workflow.tutorResponse || !workflow.tutorResponse.explanation) {
    const fallback = await runFinalTutorBrainByMode(buildFinalBrainPayload(payload, workflow));

    tutorResult = {
      ok: fallback.ok,
      interactionId: fallback.interactionId,
      sessionKey: fallback.sessionKey,
      status: fallback.status,
      response: fallback.response,
      workflow,
      graphTrace: [...safeArray(workflow.auditTrail), ...safeArray(fallback.graphTrace)],
      latencyMs: fallback.latencyMs,
      modelMeta: fallback.modelMeta,
    };
  }

  const board = await createBoardFromTutorResult({
    payload,
    tutorResult,
    workflow,
  });

  const vectorIndexResult = await indexBoardMemoryAfterCreation({
    payload,
    tutorResult,
    workflow,
    board,
  });

  if (tutorResult.interactionId) {
    await LiveTutorInteraction.findByIdAndUpdate(tutorResult.interactionId, {
      $set: {
        "response.boardId": String(board._id),
        "response.boardSummary": {
          boardId: String(board._id),
          blockCount: board.metrics.blockCount,
          simulationCount: board.metrics.simulationCount,
          replayStepCount: board.metrics.replayStepCount,
          boardMode: board.boardMode,
          vectorIndexed: vectorIndexResult.indexed || 0,
        },
      },
    }).catch(() => {});
  }

  return {
    ...tutorResult,
    vectorIndexResult,
    board: {
      boardId: String(board._id),
      title: board.title,
      boardMode: board.boardMode,
      status: board.status,
      pages: board.pages,
      voiceScript: board.voiceScript,
      replayTimeline: board.replayTimeline,
      weakConcepts: board.weakConcepts,
      masteredConcepts: board.masteredConcepts,
      metrics: board.metrics,
      sourceContext: board.sourceContext,
    },
  };
}

export async function getLiveTutorBoard(boardId) {
  const board = await LiveTutorBoard.findById(boardId).lean();

  if (!board) {
    return {
      ok: false,
      message: "Live tutor board not found.",
    };
  }

  return {
    ok: true,
    board: {
      ...board,
      boardId: String(board._id),
    },
  };
}

export async function listLiveTutorBoards(query = {}) {
  const filter = {};

  if (query.userId) filter.userId = clean(query.userId);
  if (query.deviceId) filter.deviceId = clean(query.deviceId);
  if (query.sessionKey) filter.sessionKey = clean(query.sessionKey);
  if (query.status) filter.status = clean(query.status);

  const limit = Math.min(100, Math.max(1, safeNumber(query.limit, 30)));

  const boards = await LiveTutorBoard.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return {
    ok: true,
    count: boards.length,
    boards: boards.map((board) => ({
      boardId: String(board._id),
      title: board.title,
      status: board.status,
      boardMode: board.boardMode,
      sourceContext: board.sourceContext,
      metrics: board.metrics,
      weakConcepts: board.weakConcepts,
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
    })),
  };
}

export async function updateLiveTutorBoardBlock({
  boardId,
  pageId,
  blockId,
  patch = {},
  editedBy = "student",
}) {
  const board = await LiveTutorBoard.findById(boardId);

  if (!board) {
    return {
      ok: false,
      message: "Live tutor board not found.",
    };
  }

  const page = board.pages.find((item) => item.pageId === pageId);

  if (!page) {
    return {
      ok: false,
      message: "Board page not found.",
    };
  }

  const block = page.blocks.find((item) => item.blockId === blockId);

  if (!block) {
    return {
      ok: false,
      message: "Board block not found.",
    };
  }

  const before = block.toObject ? block.toObject() : JSON.parse(JSON.stringify(block));

  if (patch.title !== undefined) block.title = patch.title;
  if (patch.content !== undefined) block.content = patch.content;
  if (patch.data !== undefined) block.data = patch.data;
  if (patch.style !== undefined) block.style = patch.style;

  board.addEditHistory({
    editedBy,
    action: "update_block",
    blockId,
    before,
    after: patch,
  });

  await board.save();

  await indexLiveTutorContext({
    payload: {
      userId: board.userId,
      deviceId: board.deviceId,
      sessionKey: board.sessionKey,
      url: board.sourceContext?.url || "",
      title: board.sourceContext?.title || board.title,
      platform: board.sourceContext?.sourceType || "unknown",
      videoId: board.sourceContext?.videoId || "",
      timestampSeconds: board.sourceContext?.timestampSeconds || 0,
    },
    board,
    tutorResponse: board.rawAiPlan?.response || null,
    conceptTags: board.weakConcepts || [],
    weakConcepts: board.weakConcepts || [],
  }).catch(() => {});

  return {
    ok: true,
    boardId: String(board._id),
    pageId,
    blockId,
    block,
  };
}

export async function saveLiveTutorBoard(boardId) {
  const board = await LiveTutorBoard.findById(boardId);

  if (!board) {
    return {
      ok: false,
      message: "Live tutor board not found.",
    };
  }

  board.markSaved();
  await board.save();

  return {
    ok: true,
    boardId: String(board._id),
    status: board.status,
    savedAt: board.metrics.savedAt,
  };
}

export default {
  runLiveTutorOrchestrator,
  createBoardFromTutorResult,
  getLiveTutorBoard,
  listLiveTutorBoards,
  updateLiveTutorBoardBlock,
  saveLiveTutorBoard,
};