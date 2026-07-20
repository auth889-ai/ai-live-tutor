import crypto from "crypto";
import { StateGraph, END } from "@langchain/langgraph";

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

function trimText(value = "", max = 4000) {
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

function hasMarkedRect(payload = {}) {
  return Boolean(payload.selectedRect?.width > 8 && payload.selectedRect?.height > 8);
}

function detectDomainKind(payload = {}) {
  const platform = clean(payload.platform || "").toLowerCase();
  const url = clean(payload.url || "").toLowerCase();

  if (platform) return platform;
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.includes("leetcode.com")) return "leetcode";
  if (url.includes("github.com")) return "github";
  if (url.includes("docs.")) return "docs";
  if (url.includes(".pdf")) return "pdf";

  return "webpage";
}

function inferLearningMode(payload = {}) {
  const mode = clean(payload.mode || "");

  if (mode) return mode;
  if (hasMarkedRect(payload)) return "explain_selection";
  if (payload.selectedText) return "explain_selection";
  if (payload.platform === "youtube") return "explain_frame";

  return "explain_frame";
}

function makeFocusInstruction(payload = {}) {
  if (hasMarkedRect(payload)) {
    return [
      "The student marked a specific screen/video region.",
      "Explain ONLY that marked region and the transcript/page context immediately around it.",
      "Do not expand into unrelated theory unless it is required as a direct prerequisite.",
      "If the human instructor explanation is weak or unclear, create a better human-tutor explanation.",
    ].join(" ");
  }

  if (payload.selectedText) {
    return [
      "The student selected text.",
      "Explain ONLY the selected text and nearby visible context.",
      "Do not explain the full page.",
    ].join(" ");
  }

  return [
    "Explain the current visible learning moment.",
    "Stay grounded in the screen/page/transcript context.",
    "Avoid generic unrelated explanations.",
  ].join(" ");
}

function buildTranscriptContext(payload = {}) {
  const tw = payload.transcriptWindow || {};

  const before = trimText(tw.before || "", 2200);
  const current = trimText(tw.current || payload.currentCaption || "", 1600);
  const after = trimText(tw.after || "", 2200);
  const full = trimText(tw.full || payload.transcriptContext || "", 5500);

  return {
    before,
    current,
    after,
    full,
    startSeconds: safeNumber(tw.startSeconds),
    endSeconds: safeNumber(tw.endSeconds),
    hasTranscript: Boolean(before || current || after || full),
  };
}

function compactMarkedElements(payload = {}) {
  return safeArray(payload.markedElements)
    .slice(0, 12)
    .map((item, index) => ({
      index,
      label: trimText(item.label || "", 220),
      text: trimText(item.text || "", 1000),
      tagName: item.tagName || "",
      rect: item.rect || null,
    }))
    .filter((item) => item.label || item.text);
}

function compactPageStructure(payload = {}) {
  const pageStructure = payload.pageStructure || {};

  return {
    headings: safeArray(pageStructure.headings)
      .slice(0, 25)
      .map((h) => ({
        level: h.level,
        text: trimText(h.text || "", 180),
      }))
      .filter((h) => h.text),

    codeBlocks: safeArray(pageStructure.codeBlocks)
      .slice(0, 8)
      .map((b) => ({
        label: trimText(b.label || "", 180),
        text: trimText(b.text || "", 1400),
      }))
      .filter((b) => b.text),

    tables: safeArray(pageStructure.tables)
      .slice(0, 5)
      .map((t) => ({
        label: trimText(t.label || "", 180),
        text: trimText(t.text || "", 1200),
      }))
      .filter((t) => t.text),

    images: safeArray(pageStructure.images)
      .slice(0, 10)
      .map((img) => ({
        alt: trimText(img.alt || "", 160),
        src: trimText(img.src || "", 300),
        rect: img.rect || null,
      })),
  };
}

function buildRagQuery(state = {}) {
  const payload = state.payload || {};
  const transcript = state.transcriptContext || {};

  const parts = [
    payload.userQuestion,
    payload.selectedText,
    payload.currentCaption,
    transcript.current,
    transcript.full,
    payload.transcriptContext,
    state.pageTextPreview,
    safeArray(state.markedElements)
      .map((x) => [x.label, x.text].filter(Boolean).join(" "))
      .join("\n"),
    safeArray(state.pageStructure?.headings)
      .map((x) => x.text)
      .join(" "),
    safeArray(state.conceptTags).join(" "),
  ]
    .filter(Boolean)
    .join("\n");

  return trimText(parts, 3500);
}

function inferConceptTags(state = {}) {
  const text = [
    state.payload?.userQuestion,
    state.payload?.selectedText,
    state.payload?.currentCaption,
    state.transcriptContext?.current,
    state.transcriptContext?.full,
    state.pageTextPreview,
    JSON.stringify(state.markedElements || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const rules = [
    ["array", /\barray|list|nums|arr\[/i],
    ["hashmap", /\bhash\s*map|hashmap|dictionary|dict|map\{|object\{|complement/i],
    ["pointer", /\bpointer|index|left|right|i\s*=|j\s*=/i],
    ["loop", /\bfor loop|while loop|iteration|iterate|loop/i],
    ["recursion", /\brecursion|recursive|base case|call stack/i],
    ["dynamic_programming", /\bdp|dynamic programming|memo|tabulation/i],
    ["graph", /\bgraph|node|edge|dfs|bfs/i],
    ["tree", /\btree|root|leaf|binary/i],
    ["database", /\bsql|database|query|schema|mongodb|mongoose/i],
    ["react", /\breact|component|state|props|hook/i],
    ["langchain", /\blangchain|langgraph|retriever|rag|agent/i],
    ["math", /\bequation|formula|derivative|integral|matrix|probability/i],
    ["diagram", /\bdiagram|figure|chart|graph|visual|flow/i],
    ["webpage", /\bdocs|documentation|api|guide|tutorial/i],
  ];

  const tags = [];

  for (const [tag, pattern] of rules) {
    if (pattern.test(text)) tags.push(tag);
  }

  if (!tags.length) tags.push("current_concept");

  return [...new Set(tags)].slice(0, 12);
}

function buildTutorStrategy(state = {}) {
  const mode = state.mode;

  const base = {
    style: "human_tutor",
    scope: hasMarkedRect(state.payload)
      ? "marked_region_only"
      : state.payload?.selectedText
        ? "selected_text_only"
        : "current_visible_context",
    mustUse: [
      "screen context",
      "transcript context if available",
      "student question",
      "marked DOM elements if available",
      "retrieved memory/RAG when relevant",
    ],
    mustAvoid: [
      "unrelated internet knowledge",
      "full-page explanation unless requested",
      "random generic chatbot answer",
      "inventing exact diagram details not visible in context",
    ],
    responseShape: [
      "headline",
      "shortAnswer",
      "human tutor explanation",
      "visualBreakdown",
      "dryRun if code/algorithm",
      "misconceptionCheck",
      "thinkingScore",
      "followUpQuestion",
      "voiceScript-ready concise answer",
    ],
  };

  if (mode === "dry_run") {
    return {
      ...base,
      priority: "simulate state step by step like a human coding instructor",
      requiredBlocks: ["dry_run_table", "array_simulation_or_state", "complexity"],
    };
  }

  if (mode === "explain_back") {
    return {
      ...base,
      priority: "evaluate student explanation, find missing/wrong mental model, repair it",
      requiredBlocks: ["correct_parts", "missing_parts", "wrong_parts", "improved_answer"],
    };
  }

  if (mode === "interrupt") {
    return {
      ...base,
      priority: "answer student interruption briefly, then resume original board context",
      requiredBlocks: ["interrupt_answer", "resume_line"],
    };
  }

  if (mode === "roadmap") {
    return {
      ...base,
      priority: "make a small concept flow for only this section",
      requiredBlocks: ["current_node", "prerequisite", "next_step"],
    };
  }

  return {
    ...base,
    priority: "explain marked/current concept clearly with visual board plan",
  };
}

function buildBoardPlanSkeleton(state = {}) {
  const tags = state.conceptTags || [];
  const mode = state.mode;

  const blocks = [
    {
      blockId: uid("plan"),
      type: "heading",
      title: "Focused explanation",
      purpose: "Name exactly what the student marked or selected.",
    },
    {
      blockId: uid("plan"),
      type: "text",
      title: "Human tutor explanation",
      purpose: "Explain in simple steps with no unrelated topic expansion.",
    },
    {
      blockId: uid("plan"),
      type: "diagram",
      title: "Step-by-step visual board",
      purpose: "Convert visualBreakdown into board writing steps.",
    },
  ];

  if (
    mode === "dry_run" ||
    tags.includes("array") ||
    tags.includes("hashmap") ||
    tags.includes("pointer") ||
    tags.includes("loop")
  ) {
    blocks.push({
      blockId: uid("plan"),
      type: "dry_run_table",
      title: "Dry-run table",
      purpose: "Show state changes row by row.",
    });

    if (tags.includes("array") || tags.includes("pointer")) {
      blocks.push({
        blockId: uid("plan"),
        type: "array_simulation",
        title: "Array/pointer simulation",
        purpose: "Show current index/pointer movement.",
      });
    }

    if (tags.includes("hashmap")) {
      blocks.push({
        blockId: uid("plan"),
        type: "hashmap_simulation",
        title: "HashMap state",
        purpose: "Show map before/after each step.",
      });
    }
  }

  blocks.push({
    blockId: uid("plan"),
    type: "repair",
    title: "Weak-part repair",
    purpose: "Predict likely misconception and fix it.",
  });

  blocks.push({
    blockId: uid("plan"),
    type: "quiz",
    title: "Explain-back check",
    purpose: "Ask one useful check question.",
  });

  return {
    boardKind: hasMarkedRect(state.payload) ? "marked_screen_board" : "context_board",
    autoExpand: true,
    editable: true,
    replayable: true,
    blocks,
  };
}

function buildSimulationPlan(state = {}) {
  const tags = state.conceptTags || [];
  const shouldSimulate =
    state.mode === "dry_run" ||
    tags.includes("array") ||
    tags.includes("hashmap") ||
    tags.includes("pointer") ||
    tags.includes("loop");

  if (!shouldSimulate) {
    return {
      needed: false,
      reason: "Current context does not require code/algorithm state simulation.",
    };
  }

  return {
    needed: true,
    simulatorTypes: [
      tags.includes("array") || tags.includes("pointer") ? "array_pointer" : "",
      tags.includes("hashmap") ? "hashmap_state" : "",
      tags.includes("loop") ? "loop_trace" : "",
    ].filter(Boolean),
    requiredTraceFields: [
      "step",
      "i/index",
      "current value",
      "condition/check",
      "decision",
      "state before",
      "state after",
      "explanation",
    ],
    instruction:
      "If code/algorithm is visible, generate dryRun.rows with concrete state transitions grounded in marked/current context.",
  };
}

function buildVoicePlan(state = {}) {
  const likelyBangla =
    /[\u0980-\u09FF]/.test(state.payload?.userQuestion || "") ||
    /\bami|amar|bujhi|bujhini|keno|kivabe|eta|eita\b/i.test(
      state.payload?.userQuestion || ""
    );

  return {
    language: likelyBangla ? "bangla" : "english",
    style: "calm human tutor",
    interruptionPolicy:
      "If the student interrupts, pause the board, answer the interrupt, then resume from the current board block.",
    speakLength: "short first, then continue if student asks",
    askBack: true,
  };
}

function createEmptyTutorResponse(state = {}) {
  return {
    ok: true,
    headline: "Focused tutor plan ready",
    shortAnswer:
      "I will explain only the marked/current part using the screen, transcript, page context, and memory.",
    explanation:
      "The LangGraph workflow prepared the capture, transcript, RAG, vision, board, simulation, and voice plan. Final Gemma generation should now create the actual tutor response.",
    confidence: "medium",
    tutorScratchpad: [],
    visualBreakdown: [],
    dryRun: {
      available: false,
      title: "",
      columns: [],
      rows: [],
      stateSummary: "",
      complexity: {},
    },
    roadmap: {
      nodes: [],
      edges: [],
    },
    misconceptionCheck: {
      likelyConfusion: "",
      wrongMentalModel: "",
      repairExplanation: "",
      askBackQuestion: "",
      severity: "none",
    },
    thinkingScore: {
      level: "unknown",
      score: 0,
      reason: "",
      evidence: "",
      nextImprovement: "",
    },
    explainBackEvaluation: {
      studentClaimSummary: "",
      correctParts: [],
      missingParts: [],
      wrongParts: [],
      improvedAnswer: "",
      score: 0,
    },
    suggestedPractice: [],
    weakConcepts: state.conceptTags || [],
    masteredConcepts: [],
    followUpQuestion: "Can you explain back this marked/current part in your own words?",
  };
}

async function nodeCaptureNormalizer(state) {
  const payload = state.payload || {};

  const next = {
    ...state,
    runId: state.runId || uid("live_tutor_run"),
    mode: inferLearningMode(payload),
    platform: detectDomainKind(payload),
    hasMarkedRect: hasMarkedRect(payload),
    focusInstruction: makeFocusInstruction(payload),
    markedElements: compactMarkedElements(payload),
    pageStructure: compactPageStructure(payload),
    pageTextPreview: trimText(payload.pageText || payload.visibleText || "", 4500),
    selectedTextPreview: trimText(payload.selectedText || "", 2500),
    screenshotAvailable: Boolean(payload.screenshotDataUrl),
    normalizedAt: new Date().toISOString(),
  };

  next.auditTrail = [
    ...(state.auditTrail || []),
    {
      node: "capture_normalizer",
      at: new Date().toISOString(),
      mode: next.mode,
      platform: next.platform,
      hasMarkedRect: next.hasMarkedRect,
      screenshotAvailable: next.screenshotAvailable,
    },
  ];

  return next;
}

async function nodeTranscriptAlignment(state) {
  const transcriptContext = buildTranscriptContext(state.payload || {});

  return {
    ...state,
    transcriptContext,
    auditTrail: [
      ...(state.auditTrail || []),
      {
        node: "transcript_alignment",
        at: new Date().toISOString(),
        hasTranscript: transcriptContext.hasTranscript,
        startSeconds: transcriptContext.startSeconds,
        endSeconds: transcriptContext.endSeconds,
      },
    ],
  };
}

async function nodeConceptDetector(state) {
  const conceptTags = inferConceptTags(state);

  return {
    ...state,
    conceptTags,
    auditTrail: [
      ...(state.auditTrail || []),
      {
        node: "concept_detector",
        at: new Date().toISOString(),
        conceptTags,
      },
    ],
  };
}

async function nodeRagRetriever(state) {
  const query = buildRagQuery(state);

  let retrieved = [];

  if (typeof state.tools?.retrieveContext === "function") {
    try {
      retrieved = await state.tools.retrieveContext({
        query,
        userQuestion: state.payload?.userQuestion || "",
        selectedText: state.payload?.selectedText || "",
        currentCaption: state.payload?.currentCaption || "",
        transcriptContext: state.payload?.transcriptContext || state.transcriptContext?.full || "",
        markedElements: state.markedElements || [],

        userId: state.payload?.userId || "guest",
        deviceId: state.payload?.deviceId || "web",
        sessionKey: state.payload?.sessionKey || "",
        url: state.payload?.url || "",
        sourceUrl: state.payload?.url || "",
        platform: state.platform || state.payload?.platform || "",
        videoId: state.payload?.videoId || "",
        conceptTags: state.conceptTags || [],
        limit: 8,
      });
    } catch (error) {
      retrieved = [
        {
          source: "rag_error",
          text: `RAG retrieval failed: ${error.message}`,
          score: 0,
        },
      ];
    }
  }

  return {
    ...state,
    ragQuery: query,
    retrievedContext: safeArray(retrieved).slice(0, 10),
    auditTrail: [
      ...(state.auditTrail || []),
      {
        node: "rag_retriever",
        at: new Date().toISOString(),
        queryLength: query.length,
        retrievedCount: safeArray(retrieved).length,
      },
    ],
  };
}

async function nodeVisionAnalyzer(state) {
  let vision = {
    available: Boolean(state.payload?.screenshotDataUrl),
    used: false,
    observations: [],
    focus: "",
    warning: "",
  };

  if (state.payload?.screenshotDataUrl && typeof state.tools?.analyzeVision === "function") {
    try {
      const result = await state.tools.analyzeVision({
        screenshotDataUrl: state.payload.screenshotDataUrl,
        selectedRect: state.payload.selectedRect || null,
        markedElements: state.markedElements || [],
        platform: state.platform,
        timestampSeconds: state.payload?.timestampSeconds || 0,
        focusInstruction: state.focusInstruction,
      });

      vision = {
        available: true,
        used: true,
        observations: safeArray(result?.observations),
        focus: result?.focus || "",
        warning: result?.warning || "",
        raw: result,
      };
    } catch (error) {
      vision = {
        available: true,
        used: false,
        observations: [],
        focus: "",
        warning: `Vision analysis failed: ${error.message}`,
      };
    }
  }

  return {
    ...state,
    vision,
    auditTrail: [
      ...(state.auditTrail || []),
      {
        node: "screen_vision",
        at: new Date().toISOString(),
        available: vision.available,
        used: vision.used,
      },
    ],
  };
}

async function nodeTutorStrategy(state) {
  const tutorStrategy = buildTutorStrategy(state);

  return {
    ...state,
    tutorStrategy,
    auditTrail: [
      ...(state.auditTrail || []),
      {
        node: "tutor_strategy",
        at: new Date().toISOString(),
        priority: tutorStrategy.priority,
        scope: tutorStrategy.scope,
      },
    ],
  };
}

async function nodeBoardPlan(state) {
  const boardPlan = buildBoardPlanSkeleton(state);

  return {
    ...state,
    boardPlan,
    auditTrail: [
      ...(state.auditTrail || []),
      {
        node: "board_plan",
        at: new Date().toISOString(),
        blockCount: boardPlan.blocks.length,
        boardKind: boardPlan.boardKind,
      },
    ],
  };
}

async function nodeSimulationPlan(state) {
  const simulationPlan = buildSimulationPlan(state);

  return {
    ...state,
    simulationPlan,
    auditTrail: [
      ...(state.auditTrail || []),
      {
        node: "simulation_plan",
        at: new Date().toISOString(),
        needed: simulationPlan.needed,
        simulatorTypes: simulationPlan.simulatorTypes || [],
      },
    ],
  };
}

async function nodeVoicePlan(state) {
  const voicePlan = buildVoicePlan(state);

  return {
    ...state,
    voicePlan,
    auditTrail: [
      ...(state.auditTrail || []),
      {
        node: "voice_script",
        at: new Date().toISOString(),
        language: voicePlan.language,
        askBack: voicePlan.askBack,
      },
    ],
  };
}

async function nodeTutorResponseGenerator(state) {
  let tutorResponse = null;

  if (typeof state.tools?.generateTutorResponse === "function") {
    try {
      tutorResponse = await state.tools.generateTutorResponse({
        payload: state.payload,
        mode: state.mode,
        platform: state.platform,
        focusInstruction: state.focusInstruction,
        transcriptContext: state.transcriptContext,
        markedElements: state.markedElements,
        pageStructure: state.pageStructure,
        pageTextPreview: state.pageTextPreview,
        selectedTextPreview: state.selectedTextPreview,
        retrievedContext: state.retrievedContext,
        vision: state.vision,
        conceptTags: state.conceptTags,
        tutorStrategy: state.tutorStrategy,
        boardPlan: state.boardPlan,
        simulationPlan: state.simulationPlan,
        voicePlan: state.voicePlan,
        auditTrail: state.auditTrail || [],
      });
    } catch (error) {
      tutorResponse = {
        ...createEmptyTutorResponse(state),
        headline: "Tutor response generation failed",
        shortAnswer: "The workflow ran, but final tutor generation failed.",
        explanation: error.message,
        confidence: "low",
      };
    }
  }

  if (!tutorResponse) {
    tutorResponse = createEmptyTutorResponse(state);
  }

  return {
    ...state,
    tutorResponse,
    auditTrail: [
      ...(state.auditTrail || []),
      {
        node: "tutor_response_generator",
        at: new Date().toISOString(),
        hasResponse: Boolean(tutorResponse),
      },
    ],
  };
}

async function nodeMemorySaver(state) {
  let memoryResult = null;

  if (typeof state.tools?.saveMemory === "function") {
    try {
      memoryResult = await state.tools.saveMemory({
        userId: state.payload?.userId || "guest",
        deviceId: state.payload?.deviceId || "web",
        sessionKey: state.payload?.sessionKey || "",
        url: state.payload?.url || "",
        videoId: state.payload?.videoId || "",
        timestampSeconds: state.payload?.timestampSeconds || 0,
        conceptTags: state.conceptTags || [],
        weakConcepts: state.tutorResponse?.weakConcepts || state.conceptTags || [],
        tutorResponse: state.tutorResponse,
        boardPlan: state.boardPlan,
        auditTrail: state.auditTrail,
        payload: state.payload,
      });
    } catch (error) {
      memoryResult = {
        ok: false,
        message: error.message,
      };
    }
  }

  return {
    ...state,
    memoryResult,
    auditTrail: [
      ...(state.auditTrail || []),
      {
        node: "memory_save",
        at: new Date().toISOString(),
        saved: Boolean(memoryResult?.ok),
        indexed: memoryResult?.indexed || 0,
      },
    ],
  };
}

function buildWorkflow() {
  const graph = new StateGraph({
    channels: {
      payload: null,
      tools: null,

      runId: null,
      mode: null,
      platform: null,
      hasMarkedRect: null,
      focusInstruction: null,

      markedElements: null,
      pageStructure: null,
      pageTextPreview: null,
      selectedTextPreview: null,
      screenshotAvailable: null,

      transcriptContext: null,
      ragQuery: null,
      retrievedContext: null,

      vision: null,
      conceptTags: null,
      tutorStrategy: null,
      boardPlan: null,
      simulationPlan: null,
      voicePlan: null,

      tutorResponse: null,
      memoryResult: null,
      auditTrail: null,
      normalizedAt: null,
    },
  });

  graph.addNode("capture_normalizer", nodeCaptureNormalizer);
  graph.addNode("transcript_alignment", nodeTranscriptAlignment);
  graph.addNode("concept_detector", nodeConceptDetector);
  graph.addNode("rag_retriever", nodeRagRetriever);
  graph.addNode("screen_vision", nodeVisionAnalyzer);
  graph.addNode("tutor_strategy", nodeTutorStrategy);
  graph.addNode("board_plan", nodeBoardPlan);
  graph.addNode("simulation_plan", nodeSimulationPlan);
  graph.addNode("voice_script", nodeVoicePlan);
  graph.addNode("tutor_response_generator", nodeTutorResponseGenerator);
  graph.addNode("memory_save", nodeMemorySaver);

  graph.setEntryPoint("capture_normalizer");

  graph.addEdge("capture_normalizer", "transcript_alignment");
  graph.addEdge("transcript_alignment", "concept_detector");
  graph.addEdge("concept_detector", "rag_retriever");
  graph.addEdge("rag_retriever", "screen_vision");
  graph.addEdge("screen_vision", "tutor_strategy");
  graph.addEdge("tutor_strategy", "board_plan");
  graph.addEdge("board_plan", "simulation_plan");
  graph.addEdge("simulation_plan", "voice_script");
  graph.addEdge("voice_script", "tutor_response_generator");
  graph.addEdge("tutor_response_generator", "memory_save");
  graph.addEdge("memory_save", END);

  return graph.compile();
}

let compiledWorkflow = null;

export function getLiveTutorLangGraphWorkflow() {
  if (!compiledWorkflow) {
    compiledWorkflow = buildWorkflow();
  }

  return compiledWorkflow;
}

export async function runLiveTutorLangGraphWorkflow({ payload = {}, tools = {} } = {}) {
  const workflow = getLiveTutorLangGraphWorkflow();

  const result = await workflow.invoke({
    payload,
    tools,
    auditTrail: [],
  });

  return {
    ok: true,
    runId: result.runId,
    mode: result.mode,
    platform: result.platform,
    focusInstruction: result.focusInstruction,
    transcriptContext: result.transcriptContext,
    retrievedContext: result.retrievedContext || [],
    vision: result.vision,
    conceptTags: result.conceptTags || [],
    tutorStrategy: result.tutorStrategy,
    boardPlan: result.boardPlan,
    simulationPlan: result.simulationPlan,
    voicePlan: result.voicePlan,
    tutorResponse: result.tutorResponse,
    memoryResult: result.memoryResult,
    auditTrail: result.auditTrail || [],
  };
}

export default {
  getLiveTutorLangGraphWorkflow,
  runLiveTutorLangGraphWorkflow,
};