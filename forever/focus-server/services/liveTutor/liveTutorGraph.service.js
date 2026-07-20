import crypto from "crypto";

import LiveTutorInteraction from "../../models/LiveTutorInteraction.js";

import {
  callOllamaJson,
  callOllamaVisionJson,
  embedText,
} from "../ollamaCompat.service.js";

import { buildLiveTutorVisionPack } from "./liveTutorVisionCrop.service.js";

const LIVE_TUTOR_TIMEOUT_MS = Number(
  process.env.LIVE_TUTOR_GEMMA_TIMEOUT_MS ||
    process.env.GOOD_CONTENT_GEMMA_TIMEOUT_MS ||
    process.env.OLLAMA_CLOUD_TIMEOUT_MS ||
    300000
);

const LIVE_TUTOR_MODEL =
  process.env.LIVE_TUTOR_MODEL ||
  process.env.GOOD_CONTENT_GEMMA_MODEL ||
  process.env.OLLAMA_CLOUD_MODEL ||
  process.env.OLLAMA_MODEL ||
  undefined;

const LIVE_TUTOR_VISION_MODEL =
  process.env.LIVE_TUTOR_VISION_MODEL ||
  process.env.OLLAMA_VISION_MODEL ||
  LIVE_TUTOR_MODEL;

const LIVE_TUTOR_NUM_CTX = Number(
  process.env.LIVE_TUTOR_NUM_CTX || process.env.OLLAMA_NUM_CTX || 8192
);

const LIVE_TUTOR_NUM_PREDICT = Number(process.env.LIVE_TUTOR_NUM_PREDICT || 3800);

const LIMITS = {
  transcript: Number(process.env.LIVE_TUTOR_MAX_TRANSCRIPT_CHARS || 12000),
  visibleText: Number(process.env.LIVE_TUTOR_MAX_VISIBLE_TEXT_CHARS || 9000),
  pageText: Number(process.env.LIVE_TUTOR_MAX_PAGE_TEXT_CHARS || 11000),
  selectedText: Number(process.env.LIVE_TUTOR_MAX_SELECTED_TEXT_CHARS || 6500),
  memoryHits: Number(process.env.LIVE_TUTOR_MAX_MEMORY_HITS || 6),
};

const LIVE_TUTOR_ENABLE_EMBEDDINGS =
  String(process.env.LIVE_TUTOR_ENABLE_EMBEDDINGS || "true").toLowerCase() !== "false";

function nowMs() {
  return Date.now();
}

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

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function hashText(value = "") {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function compactHash(value = "") {
  return hashText(value).slice(0, 24);
}

function detectBanglaRoman(text = "") {
  return /\b(ami|amar|amake|bujhi|bujhini|bujhte|kivabe|kibhabe|keno|eta|eita|ki|theke|chai|lagbe|bhalo|kharap|koro|dao|bolo)\b/i.test(
    text
  );
}

function detectLanguage({
  userQuestion = "",
  selectedText = "",
  transcriptContext = "",
  studentAnswer = "",
} = {}) {
  const text = `${userQuestion} ${selectedText} ${transcriptContext} ${studentAnswer}`;

  if (/[\u0980-\u09FF]/.test(text)) return "bangla";
  if (detectBanglaRoman(text)) return "bangla";
  if (/[a-z]/i.test(text)) return "english";

  return "auto";
}

function detectPlatform(url = "") {
  const value = String(url || "").toLowerCase();

  if (value.includes("youtube.com") || value.includes("youtu.be")) return "youtube";
  if (value.includes("leetcode.com")) return "leetcode";
  if (value.includes("github.com")) return "github";
  if (value.includes(".pdf") || value.includes("/pdf")) return "pdf";
  if (value.includes("docs.") || value.includes("/docs/")) return "docs";
  if (/^https?:\/\//i.test(value)) return "webpage";

  return "unknown";
}

function extractOrigin(url = "") {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function extractVideoId(url = "") {
  const value = String(url || "");

  const watch = value.match(/[?&]v=([^&]+)/);
  if (watch?.[1]) return watch[1];

  const embed = value.match(/youtube\.com\/embed\/([^?&/]+)/);
  if (embed?.[1]) return embed[1];

  const short = value.match(/youtu\.be\/([^?&/]+)/);
  if (short?.[1]) return short[1];

  return "";
}

function normalizeRect(rect = {}) {
  return {
    x: safeNumber(rect.x),
    y: safeNumber(rect.y),
    width: safeNumber(rect.width),
    height: safeNumber(rect.height),
    pageWidth: safeNumber(rect.pageWidth),
    pageHeight: safeNumber(rect.pageHeight),
    viewportWidth: safeNumber(rect.viewportWidth),
    viewportHeight: safeNumber(rect.viewportHeight),
    scrollX: safeNumber(rect.scrollX),
    scrollY: safeNumber(rect.scrollY),
    devicePixelRatio: safeNumber(rect.devicePixelRatio, 1),
  };
}

function normalizeMode(mode = "") {
  const value = clean(mode).toLowerCase();

  const allowed = new Set([
    "explain_frame",
    "explain_selection",
    "why_this_step",
    "simplify",
    "dry_run",
    "interrupt",
    "explain_back",
    "repair_confusion",
    "roadmap",
    "quiz_me",
  ]);

  return allowed.has(value) ? value : "explain_frame";
}

function normalizeLanguageHint(value = "") {
  const v = clean(value).toLowerCase();
  if (["auto", "english", "bangla", "mixed"].includes(v)) return v;
  return "auto";
}

function dataUrlToImageInfo(dataUrl = "") {
  const value = String(dataUrl || "").trim();

  if (!value) {
    return {
      mime: "",
      imageBase64: "",
      hash: "",
    };
  }

  const match = value.match(/^data:([^;]+);base64,(.+)$/);

  if (match?.[2]) {
    return {
      mime: match[1] || "image/png",
      imageBase64: match[2],
      hash: compactHash(match[2]),
    };
  }

  return {
    mime: "image/png",
    imageBase64: value,
    hash: compactHash(value),
  };
}

function normalizeTranscriptWindow(payload = {}) {
  const tw = payload.transcriptWindow || {};

  return {
    current: trimText(tw.current || payload.currentCaption || "", 1800),
    before: trimText(tw.before || payload.transcriptBefore || "", 4500),
    after: trimText(tw.after || payload.transcriptAfter || "", 4500),
    full: trimText(
      tw.full || payload.transcriptContext || payload.transcript || "",
      LIMITS.transcript
    ),
    startSeconds: safeNumber(tw.startSeconds || payload.transcriptStartSeconds),
    endSeconds: safeNumber(tw.endSeconds || payload.transcriptEndSeconds),
  };
}

function buildSessionKey(payload = {}) {
  const userId = clean(payload.userId) || "guest";
  const deviceId = clean(payload.deviceId) || "web";
  const url = clean(payload.url) || "unknown-url";
  const videoId = clean(payload.videoId) || extractVideoId(url);
  const basis = videoId || url;

  return `${userId}:${deviceId}:${basis}`.slice(0, 260);
}

function buildRequestHash(input = {}) {
  return compactHash(
    JSON.stringify({
      sessionKey: input.sessionKey,
      mode: input.mode,
      timestampSeconds: Math.round(input.timestampSeconds || 0),
      userQuestion: input.userQuestion,
      selectedText: input.selectedText,
      currentCaption: input.currentCaption,
      screenshotHash: input.screenshotHash,
      cropHash: input.cropHash,
    })
  );
}

async function normalizePayload(payload = {}) {
  const url = clean(payload.url);
  const screenshot = dataUrlToImageInfo(
    payload.screenshotDataUrl || payload.screenshot || payload.frameDataUrl || ""
  );

  const transcriptWindow = normalizeTranscriptWindow(payload);

  const userQuestion = trimText(payload.userQuestion || payload.question || "", 3000);
  const studentAnswer = trimText(payload.studentAnswer || payload.explainBack || "", 5000);

  const selectedText = trimText(
    payload.selectedText || payload.selectionText || "",
    LIMITS.selectedText
  );

  const visibleText = trimText(
    payload.visibleText || payload.visiblePageText || "",
    LIMITS.visibleText
  );

  const pageText = trimText(
    payload.pageText || payload.documentText || "",
    LIMITS.pageText
  );

  const transcriptContext = trimText(
    payload.transcriptContext ||
      payload.transcript ||
      transcriptWindow.full ||
      [transcriptWindow.before, transcriptWindow.current, transcriptWindow.after]
        .filter(Boolean)
        .join("\n"),
    LIMITS.transcript
  );

  const detectedLanguage = detectLanguage({
    userQuestion,
    selectedText,
    transcriptContext,
    studentAnswer,
  });

  const languageHint =
    normalizeLanguageHint(payload.languageHint) === "auto"
      ? detectedLanguage
      : normalizeLanguageHint(payload.languageHint);

  const platform = payload.platform || detectPlatform(url);
  const selectedRect = normalizeRect(payload.selectedRect || payload.rect || {});

  const visionPack = await buildLiveTutorVisionPack({
    screenshotDataUrl:
      payload.screenshotDataUrl || payload.screenshot || payload.frameDataUrl || "",
    selectedRect,
    markedElements: safeArray(payload.markedElements),
    platform,
    timestampSeconds: safeNumber(payload.timestampSeconds || payload.currentTime),
  });

  return {
    userId: clean(payload.userId) || "guest",
    deviceId: clean(payload.deviceId) || "web",
    sessionKey: clean(payload.sessionKey) || buildSessionKey(payload),

    platform,
    url,
    origin: extractOrigin(url),
    title: clean(payload.title || payload.pageTitle || "Untitled page"),

    videoId: clean(payload.videoId) || extractVideoId(url),
    timestampSeconds: safeNumber(payload.timestampSeconds || payload.currentTime),
    durationSeconds: safeNumber(payload.durationSeconds || payload.duration),

    mode: normalizeMode(payload.mode),
    userQuestion,
    studentAnswer,

    selectedText,
    visibleText,
    pageText,
    pageStructure: payload.pageStructure || null,
    markedElements: safeArray(payload.markedElements).slice(0, 12),

    transcriptContext,
    transcriptWindow,
    currentCaption: trimText(payload.currentCaption || transcriptWindow.current || "", 1800),

    selectedRect,

    screenshotDataUrl:
      payload.screenshotDataUrl || payload.screenshot || payload.frameDataUrl || "",
    screenshotMime: screenshot.mime,
    screenshotBase64: screenshot.imageBase64,
    screenshotHash: screenshot.hash,
    hasScreenshot: Boolean(screenshot.imageBase64),

    visionPack,
    visionImages: visionPack.images || [],
    visionFocusText: visionPack.focusText || "",
    usedMarkedCrop: Boolean(visionPack.usedCrop),
    cropHash: visionPack.cropHash || "",
    cropBox: visionPack.cropBox || null,

    languageHint,

    workflowContext: payload.workflowContext || payload.workflow || null,
    retrievedContext: safeArray(payload.retrievedContext || payload.workflow?.retrievedContext),

    clientMeta: {
      extensionVersion: clean(payload.extensionVersion),
      userAgent: clean(payload.userAgent),
      viewport: payload.viewport || null,
    },
  };
}

function pushTrace(trace, name, status = "done", detail = "", started = null) {
  trace.push({
    name,
    status,
    detail,
    latencyMs: started ? nowMs() - started : 0,
    at: new Date(),
  });
}

function chooseTaskInstruction(input) {
  const map = {
    explain_frame:
      "Explain the current video/webpage moment. Connect marked screenshot/frame, transcript, selected text, visible page context, and prior memory.",
    explain_selection:
      "Explain the selected/marked region deeply. Focus only on what the student marked and why it matters.",
    why_this_step:
      "Explain why this exact step is needed, what problem it solves, and what would go wrong without it.",
    simplify:
      "Teach the same idea with a simple analogy, then reconnect it to the original marked screen/transcript.",
    dry_run:
      "Create a precise human-instructor style dry run. For algorithms/code, show state changes in table form.",
    interrupt:
      "Handle the student's interruption without losing the original lesson context. Answer briefly, then give a resume line.",
    explain_back:
      "Evaluate the student's explanation. Find correct parts, missing parts, wrong parts, and produce a repair lesson.",
    repair_confusion:
      "Repair the student's weak concept. Use small steps, misconception correction, and one check question.",
    roadmap:
      "Build a small learning flow for only this page/video section: prerequisite, current idea, next idea, weak nodes.",
    quiz_me:
      "Generate short diagnostic practice questions based only on the current screen/transcript/marked region.",
  };

  return map[input.mode] || map.explain_frame;
}

function getTutorSystemPrompt() {
  return [
    "You are LearnLens Live AI Tutor inside a Chrome extension.",
    "You are screen-aware, transcript-aware, marked-region-aware, and memory-aware.",
    "You tutor students while they watch YouTube, read docs, solve LeetCode, inspect GitHub/code, or read webpages.",
    "",
    "Non-negotiable behavior:",
    "1. Do NOT act like a generic chatbot.",
    "2. Use the provided screenshot/crop, marked rectangle, transcript, selected text, visible DOM, page/code/table data, and memory.",
    "3. If a marked rectangle exists, explain ONLY that marked/current area plus nearby transcript/page context.",
    "4. If the human instructor/video explanation is unclear, produce a better human-tutor explanation.",
    "5. For code/algorithm, generate dryRun.rows and visual state simulation when useful.",
    "6. Detect misconception and produce a repair explanation.",
    "7. Ask one explain-back/check question when useful.",
    "8. If the student uses Bangla/Banglish, answer naturally in Bangla/Banglish. If English, answer in English.",
    "9. Do not invent exact visual details that are not visible or supported.",
    "10. Output valid JSON only.",
  ].join("\n");
}

function getOutputSchemaInstruction() {
  return `
Return strict JSON only with this shape:

{
  "headline": "short useful title",
  "shortAnswer": "1-2 line direct answer",
  "explanation": "deep human tutor style explanation grounded in current marked/screen/transcript context",

  "tutorScratchpad": [
    {
      "label": "Target",
      "value": "4",
      "detail": "why this value matters",
      "formula": "complement = target - nums[i]"
    }
  ],

  "visualBreakdown": [
    {
      "step": 1,
      "title": "Current focus",
      "detail": "what the student should notice on screen",
      "kind": "algorithm|diagram|concept|code|math|webpage",
      "highlight": "marked array cell / transcript line / code line"
    }
  ],

  "dryRun": {
    "available": true,
    "title": "Human instructor dry run",
    "problemType": "algorithm|code|logic|none",
    "columns": ["step", "state before", "check", "decision", "state after", "why"],
    "rows": [
      {
        "step": 1,
        "stateBefore": "{}",
        "check": "current condition",
        "decision": "what happens",
        "stateAfter": "{...}",
        "why": "why this step matters"
      }
    ],
    "currentPointer": "i = 0",
    "stateSummary": "short state summary",
    "complexity": {
      "time": "O(n)",
      "space": "O(n)",
      "why": "why this complexity"
    }
  },

  "misconceptionCheck": {
    "likelyConfusion": "what the student may misunderstand",
    "wrongMentalModel": "the incorrect thinking pattern",
    "repairExplanation": "clear correction",
    "askBackQuestion": "one question to check understanding",
    "severity": "none|low|medium|high"
  },

  "thinkingScore": {
    "level": "passive|active|constructive|reflective|unknown",
    "score": 75,
    "reason": "why this score",
    "evidence": "what user did/said",
    "nextImprovement": "how to improve thinking"
  },

  "explainBackEvaluation": {
    "studentClaimSummary": "summary of student's answer",
    "correctParts": ["..."],
    "missingParts": ["..."],
    "wrongParts": ["..."],
    "improvedAnswer": "better explanation the student should learn",
    "score": 0
  },

  "roadmap": {
    "nodes": [
      { "id": "prereq", "label": "Prerequisite", "status": "known", "why": "..." },
      { "id": "current", "label": "Current step", "status": "current", "why": "..." },
      { "id": "next", "label": "Next idea", "status": "next", "why": "..." }
    ],
    "edges": [
      { "from": "prereq", "to": "current", "label": "needed for" }
    ],
    "currentNodeId": "current"
  },

  "suggestedPractice": [
    {
      "title": "Mini check",
      "prompt": "small practice question",
      "expectedAnswerHint": "hint only",
      "difficulty": "easy|medium|hard"
    }
  ],

  "actions": [
    { "id": "explain_frame", "label": "Explain this frame", "intent": "explain_frame" },
    { "id": "why_this_step", "label": "Why this step?", "intent": "why_this_step" },
    { "id": "dry_run", "label": "Dry run", "intent": "dry_run" },
    { "id": "simplify", "label": "Simplify", "intent": "simplify" },
    { "id": "explain_back", "label": "Check my explanation", "intent": "explain_back" }
  ],

  "sourcesUsed": [
    {
      "sourceType": "screenshot|crop|transcript|selected_text|visible_text|page_text|rag_memory|board_memory",
      "label": "source label",
      "preview": "short evidence preview",
      "score": 1
    }
  ],

  "weakConcepts": ["specific weak concept"],
  "masteredConcepts": ["specific mastered concept"],
  "followUpQuestion": "one useful question for the student",
  "confidence": "low|medium|high"
}

Rules:
- If dry-run is not useful, set dryRun.available=false and rows=[].
- If explain_back mode is not used, explainBackEvaluation can be empty/default.
- confidence must be "low", "medium", or "high".
- thinkingScore.score and explainBackEvaluation.score must be 0-100.
- Keep arrays short and useful.
`;
}

function buildMemoryTextFromItem(item = {}) {
  const weak = safeArray(item.response?.weakConcepts).join(", ");

  return [
    item.response?.headline,
    item.response?.shortAnswer,
    item.response?.misconceptionCheck?.likelyConfusion,
    item.response?.thinkingScore?.reason,
    weak,
  ]
    .filter(Boolean)
    .join(" | ");
}

function simpleScoreMemory(input, item) {
  const query = [
    input.userQuestion,
    input.selectedText,
    input.currentCaption,
    input.transcriptContext,
    input.studentAnswer,
  ]
    .join(" ")
    .toLowerCase();

  const memory = buildMemoryTextFromItem(item).toLowerCase();

  if (!query || !memory) return 0;

  const terms = query
    .split(/[^a-zA-Z0-9\u0980-\u09FF]+/)
    .filter((t) => t.length > 3)
    .slice(0, 80);

  let score = 0;

  for (const term of terms) {
    if (memory.includes(term)) score += 1;
  }

  if (item.mode === input.mode) score += 2;
  if (item.platform === input.platform) score += 1;

  return score;
}

async function retrieveSessionMemory(input, trace) {
  const started = nowMs();

  const recent = await LiveTutorInteraction.find({
    sessionKey: input.sessionKey,
    status: "ready",
  })
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();

  const scored = recent
    .map((item) => ({
      item,
      score: simpleScoreMemory(input, item),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, LIMITS.memoryHits)
    .map(({ item, score }) => ({
      interactionId: item._id,
      mode: item.mode,
      title: item.response?.headline || item.title || "",
      weakness: safeArray(item.response?.weakConcepts).slice(0, 4).join(", "),
      preview: trimText(buildMemoryTextFromItem(item), 350),
      score,
      createdAt: item.createdAt,
    }));

  pushTrace(trace, "retrieve_session_memory", "done", `${scored.length} memory hits`, started);

  return scored;
}

async function buildEmbedding(input, trace) {
  if (!LIVE_TUTOR_ENABLE_EMBEDDINGS) {
    pushTrace(trace, "embedding", "skipped", "LIVE_TUTOR_ENABLE_EMBEDDINGS=false");
    return { embeddingText: "", embedding: undefined };
  }

  const embeddingText = trimText(
    [
      input.title,
      input.platform,
      input.userQuestion,
      input.selectedText,
      input.currentCaption,
      input.transcriptContext,
      input.studentAnswer,
    ]
      .filter(Boolean)
      .join("\n"),
    2500
  );

  if (!embeddingText) {
    pushTrace(trace, "embedding", "skipped", "empty embedding text");
    return { embeddingText: "", embedding: undefined };
  }

  const started = nowMs();

  try {
    const embedding = await embedText(embeddingText, {
      timeoutMs: Number(process.env.LIVE_TUTOR_EMBED_TIMEOUT_MS || 90000),
    });

    pushTrace(
      trace,
      "embedding",
      Array.isArray(embedding) && embedding.length ? "done" : "skipped",
      Array.isArray(embedding) && embedding.length
        ? `embedding dims=${embedding.length}`
        : "embedding unavailable",
      started
    );

    return {
      embeddingText,
      embedding: Array.isArray(embedding) && embedding.length ? embedding : undefined,
    };
  } catch (error) {
    pushTrace(trace, "embedding", "failed", error.message, started);
    return { embeddingText, embedding: undefined };
  }
}

function buildMemoryBlock(memoryHits = []) {
  if (!memoryHits.length) return "No previous useful memory for this session.";

  return memoryHits
    .map((hit, index) => {
      return [
        `MEMORY_${index + 1}:`,
        `mode: ${hit.mode}`,
        `weakness: ${hit.weakness || "none"}`,
        `preview: ${hit.preview}`,
      ].join("\n");
    })
    .join("\n\n");
}

function buildRagBlock(input = {}) {
  const hits = safeArray(input.retrievedContext);

  if (!hits.length) return "No external RAG/board memory was retrieved.";

  return hits
    .slice(0, 8)
    .map((hit, index) => {
      return [
        `RAG_${index + 1}:`,
        `source: ${hit.source || hit.meta?.source || "memory"}`,
        `score: ${hit.score || 0}`,
        `title: ${hit.meta?.title || ""}`,
        `preview: ${hit.preview || trimText(hit.text || "", 350)}`,
      ].join("\n");
    })
    .join("\n\n");
}

function buildMarkedElementsBlock(markedElements = []) {
  const list = safeArray(markedElements).slice(0, 12);

  if (!list.length) return "No marked DOM elements captured.";

  return JSON.stringify(
    list.map((item, index) => ({
      index,
      label: clean(item.label).slice(0, 240),
      text: trimText(item.text || "", 900),
      tagName: item.tagName || "",
      rect: item.rect || null,
    })),
    null,
    2
  );
}

function buildPageStructureBlock(pageStructure = {}) {
  if (!pageStructure) return "No page structure captured.";

  return JSON.stringify(
    {
      headings: safeArray(pageStructure.headings).slice(0, 20),
      codeBlocks: safeArray(pageStructure.codeBlocks)
        .slice(0, 8)
        .map((x) => ({
          label: x.label,
          text: trimText(x.text || "", 1200),
        })),
      tables: safeArray(pageStructure.tables)
        .slice(0, 5)
        .map((x) => ({
          label: x.label,
          text: trimText(x.text || "", 1000),
        })),
      images: safeArray(pageStructure.images).slice(0, 8),
    },
    null,
    2
  );
}

function buildContextBlock(input, memoryHits = []) {
  return [
    "BROWSER_CONTEXT",
    `platform: ${input.platform}`,
    `title: ${input.title}`,
    `url: ${input.url}`,
    `origin: ${input.origin}`,
    `videoId: ${input.videoId || "none"}`,
    `timestampSeconds: ${input.timestampSeconds}`,
    `durationSeconds: ${input.durationSeconds}`,
    `mode: ${input.mode}`,
    `languageHint: ${input.languageHint}`,
    "",
    "STRICT_VISUAL_SCOPE",
    input.selectedRect?.width > 8
      ? "Student marked a screen/video box. Explain ONLY that marked region and immediate transcript/page context."
      : input.selectedText
        ? "Student selected text. Explain ONLY selected text and nearby context."
        : "No box/text selected. Explain current visible learning moment only.",
    "",
    "USER_QUESTION",
    input.userQuestion || "(No direct question. Explain the current/selected part.)",
    "",
    "STUDENT_EXPLAIN_BACK_OR_ANSWER",
    input.studentAnswer || "(none)",
    "",
    "VISION_CROP_AND_RECT_CONTEXT",
    input.visionFocusText || "(no vision focus text)",
    "",
    "MARKED_DOM_ELEMENTS",
    buildMarkedElementsBlock(input.markedElements),
    "",
    "PAGE_STRUCTURE",
    buildPageStructureBlock(input.pageStructure),
    "",
    "CURRENT_CAPTION",
    input.currentCaption || "(none)",
    "",
    "TRANSCRIPT_WINDOW",
    `before:\n${input.transcriptWindow.before || "(none)"}`,
    "",
    `current:\n${input.transcriptWindow.current || input.currentCaption || "(none)"}`,
    "",
    `after:\n${input.transcriptWindow.after || "(none)"}`,
    "",
    "TRANSCRIPT_CONTEXT_FULL",
    input.transcriptContext || "(none)",
    "",
    "SELECTED_TEXT",
    input.selectedText || "(none)",
    "",
    "VISIBLE_TEXT",
    input.visibleText || "(none)",
    "",
    "PAGE_TEXT",
    input.pageText || "(none)",
    "",
    "SESSION_MEMORY",
    buildMemoryBlock(memoryHits),
    "",
    "RAG_AND_BOARD_MEMORY",
    buildRagBlock(input),
    "",
    "WORKFLOW_CONTEXT",
    input.workflowContext
      ? JSON.stringify(
          {
            focusInstruction: input.workflowContext.focusInstruction,
            conceptTags: input.workflowContext.conceptTags,
            tutorStrategy: input.workflowContext.tutorStrategy,
            boardPlan: input.workflowContext.boardPlan,
            simulationPlan: input.workflowContext.simulationPlan,
            voicePlan: input.workflowContext.voicePlan,
            vision: input.workflowContext.vision,
          },
          null,
          2
        )
      : "(none)",
  ].join("\n");
}

function normalizeArray(value, max = 10) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function normalizeActionButtons(actions = []) {
  const fallback = [
    { id: "explain_frame", label: "Explain this frame", intent: "explain_frame" },
    { id: "why_this_step", label: "Why this step?", intent: "why_this_step" },
    { id: "dry_run", label: "Dry run", intent: "dry_run" },
    { id: "simplify", label: "Simplify", intent: "simplify" },
    { id: "explain_back", label: "Check my explanation", intent: "explain_back" },
  ];

  const list = Array.isArray(actions) && actions.length ? actions : fallback;

  return list.slice(0, 8).map((item) => ({
    id: clean(item.id) || clean(item.intent) || "action",
    label: clean(item.label) || "Action",
    intent: clean(item.intent) || clean(item.id) || "explain_frame",
    payload: item.payload || null,
  }));
}

function normalizeSources(sources = []) {
  return normalizeArray(sources, 12).map((item) => ({
    sourceType: clean(item.sourceType || item.type || "system"),
    label: clean(item.label),
    preview: trimText(item.preview, 320),
    score: safeNumber(item.score),
  }));
}

function normalizeTutorResponse(ai = {}, mode = "explain_frame") {
  const dryRun = ai.dryRun || {};
  const misconception = ai.misconceptionCheck || {};
  const thinking = ai.thinkingScore || {};
  const explainBack = ai.explainBackEvaluation || {};
  const roadmap = ai.roadmap || {};

  const score = Math.max(0, Math.min(100, safeNumber(thinking.score)));
  const explainBackScore = Math.max(0, Math.min(100, safeNumber(explainBack.score)));

  const confidence = ["low", "medium", "high"].includes(clean(ai.confidence))
    ? clean(ai.confidence)
    : "medium";

  return {
    mode,

    headline: clean(ai.headline) || "Live tutor explanation",
    shortAnswer: clean(ai.shortAnswer),
    explanation: longClean(ai.explanation),

    tutorScratchpad: normalizeArray(ai.tutorScratchpad, 12).map((item) => ({
      label: clean(item.label),
      value: clean(item.value),
      detail: clean(item.detail),
      formula: clean(item.formula),
    })),

    visualBreakdown: normalizeArray(ai.visualBreakdown, 14).map((item, index) => ({
      step: safeNumber(item.step, index + 1),
      title: clean(item.title),
      detail: clean(item.detail),
      kind: clean(item.kind) || "concept",
      highlight: clean(item.highlight),
    })),

    dryRun: {
      available: Boolean(dryRun.available),
      title: clean(dryRun.title),
      problemType: clean(dryRun.problemType),
      columns: normalizeArray(dryRun.columns, 14).map(clean),
      rows: normalizeArray(dryRun.rows, 40),
      currentPointer: clean(dryRun.currentPointer),
      stateSummary: clean(dryRun.stateSummary),
      complexity: {
        time: clean(dryRun.complexity?.time),
        space: clean(dryRun.complexity?.space),
        why: clean(dryRun.complexity?.why),
      },
    },

    misconceptionCheck: {
      likelyConfusion: clean(misconception.likelyConfusion),
      wrongMentalModel: clean(misconception.wrongMentalModel),
      repairExplanation: clean(misconception.repairExplanation),
      askBackQuestion: clean(misconception.askBackQuestion),
      severity: ["none", "low", "medium", "high"].includes(clean(misconception.severity))
        ? clean(misconception.severity)
        : "none",
    },

    thinkingScore: {
      level: ["passive", "active", "constructive", "reflective", "unknown"].includes(
        clean(thinking.level)
      )
        ? clean(thinking.level)
        : "unknown",
      score,
      reason: clean(thinking.reason),
      evidence: clean(thinking.evidence),
      nextImprovement: clean(thinking.nextImprovement),
    },

    explainBackEvaluation: {
      studentClaimSummary: clean(explainBack.studentClaimSummary),
      correctParts: normalizeArray(explainBack.correctParts, 8).map(clean),
      missingParts: normalizeArray(explainBack.missingParts, 8).map(clean),
      wrongParts: normalizeArray(explainBack.wrongParts, 8).map(clean),
      improvedAnswer: clean(explainBack.improvedAnswer),
      score: explainBackScore,
    },

    roadmap: {
      nodes: normalizeArray(roadmap.nodes, 12).map((node) => ({
        id: clean(node.id),
        label: clean(node.label),
        status: ["known", "current", "weak", "next", "locked", "unknown"].includes(
          clean(node.status)
        )
          ? clean(node.status)
          : "unknown",
        why: clean(node.why),
      })),
      edges: normalizeArray(roadmap.edges, 16).map((edge) => ({
        from: clean(edge.from),
        to: clean(edge.to),
        label: clean(edge.label),
      })),
      currentNodeId: clean(roadmap.currentNodeId),
    },

    suggestedPractice: normalizeArray(ai.suggestedPractice, 6).map((item) => ({
      title: clean(item.title),
      prompt: clean(item.prompt),
      expectedAnswerHint: clean(item.expectedAnswerHint),
      difficulty: ["easy", "medium", "hard"].includes(clean(item.difficulty))
        ? clean(item.difficulty)
        : "easy",
    })),

    actions: normalizeActionButtons(ai.actions),
    sourcesUsed: normalizeSources(ai.sourcesUsed),

    weakConcepts: normalizeArray(ai.weakConcepts, 10).map(clean).filter(Boolean),
    masteredConcepts: normalizeArray(ai.masteredConcepts, 10).map(clean).filter(Boolean),
    followUpQuestion: clean(ai.followUpQuestion),

    confidence,
    raw: ai,
  };
}

function buildInitialSources(input, memoryHits = []) {
  const sources = [];

  if (input.hasScreenshot) {
    sources.push({
      sourceType: input.usedMarkedCrop ? "crop" : "screenshot",
      label: input.usedMarkedCrop ? "marked screen crop" : "current screen frame",
      preview: `screenshotHash=${input.screenshotHash}; cropHash=${input.cropHash || "none"}`,
      score: 1,
    });
  }

  if (input.selectedText) {
    sources.push({
      sourceType: "selected_text",
      label: "selected text",
      preview: trimText(input.selectedText, 260),
      score: 1,
    });
  }

  if (input.currentCaption) {
    sources.push({
      sourceType: "transcript",
      label: "current caption",
      preview: trimText(input.currentCaption, 260),
      score: 1,
    });
  }

  if (input.transcriptContext) {
    sources.push({
      sourceType: "transcript",
      label: "transcript window",
      preview: trimText(input.transcriptContext, 260),
      score: 0.9,
    });
  }

  if (input.visibleText) {
    sources.push({
      sourceType: "visible_text",
      label: "visible page text",
      preview: trimText(input.visibleText, 260),
      score: 0.8,
    });
  }

  if (input.retrievedContext?.length) {
    sources.push({
      sourceType: "rag_memory",
      label: "retrieved previous board/session memory",
      preview: `${input.retrievedContext.length} memory context item(s) found`,
      score: 0.75,
    });
  }

  if (memoryHits.length) {
    sources.push({
      sourceType: "memory",
      label: "previous session memory",
      preview: `${memoryHits.length} relevant previous interaction(s) found`,
      score: 0.7,
    });
  }

  return sources;
}

function mergeSources(aiSources = [], initialSources = []) {
  const merged = [...normalizeSources(aiSources), ...initialSources];
  const seen = new Set();

  return merged.filter((source) => {
    const key = `${source.sourceType}:${source.label}:${source.preview}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function responseNeedsFallback(response = {}) {
  return !response.explanation || response.explanation.length < 40;
}

function makeFallbackResponse(input, errorMessage = "") {
  const isBangla = input.languageHint === "bangla" || input.languageHint === "mixed";

  return {
    headline: isBangla ? "আমি এই অংশটা ধরেছি" : "I captured this learning moment",
    shortAnswer: isBangla
      ? "AI response দুর্বল/অসম্পূর্ণ এসেছে, কিন্তু context save হয়েছে। আবার Explain চাপলে retry করা যাবে।"
      : "The AI response was weak/incomplete, but the context was saved. You can retry explain.",
    explanation: isBangla
      ? `এই মুহূর্তে selected/context data save হয়েছে: ${input.title}. ${
          input.currentCaption ? `Current caption: ${input.currentCaption}` : ""
        }`
      : `This moment was saved from ${input.title}. ${
          input.currentCaption ? `Current caption: ${input.currentCaption}` : ""
        }`,
    tutorScratchpad: [],
    visualBreakdown: [
      {
        step: 1,
        title: "Captured context",
        detail: trimText(
          input.selectedText ||
            input.currentCaption ||
            input.transcriptContext ||
            input.visibleText ||
            input.visionFocusText,
          300
        ),
        kind: "concept",
        highlight: input.usedMarkedCrop ? "marked crop" : "",
      },
    ],
    dryRun: { available: false, columns: [], rows: [] },
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
      reason: errorMessage || "AI response unavailable.",
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
    roadmap: { nodes: [], edges: [], currentNodeId: "" },
    suggestedPractice: [],
    actions: normalizeActionButtons([]),
    sourcesUsed: buildInitialSources(input, []),
    weakConcepts: [],
    masteredConcepts: [],
    followUpQuestion: "",
    confidence: "low",
    raw: null,
  };
}

async function callTutorBrain(input, memoryHits, trace) {
  const started = nowMs();

  const taskInstruction = chooseTaskInstruction(input);
  const contextBlock = buildContextBlock(input, memoryHits);

  const prompt = [
    "TASK_INSTRUCTION",
    taskInstruction,
    "",
    "CURRENT_CONTEXT",
    contextBlock,
    "",
    "IMPORTANT_SCREEN_RULE",
    input.hasScreenshot
      ? input.usedMarkedCrop
        ? "A marked-region crop is attached as the primary image. A full screenshot may also be attached. Focus on the marked crop first."
        : "A screenshot/frame is attached. Use it with transcript/page context."
      : "No screenshot/frame is attached. Use transcript, selected text, visible text, page text, marked DOM elements, RAG, and memory only.",
    "",
    getOutputSchemaInstruction(),
  ].join("\n");

  const commonOptions = {
    system: getTutorSystemPrompt(),
    prompt,
    timeoutMs: LIVE_TUTOR_TIMEOUT_MS,
    temperature: 0.1,
    top_p: 0.9,
    num_ctx: LIVE_TUTOR_NUM_CTX,
    num_predict: LIVE_TUTOR_NUM_PREDICT,
    json: true,
    format: "json",
    model: input.hasScreenshot ? LIVE_TUTOR_VISION_MODEL : LIVE_TUTOR_MODEL,
  };

  let result;

  if (input.hasScreenshot && input.visionImages?.length) {
    result = await callOllamaVisionJson({
      ...commonOptions,
      images: input.visionImages,
    });
  } else {
    result = await callOllamaJson(commonOptions);
  }

  pushTrace(
    trace,
    input.hasScreenshot ? "gemma_vision_tutor_call" : "gemma_text_tutor_call",
    "done",
    `mode=${input.mode}, usedCrop=${input.usedMarkedCrop}`,
    started
  );

  return result;
}

export async function explainLiveTutorMoment(payload = {}) {
  const requestStarted = nowMs();
  const trace = [];

  const input = await normalizePayload(payload);
  input.requestHash = buildRequestHash(input);

  pushTrace(
    trace,
    "normalize_payload",
    "done",
    `platform=${input.platform}, mode=${input.mode}, crop=${input.usedMarkedCrop}`
  );

  const interaction = await LiveTutorInteraction.create({
    userId: input.userId,
    deviceId: input.deviceId,
    sessionKey: input.sessionKey,
    requestHash: input.requestHash,

    platform: input.platform,
    url: input.url,
    origin: input.origin,
    title: input.title,

    videoId: input.videoId,
    timestampSeconds: input.timestampSeconds,
    durationSeconds: input.durationSeconds,

    mode: input.mode,

    userQuestion: input.userQuestion,
    studentAnswer: input.studentAnswer,

    selectedText: input.selectedText,
    visibleText: input.visibleText,
    pageText: input.pageText,

    transcriptContext: input.transcriptContext,
    transcriptWindow: input.transcriptWindow,
    currentCaption: input.currentCaption,

    selectedRect: input.selectedRect,

    screenshotDataUrl: input.screenshotDataUrl,
    screenshotMime: input.screenshotMime,
    screenshotHash: input.screenshotHash,
    hasScreenshot: input.hasScreenshot,

    languageHint: input.languageHint,
    clientMeta: {
      ...input.clientMeta,
      usedMarkedCrop: input.usedMarkedCrop,
      cropHash: input.cropHash,
      cropBox: input.cropBox,
      visionFocusText: input.visionFocusText,
    },

    status: "retrieving",
    graphTrace: trace,
  });

  try {
    const memoryHits = await retrieveSessionMemory(input, trace);
    const { embeddingText, embedding } = await buildEmbedding(input, trace);

    interaction.status = "thinking";
    interaction.memoryHits = memoryHits;
    interaction.embeddingText = embeddingText;
    if (embedding) interaction.embedding = embedding;
    interaction.graphTrace = trace;
    await interaction.save();

    const ai = await callTutorBrain(input, memoryHits, trace);
    let response = normalizeTutorResponse(ai, input.mode);

    if (responseNeedsFallback(response)) {
      response = normalizeTutorResponse(makeFallbackResponse(input), input.mode);
      pushTrace(trace, "fallback_response", "done", "AI response was too short/empty");
    }

    response.sourcesUsed = mergeSources(response.sourcesUsed, buildInitialSources(input, memoryHits));
    response.mode = input.mode;

    interaction.status = "ready";
    interaction.response = response;
    interaction.graphTrace = trace;
    interaction.latencyMs = nowMs() - requestStarted;
    interaction.modelMeta = ai?._meta || null;
    interaction.error = "";

    await interaction.save();

    return {
      ok: true,
      interactionId: String(interaction._id),
      sessionKey: interaction.sessionKey,
      status: interaction.status,
      response,
      memoryHits,
      graphTrace: trace,
      latencyMs: interaction.latencyMs,
      modelMeta: interaction.modelMeta,
    };
  } catch (error) {
    pushTrace(trace, "live_tutor_failed", "failed", error?.message || "Unknown error");

    interaction.status = "failed";
    interaction.error = error?.message || "Live tutor failed.";
    interaction.graphTrace = trace;
    interaction.latencyMs = nowMs() - requestStarted;

    interaction.response = normalizeTutorResponse(
      makeFallbackResponse(input, interaction.error),
      input.mode
    );

    await interaction.save();

    return {
      ok: false,
      interactionId: String(interaction._id),
      sessionKey: interaction.sessionKey,
      status: interaction.status,
      message: interaction.error,
      response: interaction.response,
      graphTrace: trace,
      latencyMs: interaction.latencyMs,
    };
  }
}

export async function explainSelection(payload = {}) {
  return explainLiveTutorMoment({ ...payload, mode: "explain_selection" });
}

export async function explainWhyThisStep(payload = {}) {
  return explainLiveTutorMoment({ ...payload, mode: "why_this_step" });
}

export async function simplifyMoment(payload = {}) {
  return explainLiveTutorMoment({ ...payload, mode: "simplify" });
}

export async function dryRunMoment(payload = {}) {
  return explainLiveTutorMoment({ ...payload, mode: "dry_run" });
}

export async function handleInterrupt(payload = {}) {
  return explainLiveTutorMoment({ ...payload, mode: "interrupt" });
}

export async function repairConfusion(payload = {}) {
  return explainLiveTutorMoment({ ...payload, mode: "repair_confusion" });
}

export async function evaluateExplainBack(payload = {}) {
  return explainLiveTutorMoment({
    ...payload,
    mode: "explain_back",
    userQuestion:
      payload.userQuestion ||
      "Evaluate my explain-back. Tell me what is correct, missing, wrong, and how to repair my weak part.",
  });
}

export async function buildTutorRoadmap(payload = {}) {
  return explainLiveTutorMoment({ ...payload, mode: "roadmap" });
}

export async function quizCurrentMoment(payload = {}) {
  return explainLiveTutorMoment({ ...payload, mode: "quiz_me" });
}

export async function getLiveTutorSession(query = {}) {
  const sessionKey = clean(query.sessionKey);
  const userId = clean(query.userId);
  const deviceId = clean(query.deviceId);
  const videoId = clean(query.videoId);
  const url = clean(query.url);
  const limit = Math.min(100, Math.max(1, safeNumber(query.limit, 30)));

  const filter = {};

  if (sessionKey) {
    filter.sessionKey = sessionKey;
  } else {
    if (userId) filter.userId = userId;
    if (deviceId) filter.deviceId = deviceId;
    if (videoId) filter.videoId = videoId;
    if (url) filter.url = url;
  }

  const items = await LiveTutorInteraction.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return {
    ok: true,
    count: items.length,
    items: items.map((item) => ({
      id: String(item._id),
      userId: item.userId,
      deviceId: item.deviceId,
      sessionKey: item.sessionKey,
      platform: item.platform,
      url: item.url,
      title: item.title,
      videoId: item.videoId,
      timestampSeconds: item.timestampSeconds,
      mode: item.mode,
      userQuestion: item.userQuestion,
      selectedText: trimText(item.selectedText, 300),
      currentCaption: trimText(item.currentCaption, 300),
      hasScreenshot: item.hasScreenshot,
      status: item.status,
      response: item.response,
      error: item.error,
      latencyMs: item.latencyMs,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
  };
}

export async function getLiveTutorInteraction(id) {
  const item = await LiveTutorInteraction.findById(id).lean();

  if (!item) {
    return {
      ok: false,
      message: "Live tutor interaction not found.",
    };
  }

  return {
    ok: true,
    item: {
      ...item,
      id: String(item._id),
    },
  };
}

export async function deleteLiveTutorSession(query = {}) {
  const sessionKey = clean(query.sessionKey);
  const userId = clean(query.userId);
  const deviceId = clean(query.deviceId);

  if (!sessionKey && !userId && !deviceId) {
    return {
      ok: false,
      deletedCount: 0,
      message: "sessionKey, userId, or deviceId is required.",
    };
  }

  const filter = {};
  if (sessionKey) filter.sessionKey = sessionKey;
  if (userId) filter.userId = userId;
  if (deviceId) filter.deviceId = deviceId;

  const result = await LiveTutorInteraction.deleteMany(filter);

  return {
    ok: true,
    deletedCount: result.deletedCount || 0,
  };
}

export async function getLiveTutorWeakConcepts(query = {}) {
  const userId = clean(query.userId) || "guest";
  const limit = Math.min(50, Math.max(1, safeNumber(query.limit, 20)));

  const items = await LiveTutorInteraction.find({
    userId,
    status: "ready",
    "response.weakConcepts.0": { $exists: true },
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select({
      title: 1,
      url: 1,
      platform: 1,
      timestampSeconds: 1,
      mode: 1,
      response: 1,
      createdAt: 1,
    })
    .lean();

  const conceptMap = new Map();

  for (const item of items) {
    for (const concept of item.response?.weakConcepts || []) {
      const key = clean(concept).toLowerCase();
      if (!key) continue;

      if (!conceptMap.has(key)) {
        conceptMap.set(key, {
          concept: clean(concept),
          count: 0,
          examples: [],
        });
      }

      const entry = conceptMap.get(key);
      entry.count += 1;
      entry.examples.push({
        interactionId: String(item._id),
        title: item.title,
        url: item.url,
        platform: item.platform,
        timestampSeconds: item.timestampSeconds,
        mode: item.mode,
        headline: item.response?.headline || "",
        repair: item.response?.misconceptionCheck?.repairExplanation || "",
        createdAt: item.createdAt,
      });
    }
  }

  return {
    ok: true,
    userId,
    weakConcepts: [...conceptMap.values()].sort((a, b) => b.count - a.count),
  };
}

export function getLiveTutorHealth() {
  return {
    ok: true,
    service: "live-ai-tutor",
    advanced: true,
    model: LIVE_TUTOR_MODEL || "default-from-ollamaCompat",
    visionModel: LIVE_TUTOR_VISION_MODEL || "default-from-ollamaCompat",
    timeoutMs: LIVE_TUTOR_TIMEOUT_MS,
    features: {
      chromeExtensionReadyPayload: true,
      youtubeTimestampAware: true,
      transcriptWindowAware: true,
      selectedTextAware: true,
      markedScreenRectAware: true,
      markedRegionCropAware: true,
      screenshotVisionAware: true,
      sessionMemory: true,
      ragContextAware: true,
      embeddingMemoryOptional: LIVE_TUTOR_ENABLE_EMBEDDINGS,
      explainBackEvaluation: true,
      misconceptionDetection: true,
      weakConceptTracking: true,
      thinkingScore: true,
      dryRunGenerator: true,
      roadmapGenerator: true,
      banglaEnglishAutoMode: true,
    },
  };
}

export default {
  explainLiveTutorMoment,
  explainSelection,
  explainWhyThisStep,
  simplifyMoment,
  dryRunMoment,
  handleInterrupt,
  repairConfusion,
  evaluateExplainBack,
  buildTutorRoadmap,
  quizCurrentMoment,
  getLiveTutorSession,
  getLiveTutorInteraction,
  deleteLiveTutorSession,
  getLiveTutorWeakConcepts,
  getLiveTutorHealth,
};