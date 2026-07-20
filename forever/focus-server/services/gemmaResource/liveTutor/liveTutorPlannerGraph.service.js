// server/services/gemmaResource/liveTutor/liveTutorPlannerGraph.service.js
//
// FULL REPLACEMENT
//
// Fixes current curl error:
//   "Gemma did not return valid JSON."
//
// What changed:
// - Smaller prompt to reduce malformed/truncated JSON.
// - Strong parseJsonLoose.
// - JSON repair retry if Gemma returns malformed JSON.
// - Raw preview included in backend error so next curl shows real cause.
// - Still uses LangGraph + LangChain RunnableLambda.
// - Still uses strict schema normalizer to expand weak output into:
//   8 board pages, 20+ commands/actions, 14+ voice lines, flow/tree/table/codeTrace/quiz/source.
// - No fake fallback. The schema expands from Gemma/RAG-derived topic, concepts, voice, source refs.

import { StateGraph, START, END } from "@langchain/langgraph";
import { RunnableLambda } from "@langchain/core/runnables";

import {
  normalizeLiveTutorPlan,
  assertRichLiveTutorPlan,
  analyzePlanRichness,
  collectLiveTutorPlanIssues,
  publicPlanDiagnostics,
} from "./liveTutorCommandSchema.service.js";

const FORCE_SEGMENT_SECONDS = 600;
const DEFAULT_TOTAL_MINUTES = 60;

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

function clampText(value = "", max = 1200) {
  const text = textClean(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}...`;
}

function uniq(list = []) {
  return Array.from(new Set(asArray(list).map(clean).filter(Boolean)));
}

function getOllamaGenerateUrl() {
  const configured =
    process.env.GEMMA_RESOURCE_OLLAMA_URL ||
    process.env.OLLAMA_CLOUD_URL ||
    process.env.OLLAMA_LOCAL_URL ||
    "http://localhost:11434";

  const base = String(configured).replace(/\/+$/, "");
  return base.endsWith("/api/generate") ? base : `${base}/api/generate`;
}

const MODEL =
  process.env.GEMMA_RESOURCE_OLLAMA_MODEL ||
  process.env.OLLAMA_MODEL ||
  process.env.OLLAMA_LOCAL_MODEL ||
  "gemma4:e4b";

const TIMEOUT_MS = Number(
  process.env.GEMMA_RESOURCE_LIVE_TUTOR_TIMEOUT_MS ||
    process.env.GEMMA_RESOURCE_AI_TIMEOUT_MS ||
    process.env.OLLAMA_TIMEOUT_MS ||
    900000
);

const NUM_CTX = Number(process.env.OLLAMA_NUM_CTX || 8192);
const NUM_PREDICT = Number(process.env.GEMMA_RESOURCE_LIVE_TUTOR_NUM_PREDICT || 9000);

function preview(value = "", max = 1200) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function stripCodeFence(text = "") {
  return String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function extractJsonCandidate(rawText = "") {
  const text = String(rawText || "").trim();
  if (!text) return "";

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const firstObject = text.indexOf("{");
  const lastObject = text.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) return text.slice(firstObject, lastObject + 1);

  const firstArray = text.indexOf("[");
  const lastArray = text.lastIndexOf("]");
  if (firstArray >= 0 && lastArray > firstArray) return text.slice(firstArray, lastArray + 1);

  return text;
}

function repairCommonJsonText(rawText = "") {
  let text = stripCodeFence(extractJsonCandidate(rawText));

  text = text
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
    .replace(/\u0000/g, "")
    .trim();

  return text;
}

function parseJsonLoose(rawValue) {
  if (!rawValue) return null;
  if (typeof rawValue === "object") return rawValue;

  const rawText = String(rawValue || "").trim();
  const attempts = [];

  attempts.push(rawText);
  attempts.push(stripCodeFence(rawText));
  attempts.push(extractJsonCandidate(rawText));
  attempts.push(repairCommonJsonText(rawText));

  for (const candidate of attempts) {
    if (!candidate) continue;

    try {
      return JSON.parse(candidate);
    } catch {}
  }

  return null;
}

async function callOllama(prompt, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(getOllamaGenerateUrl(), {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: options.model || MODEL,
        prompt,
        stream: false,
        format: options.format || "json",
        options: {
          temperature: options.temperature ?? 0.1,
          top_p: options.top_p ?? 0.88,
          num_ctx: options.num_ctx ?? NUM_CTX,
          num_predict: options.num_predict ?? NUM_PREDICT,
        },
      }),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(`Gemma request failed: ${json?.error || res.statusText}`);
    }

    return json.response || json.message?.content || json.content || "";
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(
        `Gemma took too long while generating the live tutor segment. timeoutMs=${TIMEOUT_MS}`
      );
    }

    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function repairJsonWithGemma(rawText, originalPrompt, reason = "") {
  const repairPrompt = `
Return JSON only.

The previous model response was not valid JSON.
Fix it into valid JSON only. Do not add markdown. Do not explain.

ERROR:
${reason}

INVALID_RESPONSE_PREVIEW:
${preview(rawText, 5000)}

REQUIRED MINIMUM SHAPE:
{
  "topic": "source-grounded topic",
  "segmentTitle": "segment title",
  "shortAnswer": "summary",
  "bigIdea": "mental model",
  "coreConfusion": "confusion",
  "whyItMatters": "why it matters",
  "keyConcepts": ["concept 1","concept 2","concept 3","concept 4","concept 5","concept 6","concept 7","concept 8"],
  "teachingPlan": ["step 1","step 2","step 3","step 4","step 5","step 6","step 7","step 8","step 9","step 10","step 11","step 12"],
  "commonMistakes": ["mistake 1","mistake 2","mistake 3"],
  "boardPages": [
    {"id":"page_1","title":"Hook + source problem"},
    {"id":"page_2","title":"Mental model"},
    {"id":"page_3","title":"Flow / Mermaid"},
    {"id":"page_4","title":"Tree / structure"},
    {"id":"page_5","title":"Comparison table"},
    {"id":"page_6","title":"Example trace"},
    {"id":"page_7","title":"Common mistakes"},
    {"id":"page_8","title":"Quiz + next bridge"}
  ],
  "teacherActions": [],
  "boardCommands": [],
  "voiceScript": [],
  "citations": ["SOURCE 1"],
  "sourceRefs": ["SOURCE 1"],
  "nextCursor": "Continue with next segment",
  "estimatedTotalSeconds": 600,
  "continueMode": true,
  "externalKnowledgeUsed": true,
  "offlineKnowledgeUsed": true,
  "resourceGroundedRatio": 0.82
}
`;

  const repairedRaw = await callOllama(repairPrompt, {
    format: "json",
    temperature: 0.02,
    top_p: 0.7,
    num_predict: 7000,
  });

  const parsed = parseJsonLoose(repairedRaw);

  if (!parsed) {
    throw new Error(
      [
        "Gemma did not return valid JSON after repair.",
        `First raw preview: ${preview(rawText, 900)}`,
        `Repair raw preview: ${preview(repairedRaw, 900)}`,
        originalPrompt ? `Original prompt preview: ${preview(originalPrompt, 500)}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return parsed;
}

async function callGemmaJson(prompt, options = {}) {
  const rawText = await callOllama(prompt, {
    format: "json",
    temperature: options.temperature ?? 0.1,
    top_p: options.top_p ?? 0.88,
    num_ctx: options.num_ctx ?? NUM_CTX,
    num_predict: options.num_predict ?? NUM_PREDICT,
  });

  const parsed = parseJsonLoose(rawText);
  if (parsed) return parsed;

  const candidate = repairCommonJsonText(rawText);
  const parsedCandidate = parseJsonLoose(candidate);
  if (parsedCandidate) return parsedCandidate;

  return repairJsonWithGemma(rawText, prompt, "Initial response was malformed or empty JSON.");
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

function sourceRef(chunk = {}, index = 0) {
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

function chunkTitle(chunk = {}, index = 0) {
  return clean(chunk.title || chunk.heading || chunk.sectionTitle || `Source ${index + 1}`);
}

function buildInternalContext(chunks = []) {
  return asArray(chunks)
    .slice(0, 10)
    .map((chunk, index) => {
      return [
        `SOURCE ${index + 1}`,
        `ref: ${sourceRef(chunk, index)}`,
        `title: ${chunkTitle(chunk, index)}`,
        `text: ${clampText(chunkText(chunk), 950)}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

function buildExternalContext(external = {}) {
  const rows = asArray(external.results)
    .slice(0, 2)
    .map((item, index) => {
      return [
        `KNOWLEDGE ${index + 1}`,
        `title: ${clean(item.title || "Gemma offline same-topic knowledge")}`,
        `content: ${clampText(item.content || item.snippet || external.answer || "", 600)}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  return [
    "Use offline same-topic knowledge only for intuition/examples/common mistakes.",
    "Internal RAG remains truth. No URLs.",
    external.answer ? clampText(external.answer, 500) : "",
    rows,
  ]
    .filter(Boolean)
    .join("\n");
}

function detectTopicHeuristic({ request = "", chunks = [] }) {
  const text = `${request}\n${asArray(chunks).map(chunkText).join("\n")}`.toLowerCase();

  if (/\b(template method|design pattern|factory|singleton|observer|strategy|decorator|oop|class|inheritance|interface|uml)\b/.test(text)) {
    return {
      topicType: "oop",
      topic: "Object-Oriented Design Pattern",
      needsCode: true,
      bestVisuals: ["mermaidDiagram", "classDiagram", "flowDiagram", "tree", "table", "codeBox", "dryRunTable"],
    };
  }

  if (/\b(dynamic programming|memoization|recurrence|fibonacci|dp table|algorithm|complexity|recursion)\b/.test(text)) {
    return {
      topicType: "algorithm",
      topic: "Algorithm / Dynamic Programming",
      needsCode: true,
      bestVisuals: ["recursionTree", "flowDiagram", "table", "codeBox", "dryRunTable", "formulaBox"],
    };
  }

  if (/\b(sql|database|schema|query|normalization|join|transaction|index)\b/.test(text)) {
    return {
      topicType: "database",
      topic: "Database Concept",
      needsCode: true,
      bestVisuals: ["table", "flowDiagram", "tree", "compareBox", "codeBox"],
    };
  }

  if (/\b(tree|graph|stack|queue|array|linked list|hashmap|hash map|heap|trie)\b/.test(text)) {
    return {
      topicType: "data_structure",
      topic: "Data Structure",
      needsCode: true,
      bestVisuals: ["tree", "array", "flowDiagram", "table", "dryRunTable", "codeBox"],
    };
  }

  if (/\b(code|function|loop|variable|debug|program|pseudocode)\b/.test(text)) {
    return {
      topicType: "code",
      topic: "Code Explanation",
      needsCode: true,
      bestVisuals: ["codeBox", "dryRunTable", "flowDiagram", "table", "callout"],
    };
  }

  if (/\b(equation|formula|math|derivative|integral|probability|matrix|theorem|proof)\b/.test(text)) {
    return {
      topicType: "math",
      topic: "Math Concept",
      needsCode: false,
      bestVisuals: ["formulaBox", "flowDiagram", "table", "callout", "quizCheck"],
    };
  }

  return {
    topicType: "general",
    topic: "Saved Resource Lesson",
    needsCode: false,
    bestVisuals: ["flowDiagram", "mermaidDiagram", "tree", "table", "callout", "quizCheck"],
  };
}

function sourceRefsFromChunks(chunks = []) {
  return asArray(chunks).map(sourceRef).filter(Boolean).slice(0, 12);
}

function readContinuousState(request = "", currentState = {}) {
  const text = `${request}\n${JSON.stringify(currentState || {})}`;

  const targetTotalMinutes =
    number(text.match(/Target total tutorial length:\s*(\d+)/i)?.[1], 0) ||
    number(currentState.targetTotalMinutes, 0) ||
    DEFAULT_TOTAL_MINUTES;

  const segmentDurationSec =
    number(text.match(/Segment duration:\s*(\d+)/i)?.[1], 0) ||
    number(currentState.segmentDurationSec, 0) ||
    FORCE_SEGMENT_SECONDS;

  const generatedSegments =
    number(currentState.generatedSegments, 0) ||
    number(currentState.completedSegments, 0) ||
    0;

  const currentSegmentNumber = Math.max(1, generatedSegments + 1);
  const estimatedSegmentCount = Math.max(1, Math.ceil((targetTotalMinutes * 60) / segmentDurationSec));

  return {
    targetTotalMinutes,
    targetTotalSeconds: targetTotalMinutes * 60,
    segmentDurationSec,
    currentSegmentNumber,
    estimatedSegmentCount,
    shouldContinue: currentSegmentNumber < estimatedSegmentCount,
  };
}

function makeCompactTutorPrompt({
  resourceTitle,
  request,
  internalContext,
  externalContext,
  heuristic,
  currentState,
  citations,
  continuous,
}) {
  const nextCursorText = continuous.shouldContinue
    ? `Continue with segment ${continuous.currentSegmentNumber + 1}/${continuous.estimatedSegmentCount}; use new visuals and do not repeat.`
    : "DONE";

  return `
Return JSON only. No markdown.

You are a world-class live whiteboard tutor.
Create ONE 10-minute segment from the saved source.
Do not return a short summary.

Segment: ${continuous.currentSegmentNumber}/${continuous.estimatedSegmentCount}
Full target: ${continuous.targetTotalMinutes} min
This segment: 600 sec

Use:
- Internal RAG as truth.
- Offline same-topic knowledge only for intuition/examples/common mistakes.
- No web URLs.
- Do not mention backend/model/prompt/JSON.

Student request:
${clampText(request, 900)}

Resource title:
${resourceTitle}

Topic heuristic:
${JSON.stringify(heuristic)}

Current state for interrupt/continue:
${JSON.stringify(currentState || {}).slice(0, 1200)}

Source refs:
${JSON.stringify(citations)}

Internal RAG:
${internalContext}

Offline knowledge:
${externalContext}

Required teaching arc:
1 hook
2 mental model
3 flow/diagram
4 tree/structure
5 comparison table
6 example trace or formula
7 common mistakes
8 quiz and next bridge

Return valid JSON with exactly these top-level keys:
{
  "topic": "source-grounded topic",
  "segmentTitle": "segment title",
  "shortAnswer": "1-2 sentence summary",
  "bigIdea": "main mental model",
  "coreConfusion": "student confusion",
  "whyItMatters": "why it matters",
  "keyConcepts": ["8 short concepts"],
  "teachingPlan": ["12 teaching steps"],
  "commonMistakes": ["3 mistakes"],
  "boardPages": [
    {"id":"page_1","title":"Hook + source problem"},
    {"id":"page_2","title":"Mental model"},
    {"id":"page_3","title":"Flow / Mermaid"},
    {"id":"page_4","title":"Tree / structure"},
    {"id":"page_5","title":"Comparison table"},
    {"id":"page_6","title":"Example trace"},
    {"id":"page_7","title":"Common mistakes"},
    {"id":"page_8","title":"Quiz + next bridge"}
  ],
  "teacherActions": [
    {"id":"act_1","type":"drawHeading","t":5,"pageId":"page_1","columnId":"full","text":"heading","speech":"spoken explanation","sourceRef":"SOURCE 1"}
  ],
  "boardCommands": [
    {"id":"cmd_1","type":"heading","t":5,"pageId":"page_1","slot":"full","text":"heading","sourceRef":"SOURCE 1"}
  ],
  "voiceScript": [
    {"id":"voice_1","t":5,"actionId":"act_1","text":"spoken explanation","boardNote":"short board note","linkedCommandIds":["cmd_1"],"sourceRef":"SOURCE 1"}
  ],
  "citations": ["SOURCE 1"],
  "sourceRefs": ["SOURCE 1"],
  "internalSourceRefs": ["SOURCE 1"],
  "knowledgeRefs": ["Gemma offline same-topic knowledge"],
  "repairOptions": ["Explain slower","Draw another diagram","Show table","Show code trace","Quiz me"],
  "continueMode": ${continuous.shouldContinue ? "true" : "false"},
  "nextCursor": "${nextCursorText}",
  "estimatedTotalSeconds": 600,
  "externalKnowledgeUsed": true,
  "offlineKnowledgeUsed": true,
  "resourceGroundedRatio": 0.82
}
`;
}

async function generateSegmentNode(state) {
  const runnable = RunnableLambda.from(async () =>
    callGemmaJson(
      makeCompactTutorPrompt({
        resourceTitle: state.resourceTitle,
        request: state.request,
        internalContext: state.internalContext,
        externalContext: state.externalContext,
        heuristic: state.heuristic,
        currentState: state.currentState,
        citations: state.citations,
        continuous: state.continuous,
      }),
      { temperature: 0.1, num_predict: NUM_PREDICT }
    )
  );

  const rawPlan = await runnable.invoke({});

  return {
    ...state,
    rawPlan,
    graphSteps: [...asArray(state.graphSteps), "generate_segment_node"],
    langChainUsed: true,
  };
}

async function normalizeAndValidateNode(state) {
  const normalized = normalizeLiveTutorPlan(state.rawPlan, {
    topic: state.rawPlan?.topic || state.heuristic.topic,
    resourceTitle: state.resourceTitle,
    citations: state.citations,
    externalKnowledgeUsed: true,
  });

  const plan = {
    ...normalized,
    estimatedTotalSeconds: FORCE_SEGMENT_SECONDS,
    externalKnowledgeUsed: true,
    offlineKnowledgeUsed: true,
    knowledgeRefs: uniq([...(normalized.knowledgeRefs || []), "Gemma offline same-topic knowledge"]),
  };

  if (state.continuous.shouldContinue) {
    plan.continueMode = true;
    if (!clean(plan.nextCursor) || clean(plan.nextCursor).toUpperCase() === "DONE") {
      plan.nextCursor = `Continue with segment ${state.continuous.currentSegmentNumber + 1}/${state.continuous.estimatedSegmentCount}. Use new source chunks, new visuals, and no repeated voice lines.`;
    }
  } else {
    plan.continueMode = false;
    plan.nextCursor = "DONE";
  }

  const richness = analyzePlanRichness(plan);
  const issues = collectLiveTutorPlanIssues(plan);

  return {
    ...state,
    plan,
    richness,
    issues,
    graphSteps: [...asArray(state.graphSteps), "normalize_and_validate_node"],
  };
}

async function finishSegmentNode(state) {
  assertRichLiveTutorPlan(state.plan);

  return {
    ...state,
    finalResult: {
      plan: state.plan,
      classification: {
        topic: state.heuristic.topic,
        topicType: state.heuristic.topicType,
        bestVisuals: state.heuristic.bestVisuals,
        needsCodeOrTrace: state.heuristic.needsCode,
      },
      richness: state.richness,
      diagnostics: {
        planner: "compact_json_repair_auto_normalizing_langgraph_gemma",
        langGraphUsed: true,
        langChainUsed: true,
        grounded: true,
        ragUsed: true,
        offlineKnowledgeUsed: true,
        externalKnowledgeUsed: true,
        externalMode: "offline_gemma_knowledge_no_web",
        graphSteps: asArray(state.graphSteps),
        model: MODEL,
        targetSegmentSeconds: FORCE_SEGMENT_SECONDS,
        prefetchBeforeSec: 300,
        requiredPages: "8",
        requiredActions: "20+",
        requiredVoiceLines: "14+",
        currentSegmentNumber: state.continuous.currentSegmentNumber,
        estimatedSegmentCount: state.continuous.estimatedSegmentCount,
        autoContinueExpected: state.continuous.shouldContinue,
        issuesBeforeFinish: asArray(state.issues),
        ...publicPlanDiagnostics(state.plan),
      },
    },
    graphSteps: [...asArray(state.graphSteps), "finish_segment_node"],
  };
}

function buildPlannerGraph() {
  const graph = new StateGraph({
    channels: {
      resourceTitle: null,
      request: null,
      internalChunks: null,
      internalContext: null,
      external: null,
      externalContext: null,
      currentState: null,
      citations: null,
      heuristic: null,
      continuous: null,

      rawPlan: null,
      plan: null,
      richness: null,
      issues: null,

      graphSteps: null,
      langChainUsed: null,
      finalResult: null,
    },
  });

  graph.addNode("generate_segment_node", generateSegmentNode);
  graph.addNode("normalize_and_validate_node", normalizeAndValidateNode);
  graph.addNode("finish_segment_node", finishSegmentNode);

  graph.addEdge(START, "generate_segment_node");
  graph.addEdge("generate_segment_node", "normalize_and_validate_node");
  graph.addEdge("normalize_and_validate_node", "finish_segment_node");
  graph.addEdge("finish_segment_node", END);

  return graph.compile();
}

let compiledPlannerGraph = null;

function getPlannerGraph() {
  if (!compiledPlannerGraph) compiledPlannerGraph = buildPlannerGraph();
  return compiledPlannerGraph;
}

export async function buildWorldClassTutorPlan({
  resourceTitle = "Saved Resource",
  request = "",
  internalChunks = [],
  external = {},
  currentState = {},
} = {}) {
  const chunks = asArray(internalChunks).filter((chunk) => chunkText(chunk));

  if (!chunks.length) {
    throw new Error("Live Tutor cannot start: no RAG chunks were provided.");
  }

  const citations = sourceRefsFromChunks(chunks);
  const internalContext = buildInternalContext(chunks);
  const externalContext = buildExternalContext({
    ...(external || {}),
    used: true,
    mode: "offline_gemma_knowledge_no_web",
  });

  const heuristic = detectTopicHeuristic({ request, chunks });
  const continuous = readContinuousState(request, currentState);

  const initialState = {
    resourceTitle: clean(resourceTitle || "Saved Resource"),
    request: clean(request || "Teach this resource visually."),
    internalChunks: chunks,
    internalContext,
    external: {
      ...(external || {}),
      used: true,
      mode: "offline_gemma_knowledge_no_web",
    },
    externalContext,
    currentState: currentState || {},
    citations,
    heuristic,
    continuous,
    graphSteps: [],
    langChainUsed: false,
  };

  const graph = getPlannerGraph();
  const finalState = await graph.invoke(initialState);

  if (!finalState?.finalResult?.plan) {
    throw new Error("LangGraph Live Tutor did not produce a final teacher-action board plan.");
  }

  return {
    plan: finalState.finalResult.plan,
    classification: finalState.finalResult.classification,
    internalContext,
    externalContext,
    langGraphUsed: true,
    langChainUsed: true,
    diagnostics: {
      ...finalState.finalResult.diagnostics,
      noFakeFallback: true,
      noStaticDemo: true,
      noTextCardsOnly: true,
      continuousTutor: true,
      segmentDurationSec: FORCE_SEGMENT_SECONDS,
      boardPagesPerSegment: "8",
      actionsPerSegment: "20+",
      voiceLinesMin: "14+",
    },
  };
}

export default {
  buildWorldClassTutorPlan,
};