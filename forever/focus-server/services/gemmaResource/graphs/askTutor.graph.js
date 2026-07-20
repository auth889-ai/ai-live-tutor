// server/services/gemmaResource/graphs/askTutor.graph.js

import axios from "axios";
import mongoose from "mongoose";
import { StateGraph, START, END } from "@langchain/langgraph";

import GemmaResource from "../../../models/GemmaResource.js";
import GemmaResourceChunk from "../../../models/GemmaResourceChunk.js";

import {
  getGemmaResourceCachePaths,
  readJsonFile,
  writeJsonFile,
} from "../localCache.service.js";

import { retrieveRelevantChunksAdvanced } from "../advancedRetrieval.service.js";

const ASK_STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "what",
  "why",
  "how",
  "when",
  "where",
  "which",
  "who",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "do",
  "does",
  "did",
  "can",
  "could",
  "should",
  "would",
  "will",
  "please",
  "give",
  "show",
  "tell",
  "explain",
  "write",
  "code",
  "problem",
  "question",
  "answer",
  "solution",
  "this",
  "that",
  "it",
  "eta",
  "eita",
  "ki",
  "kivabe",
  "amar",
  "ami",
  "amake",
  "bujhi",
  "bujhini",
  "chai",
]);

const INTERNAL_WORDS = [
  "MongoDB",
  "database",
  "cache",
  "embedding",
  "embeddings",
  "vector",
  "vectors",
  "RAG",
  "retrieval",
  "Ollama",
  "localhost",
  "API",
  "env",
  "environment variable",
  "prompt",
  "chunk store",
  "server",
  "backend",
  "frontend",
  "token",
];

function clean(value = "", max = 0) {
  const text = String(value || "").trim();
  if (!max || text.length <= max) return text;
  return `${text.slice(0, max).trim()}...`;
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function unique(items = [], max = 20) {
  const seen = new Set();
  const output = [];

  for (const item of items) {
    const value = clean(item);
    if (!value) continue;

    const key = value.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    output.push(value);

    if (output.length >= max) break;
  }

  return output;
}

function simpleTokens(text = "") {
  return [
    ...new Set(
      String(text || "")
        .toLowerCase()
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .split(/[^a-z0-9\u0980-\u09FF+#._-]+/i)
        .map((item) => clean(item))
        .filter((item) => item.length >= 2 && !ASK_STOP_WORDS.has(item))
    ),
  ];
}

function detectLanguage(text = "") {
  const value = clean(text);

  if (/[\u0980-\u09FF]/.test(value)) return "bangla";

  if (
    /\b(ami|amar|amake|bujhi|bujhini|kivabe|keno|eta|eita|theke|bujhte|bujhbo|bujhlam|bangla|banglay)\b/i.test(
      value
    )
  ) {
    return "bangla";
  }

  return "english";
}

function detectMode(question = "", requestedMode = "") {
  const explicit = clean(requestedMode).toLowerCase();

  if (explicit) {
    if (["code", "coding", "dryrun", "dry-run", "dry_run"].includes(explicit)) {
      return "code";
    }

    return explicit;
  }

  const q = clean(question).toLowerCase();

  if (
    /\b(write\s+code|give\s+code|provide\s+code|show\s+code|implement|implementation|solution\s+code|program|function|debug|fix code|python|javascript|java|c\+\+|html|css|react|node|express)\b/i.test(
      q
    )
  ) {
    return "code";
  }

  if (
    /\b(dry\s*run|trace|line by line|call stack|execution|debug|algorithm|complexity)\b/i.test(
      q
    )
  ) {
    return "dry_run";
  }

  if (/\b(board|whiteboard|diagram|draw|visual|table|flow|timeline|chart|mind map|map)\b/i.test(q)) {
    return "board";
  }

  if (/\b(quiz|test me|mcq|practice|question bank|exam question)\b/i.test(q)) {
    return "quiz";
  }

  if (/\b(book|flipbook|chapter|study book)\b/i.test(q)) {
    return "book";
  }

  if (/\b(summary|summarize|revision|key point|notes|exam notes)\b/i.test(q)) {
    return "summary";
  }

  return "universal_tutor";
}

function wantsCode(question = "", mode = "") {
  const text = `${question} ${mode}`.toLowerCase();

  return /\b(write\s+code|give\s+code|provide\s+code|show\s+code|implement|implementation|solution\s+code|program|function|python|javascript|java|c\+\+|dry\s*run|code)\b/i.test(
    text
  );
}

function isContextualResourceQuestion(question = "") {
  const q = clean(question).toLowerCase();

  return /\b(this|this problem|this question|this video|this lecture|this resource|saved resource|from resource|from video|from lecture|ei|eta|eita|এই|এটা|এইটা)\b/i.test(
    q
  );
}

function maxChunkScore(chunks = []) {
  return Math.max(
    0,
    ...arr(chunks).map((chunk) => Number(chunk?._ragScore || chunk?.score || 0))
  );
}

function chunkText(chunk = "") {
  if (typeof chunk === "string") return chunk;

  return clean(
    chunk.text ||
      chunk.textPreview ||
      chunk.summary ||
      chunk.content ||
      chunk.pageText ||
      "",
    2600
  );
}

function sourceRefFromChunk(chunk = {}, index = 0) {
  return (
    chunk.sourceRef ||
    chunk.timeRange ||
    chunk.timestamp ||
    chunk.pageRef ||
    chunk.page ||
    chunk.pageNumber ||
    chunk.sectionTitle ||
    chunk.title ||
    `Source ${index + 1}`
  );
}

function detectSubject({ question = "", resource = {}, chunks = [] } = {}) {
  const text = [
    question,
    resource?.title,
    resource?.sourceType,
    arr(resource?.tags).join(" "),
    arr(resource?.concepts).join(" "),
    chunks.map((chunk) => chunk?.text || chunk?.textPreview || chunk?.summary || "").join(" "),
  ]
    .join(" ")
    .toLowerCase();

  if (
    /\b(code|program|function|implementation|algorithm|leetcode|array|hashmap|tree|graph|dp|binary search|recursion|javascript|python|java|c\+\+|react|node|express|html|css)\b/i.test(
      text
    )
  ) {
    return "programming";
  }

  if (
    /\b(math|equation|formula|calculus|algebra|geometry|probability|statistics|matrix|derivative|integral)\b/i.test(
      text
    )
  ) {
    return "math";
  }

  if (
    /\b(physics|thermodynamics|force|energy|heat|work|entropy|wave|electricity|motion|velocity|chemistry|reaction|molecule|atom|acid|base|biology|cell|dna|gene)\b/i.test(
      text
    )
  ) {
    return "science";
  }

  if (/\b(history|war|empire|king|queen|politics|society|civilization)\b/i.test(text)) {
    return "history_social";
  }

  if (/\b(english|grammar|essay|paragraph|writing|literature|poem|novel)\b/i.test(text)) {
    return "language_writing";
  }

  if (/\b(business|economics|finance|market|startup|management)\b/i.test(text)) {
    return "business";
  }

  return "general";
}

function inferTwoSumFromContext({ question = "", resource = {}, workspace = {} } = {}) {
  const text = [
    question,
    resource?.title,
    resource?.summary,
    workspace?.chunksText,
    arr(workspace?.concepts).join(" "),
  ]
    .join(" ")
    .toLowerCase();

  return /\b(two\s*sum|target|indices|hash\s*map|arr\[i\]|arr\[j\]|complement)\b/i.test(
    text
  );
}

function buildDeterministicCodeSolution({
  question = "",
  resource = {},
  workspace = {},
  language = "english",
} = {}) {
  if (!inferTwoSumFromContext({ question, resource, workspace })) return null;

  return {
    language: "python",
    code: `def two_sum(nums, target):
    seen = {}  # value -> index

    for i, num in enumerate(nums):
        need = target - num

        if need in seen:
            return [seen[need], i]

        seen[num] = i

    return []`,
    explanation:
      language === "bangla"
        ? "একবার array traverse করি। প্রতিটি num এর জন্য target - num complement হিসাব করি। complement আগে hash map-এ থাকলে দুইটি index return করি; না থাকলে current num map-এ save করি।"
        : "Traverse the array once. For each number, compute target - number. If that complement was already seen in the hash map, return the saved index and the current index; otherwise save the current number and index.",
  };
}

function sanitizeStudentText(value = "") {
  let text = String(value || "");

  const replacements = {
    MongoDB: "saved learning storage",
    database: "saved learning storage",
    cache: "saved offline copy",
    embedding: "smart source matching",
    embeddings: "smart source matching",
    vector: "smart source matching",
    vectors: "smart source matching",
    RAG: "source-based tutoring",
    retrieval: "source search",
    Ollama: "Gemma",
    localhost: "local study workspace",
    API: "study service",
    env: "settings",
    "environment variable": "settings",
    prompt: "instruction",
    "chunk store": "saved source parts",
    server: "study system",
    backend: "study system",
    frontend: "study screen",
    token: "text piece",
  };

  for (const [bad, good] of Object.entries(replacements)) {
    text = text.replace(new RegExp(`\\b${bad}\\b`, "gi"), good);
  }

  return text.trim();
}

function sanitizeObject(value, seen = new WeakSet()) {
  if (typeof value === "string") return sanitizeStudentText(value);
  if (typeof value === "bigint") return String(value);
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeObject(item, seen))
      .filter((item) => item !== undefined);
  }

  if (!value || typeof value !== "object") return value;

  if (seen.has(value)) return undefined;
  seen.add(value);

  if (
    value._bsontype === "ObjectId" ||
    value.constructor?.name === "ObjectId" ||
    value.constructor?.name === "ObjectId2"
  ) {
    return String(value);
  }

  if (Buffer.isBuffer(value)) return undefined;

  const output = {};

  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "function") continue;
    if (key.startsWith("$")) continue;
    if (key === "__v") continue;

    const safe = sanitizeObject(item, seen);

    if (safe !== undefined) {
      output[key] = safe;
    }
  }

  return output;
}

function getOllamaGenerateUrl() {
  const direct =
    clean(process.env.GEMMA_RESOURCE_OLLAMA_GENERATE_URL) ||
    clean(process.env.OLLAMA_LOCAL_GENERATE_URL) ||
    clean(process.env.OLLAMA_GENERATE_URL);

  if (direct) return direct;

  const base =
    clean(process.env.GEMMA_RESOURCE_OLLAMA_URL) ||
    clean(process.env.GEMMA_RESOURCE_OLLAMA_BASE_URL) ||
    clean(process.env.OFFLINE_RESOURCE_OLLAMA_URL) ||
    clean(process.env.OLLAMA_LOCAL_URL) ||
    clean(process.env.OLLAMA_BASE_URL) ||
    "http://localhost:11434";

  const value = base.replace(/\/+$/, "");
  return value.endsWith("/api/generate") ? value : `${value}/api/generate`;
}

function getGemmaModel() {
  return (
    clean(process.env.GEMMA_RESOURCE_OLLAMA_MODEL) ||
    clean(process.env.GEMMA_RESOURCE_MODEL) ||
    clean(process.env.OFFLINE_RESOURCE_LOCAL_MODEL) ||
    clean(process.env.OLLAMA_LOCAL_MODEL) ||
    clean(process.env.OLLAMA_MODEL) ||
    "gemma4:e4b"
  );
}

function jsonRepair(raw = "") {
  let text = String(raw || "").trim();

  text = text.replace(/```json/gi, "```").replace(/```/g, "").trim();

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");

  if (first >= 0 && last > first) {
    text = text.slice(first, last + 1);
  }

  return text;
}

function safeParseJson(raw = "") {
  const repaired = jsonRepair(raw);

  try {
    return JSON.parse(repaired);
  } catch {
    return null;
  }
}

function publicResource(resource = {}, workspace = {}) {
  return sanitizeObject({
    id: String(resource._id || resource.id || ""),
    title: resource.title || "Saved Resource",
    sourceType: resource.sourceType || "resource",
    status: resource.status,
    offlineReady: Boolean(resource.offlineReady || resource.status === "ready"),
    summary: resource.summary || "",
    concepts: unique(
      [...arr(resource.concepts), ...arr(resource.tags), ...arr(workspace?.concepts)],
      18
    ),
    pageCount: resource.pageCount || resource.pages || "",
    durationText: resource.durationText || resource.duration || "",
    updatedAt: resource.updatedAt,
    createdAt: resource.createdAt,
  });
}

async function loadTutorMemory(resourceId) {
  try {
    const paths = getGemmaResourceCachePaths(resourceId);
    return (await readJsonFile(paths.tutorMemoryPath, null)) || {
      conversations: [],
      weakConcepts: [],
      reviewHistory: [],
    };
  } catch {
    return {
      conversations: [],
      weakConcepts: [],
      reviewHistory: [],
    };
  }
}

async function saveTutorMemory(resourceId, memory) {
  try {
    const paths = getGemmaResourceCachePaths(resourceId);
    await writeJsonFile(paths.tutorMemoryPath, memory);
  } catch (error) {
    console.warn("[Gemma Ask LangGraph] memory save skipped:", error?.message || error);
  }
}

function buildFallbackAnswer({ question, resource, workspace, mode, language, subject }) {
  const sourceRefs = arr(workspace?.sourceRefs).slice(0, 6);
  const bangla = language === "bangla";

  return {
    directAnswer: bangla
      ? "আমি তোমার প্রশ্নের উত্তর step-by-step tutor flow দিয়ে দিচ্ছি।"
      : "I will answer your question with a clear step-by-step tutor flow.",
    studentExplanation: bangla
      ? "প্রথমে প্রশ্নের main idea ধরব, তারপর ধাপে ধাপে ব্যাখ্যা, example, visual flow, এবং quick check করব। Saved source relevant হলে সেটার evidence use করব; না হলে general Gemma tutor knowledge দিয়ে answer করব।"
      : "First, I identify the main idea of your question. Then I explain it step by step with an example, a visual flow, and a quick check. If the saved source is relevant, I use it; otherwise I answer with Gemma's general tutor knowledge.",
    codeSolution: wantsCode(question, mode)
      ? buildDeterministicCodeSolution({ question, resource, workspace, language })
      : null,
    teachingSteps: [
      {
        title: bangla ? "প্রশ্ন বুঝি" : "Understand the question",
        text: bangla
          ? "প্রশ্নটি কোন concept/problem জানতে চাইছে সেটা identify করি।"
          : "Identify what concept/problem the question is asking about.",
        sourceRef: sourceRefs[0]?.sourceRef || "",
      },
      {
        title: bangla ? "মূল ধারণা" : "Core idea",
        text: bangla
          ? "Main concept সহজ ভাষায় ব্যাখ্যা করি।"
          : "Explain the core idea in simple language.",
        sourceRef: sourceRefs[1]?.sourceRef || "",
      },
      {
        title: bangla ? "Example / Flow" : "Example / Flow",
        text: bangla
          ? "একটা small example বা flow দিয়ে idea clear করি।"
          : "Use a small example or flow to make the idea clear.",
        sourceRef: sourceRefs[2]?.sourceRef || "",
      },
    ],
    analogy: bangla
      ? "Human tutor board-এ যেমন concept ভেঙে বুঝায়, answer-ও সেভাবেই সাজানো।"
      : "Like a human tutor on a board, the answer is broken into small understandable parts.",
    dryRun: null,
    boardPlan: [
      {
        type: "heading",
        title: "Question",
        content: question,
      },
      {
        type: "flow",
        title: "Tutor Flow",
        content: "Question → Core idea → Steps → Example → Quick check",
      },
      {
        type: "note",
        title: "Repair",
        content: "If confused, explain one level simpler and show another example.",
      },
    ],
    commonConfusions: [
      {
        title: bangla ? "কোথায় confusion হতে পারে" : "Where students may get confused",
        fix: bangla
          ? "Definition, example, application আলাদা করলে confusion কমে।"
          : "Separate definition, example, and application to reduce confusion.",
      },
    ],
    quickCheck: {
      question: bangla
        ? "তুমি কি main idea এক লাইনে বলতে পারো?"
        : "Can you explain the main idea in one sentence?",
      expectedAnswer: bangla
        ? "Short definition + one example."
        : "A short definition plus one example.",
    },
    sourceRefs,
    concepts: workspace?.concepts?.length ? workspace.concepts : [subject, mode],
    followUps: [
      "Explain more simply",
      "Show an example",
      "Make a diagram flow",
      "Give practice questions",
    ],
    confidence: sourceRefs.length ? 0.72 : 0.62,
    grounded: Boolean(sourceRefs.length),
    usedGeneralTutorKnowledge: true,
    memorySignal: {
      weakConcepts: [],
      reviewSuggestion: "",
    },
  };
}

function enforceAnswerShape(parsed, fallback, workspace) {
  const answer = parsed && typeof parsed === "object" ? parsed : fallback;

  const sourceRefs = arr(answer.sourceRefs).length
    ? arr(answer.sourceRefs)
    : arr(workspace?.sourceRefs).slice(0, 6);

  const concepts = unique([...arr(answer.concepts), ...arr(workspace?.concepts)], 16);

  const codeSolution =
    answer.codeSolution &&
    typeof answer.codeSolution === "object" &&
    clean(answer.codeSolution.code || answer.codeSolution.explanation || answer.codeSolution.language)
      ? answer.codeSolution
      : fallback.codeSolution;

  return sanitizeObject({
    directAnswer: clean(answer.directAnswer || answer.shortAnswer || fallback.directAnswer, 1800),
    studentExplanation: clean(
      answer.studentExplanation ||
        answer.humanTutorExplanation ||
        answer.explanation ||
        answer.answer ||
        fallback.studentExplanation,
      8000
    ),
    codeSolution,
    teachingSteps: arr(answer.teachingSteps || answer.steps || fallback.teachingSteps).slice(0, 10),
    analogy: clean(answer.analogy || answer.simpleAnalogy || fallback.analogy, 1800),
    dryRun: answer.dryRun || fallback.dryRun || null,
    boardPlan: arr(answer.boardPlan || answer.boardSteps || fallback.boardPlan).slice(0, 14),
    commonConfusions: arr(answer.commonConfusions || answer.mistakes || fallback.commonConfusions).slice(0, 8),
    quickCheck: answer.quickCheck || answer.quizCheck || fallback.quickCheck,
    sourceRefs: sourceRefs.slice(0, 10),
    concepts,
    followUps: arr(answer.followUps || fallback.followUps).slice(0, 6),
    confidence: Number.isFinite(Number(answer.confidence)) ? Number(answer.confidence) : fallback.confidence,
    grounded: answer.grounded !== false,
    usedGeneralTutorKnowledge:
      answer.usedGeneralTutorKnowledge !== false || fallback.usedGeneralTutorKnowledge === true,
    memorySignal: answer.memorySignal || {
      weakConcepts: [],
      reviewSuggestion: "",
    },
  });
}

async function callGemma(prompt) {
  const url = getOllamaGenerateUrl();
  const model = getGemmaModel();

  const response = await axios.post(
    url,
    {
      model,
      prompt,
      stream: false,
      format: "json",
      options: {
        temperature: Number(process.env.GEMMA_RESOURCE_TEMPERATURE || 0.35),
        top_p: Number(process.env.GEMMA_RESOURCE_TOP_P || 0.92),
        num_predict: numberEnv("GEMMA_RESOURCE_ASK_NUM_PREDICT", 3600),
        repeat_penalty: Number(process.env.GEMMA_RESOURCE_REPEAT_PENALTY || 1.06),
      },
    },
    {
      timeout: numberEnv("GEMMA_RESOURCE_ASK_TIMEOUT_MS", 900000),
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  return response?.data?.response || response?.data?.message?.content || "";
}

function buildPrompt({ question, resource, workspace, mode, language, subject }) {
  const answerLanguage =
    language === "bangla"
      ? "Bangla. Use natural Bangla, but keep technical terms when needed."
      : language === "auto"
        ? "Use the same language as the student's question."
        : language;

  return `
You are Gemma, a universal AI tutor inside an offline learning app.

Core rule:
- If saved source context is relevant, answer from it and cite sourceRefs.
- If saved source context is not enough, answer using your own general tutor knowledge.
- Never force irrelevant saved source into the answer.
- Never say only "not found" unless user explicitly asked "only from this source".
- If user asks code, give complete runnable code.
- If user asks dry run, give trace table.
- If user asks board/visual, give boardPlan.
- If user asks in Bangla, answer in Bangla.
- Do not expose internal words: ${INTERNAL_WORDS.join(", ")}.
- Return only valid JSON.

Answer language:
${answerLanguage}

Mode:
${mode}

Subject:
${subject}

Router decision:
${JSON.stringify(workspace.sourceUsage || {}, null, 2)}

Saved resource:
${JSON.stringify(
  {
    title: resource.title || "Saved Resource",
    sourceType: resource.sourceType || "resource",
    summary: resource.summary || "",
    concepts: unique([...(resource.concepts || []), ...(resource.tags || [])], 20),
  },
  null,
  2
)}

Student question:
${question}

Relevant saved source context:
${workspace.chunksText || "No relevant saved source context selected."}

Return this JSON exactly:
{
  "directAnswer": "short direct answer",
  "studentExplanation": "human tutor explanation",
  "codeSolution": {
    "language": "",
    "code": "",
    "explanation": ""
  },
  "teachingSteps": [
    {
      "title": "step title",
      "text": "step explanation",
      "sourceRef": "page/time/source if relevant"
    }
  ],
  "analogy": "simple analogy if useful",
  "dryRun": {
    "trace": [
      {
        "step": 1,
        "state": "state/example/variables",
        "decision": "what happens and why"
      }
    ],
    "timeComplexity": "",
    "spaceComplexity": "",
    "commonMistakes": []
  },
  "boardPlan": [
    {
      "type": "heading | formula | table | diagram | flow | timeline | mindmap | dry_run | code | note",
      "title": "board item title",
      "content": "what to draw/write"
    }
  ],
  "commonConfusions": [
    {
      "title": "confusion",
      "fix": "repair explanation"
    }
  ],
  "quickCheck": {
    "question": "one check question",
    "expectedAnswer": "expected answer"
  },
  "sourceRefs": [
    {
      "chunkId": "chunk id",
      "sourceRef": "timestamp/page/source",
      "page": "",
      "whyUsed": "why this supports answer",
      "textPreview": "short preview"
    }
  ],
  "concepts": ["concept1", "concept2"],
  "followUps": ["follow-up 1", "follow-up 2"],
  "confidence": 0.0,
  "grounded": true,
  "usedGeneralTutorKnowledge": true,
  "memorySignal": {
    "weakConcepts": [],
    "reviewSuggestion": ""
  }
}
`.trim();
}

function createInitialState(input = {}) {
  const question = clean(input.question || input.query || input.prompt || "");
  const resourceId = clean(input.resourceId || input.id || "");
  const deviceId = clean(input.deviceId || "");

  return {
    input,
    question,
    resourceId,
    deviceId,
    resource: null,
    realResourceId: "",
    mode: detectMode(question, input.mode),
    language:
      clean(input.language).toLowerCase() === "auto" || !input.language
        ? detectLanguage(question)
        : clean(input.language).toLowerCase(),
    chunks: [],
    sourceUsage: null,
    subject: "general",
    workspace: null,
    prompt: "",
    rawModelText: "",
    parsedAnswer: null,
    fallbackAnswer: null,
    answer: null,
    memory: null,
    route: "general_answer",
    error: "",
    final: null,
  };
}

async function loadResourceNode(state) {
  if (!state.question) {
    throw new Error("Question is required.");
  }

  const query = {};

  if (state.resourceId && mongoose.Types.ObjectId.isValid(String(state.resourceId))) {
    query._id = state.resourceId;
  } else if (state.resourceId) {
    query.resourceId = state.resourceId;
  } else if (state.deviceId) {
    query.deviceId = state.deviceId;
  }

  const resource = await GemmaResource.findOne(query)
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  if (!resource) {
    throw new Error("Saved resource was not found. Save a resource first.");
  }

  return {
    ...state,
    resource,
    realResourceId: String(resource._id || resource.id || state.resourceId),
  };
}

async function ragRetrieveNode(state) {
  const safeLimit = Math.max(4, Math.min(Number(state.input.limit || 12), 18));

  let chunks = [];

  try {
    const advanced = await retrieveRelevantChunksAdvanced({
      resourceId: state.realResourceId,
      query: state.question,
      limit: safeLimit,
    });

    chunks = arr(advanced?.chunks).length
      ? arr(advanced?.chunks)
      : arr(advanced?.results).length
        ? arr(advanced?.results)
        : arr(advanced?.matches);
  } catch (error) {
    console.warn("[Gemma Ask LangGraph] RAG advanced retrieval skipped:", error?.message || error);
  }

  if (!chunks.length) {
    chunks = await GemmaResourceChunk.find({ resourceId: state.realResourceId })
      .sort({ order: 1, chunkIndex: 1, createdAt: 1 })
      .limit(safeLimit)
      .lean();
  }

  return {
    ...state,
    chunks: chunks.slice(0, safeLimit),
  };
}

function relevanceRouterNode(state) {
  const qTokens = simpleTokens(state.question);

  const resourceText = [
    state.resource?.title,
    state.resource?.summary,
    arr(state.resource?.tags).join(" "),
    arr(state.resource?.concepts).join(" "),
    arr(state.chunks)
      .slice(0, 12)
      .map((chunk) => chunkText(chunk))
      .join(" "),
  ]
    .join(" ")
    .toLowerCase();

  let overlap = 0;

  for (const token of qTokens) {
    if (resourceText.includes(token.toLowerCase())) overlap += 1;
  }

  const contextual = isContextualResourceQuestion(state.question);
  const score = maxChunkScore(state.chunks);
  const hasFocusRef = /\d{1,2}:\d{2}|page\s*\d+|line\s*\d+/i.test(state.question);
  const hasChunks = arr(state.chunks).length > 0;

  const useSavedSource =
    hasChunks && (contextual || hasFocusRef || score >= 2.5 || overlap >= 1);

  const sourceUsage = {
    useSavedSource,
    contextual,
    score,
    overlap,
    reason: useSavedSource
      ? "saved_resource_relevant"
      : "saved_resource_not_enough_use_general_tutor_knowledge",
  };

  return {
    ...state,
    sourceUsage,
    route: useSavedSource ? "saved_resource_answer" : "general_answer",
  };
}

function prepareWorkspaceNode(state) {
  const usableChunks = state.sourceUsage?.useSavedSource === false ? [] : arr(state.chunks);

  const sourceRefs = usableChunks.map((chunk, index) => ({
    chunkId: String(chunk._id || chunk.id || chunk.chunkId || `chunk-${index + 1}`),
    sourceRef: sourceRefFromChunk(chunk, index),
    page: chunk.page || chunk.pageNumber || chunk.pageRef || "",
    title: chunk.sectionTitle || chunk.title || "",
    textPreview: clean(chunkText(chunk), 280),
    whyUsed: "This saved source part supports the answer.",
  }));

  const subject = detectSubject({
    question: state.question,
    resource: state.resource,
    chunks: usableChunks,
  });

  const concepts = unique(
    [
      ...(state.resource?.concepts || []),
      ...(state.resource?.tags || []),
      ...usableChunks.flatMap((chunk) => arr(chunk.concepts || chunk.tags)),
    ],
    20
  );

  const workspace = {
    subject,
    sourceRefs,
    concepts,
    sourceUsage: state.sourceUsage,
    chunksText: usableChunks
      .map((chunk, index) => {
        const ref = sourceRefFromChunk(chunk, index);
        const text = chunkText(chunk);
        return `SOURCE ${index + 1} | ${ref}\n${text}`;
      })
      .join("\n\n---\n\n")
      .slice(0, numberEnv("GEMMA_RESOURCE_MAX_CONTEXT_CHARS", 55000)),
  };

  const fallback = buildFallbackAnswer({
    question: state.question,
    resource: state.resource,
    workspace,
    mode: state.mode,
    language: state.language,
    subject,
  });

  const prompt = buildPrompt({
    question: state.question,
    resource: state.resource,
    workspace,
    mode: state.mode,
    language: state.language,
    subject,
  });

  return {
    ...state,
    workspace,
    subject,
    fallbackAnswer: fallback,
    prompt,
  };
}

async function gemmaAnswerNode(state) {
  let rawModelText = "";
  let parsedAnswer = null;

  try {
    rawModelText = await callGemma(state.prompt);
    parsedAnswer = safeParseJson(rawModelText);
  } catch (error) {
    console.warn("[Gemma Ask LangGraph] Gemma call failed:", error?.message || error);
  }

  return {
    ...state,
    rawModelText,
    parsedAnswer,
  };
}

function repairAnswerNode(state) {
  const answer = enforceAnswerShape(
    state.parsedAnswer,
    state.fallbackAnswer,
    state.workspace
  );

  if (wantsCode(state.question, state.mode) && !clean(answer?.codeSolution?.code || "")) {
    const deterministicCode = buildDeterministicCodeSolution({
      question: state.question,
      resource: state.resource,
      workspace: state.workspace,
      language: state.language,
    });

    if (deterministicCode) {
      answer.codeSolution = deterministicCode;
      answer.dryRun = answer.dryRun || {
        trace: [
          {
            step: 1,
            state: "seen = {}",
            decision: "Start with an empty hash map.",
          },
          {
            step: 2,
            state: "need = target - num",
            decision: "For each number, calculate the complement.",
          },
          {
            step: 3,
            state: "need in seen?",
            decision: "If yes, return the saved index and current index.",
          },
          {
            step: 4,
            state: "seen[num] = i",
            decision: "If no, save the current value for later.",
          },
        ],
        timeComplexity: "O(n)",
        spaceComplexity: "O(n)",
        commonMistakes: [
          "Do not reuse the same element twice.",
          "Store the value after checking its complement.",
        ],
      };
    }
  }

  return {
    ...state,
    answer,
  };
}

async function memoryNode(state) {
  const memory = await loadTutorMemory(state.realResourceId);

  const weakConcepts = unique(
    [...arr(memory.weakConcepts), ...arr(state.answer?.memorySignal?.weakConcepts)],
    40
  );

  const conversations = [
    ...arr(memory.conversations),
    {
      at: new Date().toISOString(),
      question: state.question,
      mode: state.mode,
      route: state.route,
      confidence: state.answer?.confidence,
      concepts: state.answer?.concepts || [],
    },
  ].slice(-80);

  const reviewHistory = [
    ...arr(memory.reviewHistory),
    {
      at: new Date().toISOString(),
      suggestion: state.answer?.memorySignal?.reviewSuggestion || "",
      quickCheck: state.answer?.quickCheck || null,
    },
  ].slice(-80);

  const nextMemory = {
    ...memory,
    weakConcepts,
    conversations,
    reviewHistory,
    updatedAt: new Date().toISOString(),
  };

  await saveTutorMemory(state.realResourceId, nextMemory);

  return {
    ...state,
    memory: nextMemory,
  };
}

function finalResponseNode(state) {
  return {
    ...state,
    final: sanitizeObject({
      ok: true,
      graph: "langgraph_rag_tutor",
      route: state.route,
      resource: publicResource(state.resource, state.workspace),
      question: state.question,
      mode: state.mode,
      language: state.language,
      subject: state.subject,
      answer: state.answer,
      sourceRefs: state.answer?.sourceRefs || [],
      concepts: state.answer?.concepts || [],
      memory: state.memory,
      rawModelText:
        process.env.NODE_ENV === "development"
          ? clean(state.rawModelText, 1200)
          : undefined,
      at: new Date().toISOString(),
    }),
  };
}

function routeAfterRelevance(state) {
  return state.route === "saved_resource_answer"
    ? "prepare_workspace"
    : "prepare_workspace";
}

function buildAskTutorLangGraph() {
  const graph = new StateGraph({
    channels: {
      input: null,
      question: null,
      resourceId: null,
      deviceId: null,
      resource: null,
      realResourceId: null,
      mode: null,
      language: null,
      chunks: null,
      sourceUsage: null,
      subject: null,
      workspace: null,
      prompt: null,
      rawModelText: null,
      parsedAnswer: null,
      fallbackAnswer: null,
      answer: null,
      memory: null,
      route: null,
      error: null,
      final: null,
    },
  });

  graph.addNode("load_resource", loadResourceNode);
  graph.addNode("rag_retrieve", ragRetrieveNode);
  graph.addNode("relevance_router", relevanceRouterNode);
  graph.addNode("prepare_workspace", prepareWorkspaceNode);
  graph.addNode("gemma_answer", gemmaAnswerNode);
  graph.addNode("repair_answer", repairAnswerNode);

  // Important:
  // Node name cannot be "memory" because state already has a "memory" channel.
  graph.addNode("save_memory", memoryNode);

  graph.addNode("final_response", finalResponseNode);

  graph.addEdge(START, "load_resource");
  graph.addEdge("load_resource", "rag_retrieve");
  graph.addEdge("rag_retrieve", "relevance_router");

  graph.addConditionalEdges("relevance_router", routeAfterRelevance, {
    prepare_workspace: "prepare_workspace",
  });

  graph.addEdge("prepare_workspace", "gemma_answer");
  graph.addEdge("gemma_answer", "repair_answer");
  graph.addEdge("repair_answer", "save_memory");
  graph.addEdge("save_memory", "final_response");
  graph.addEdge("final_response", END);

  return graph.compile();
}

let askTutorCompiledGraph = null;

function getAskTutorCompiledGraph() {
  if (!askTutorCompiledGraph) {
    askTutorCompiledGraph = buildAskTutorLangGraph();
  }

  return askTutorCompiledGraph;
}

async function runCoreGraph(input = {}) {
  const initialState = createInitialState(input);
  const graph = getAskTutorCompiledGraph();
  const result = await graph.invoke(initialState);

  if (!result?.final) {
    throw new Error("LangGraph Ask Tutor did not produce a final answer.");
  }

  return result.final;
}

export async function runAskTutorGraph(input = {}) {
  return runCoreGraph(input);
}

export async function runTutorBoardGraph(input = {}) {
  const result = await runCoreGraph({
    ...input,
    mode: "board",
    question:
      clean(input.question) ||
      "Create an interactive tutor board plan from this saved resource.",
  });

  return sanitizeObject({
    ok: true,
    graph: "langgraph_rag_tutor_board",
    route: result.route,
    resource: result.resource,
    topic: result.answer.directAnswer,
    boardPlan: result.answer.boardPlan,
    repairOptions: result.answer.commonConfusions,
    sourceRefs: result.answer.sourceRefs,
    quickCheck: result.answer.quickCheck,
    concepts: result.answer.concepts,
    at: result.at,
  });
}

export async function runCodeDryRunGraph(input = {}) {
  const result = await runCoreGraph({
    ...input,
    mode: "code",
    question:
      clean(input.question) ||
      "Write code if needed, explain it, and show a complete dry run with complexity.",
  });

  return sanitizeObject({
    ok: true,
    graph: "langgraph_rag_code_dryrun",
    route: result.route,
    resource: result.resource,
    algorithm: result.answer.directAnswer,
    explanation: result.answer.studentExplanation,
    codeSolution: result.answer.codeSolution,
    dryRun: result.answer.dryRun,
    boardPlan: result.answer.boardPlan,
    sourceRefs: result.answer.sourceRefs,
    concepts: result.answer.concepts,
    at: result.at,
  });
}

export async function runQuizGraph(input = {}) {
  const result = await runCoreGraph({
    ...input,
    mode: "quiz",
    question:
      clean(input.question) ||
      "Create a quiz from this saved resource or topic with answers and explanations.",
  });

  const quizItems = arr(result.answer.quiz || result.answer.questions);

  return sanitizeObject({
    ok: true,
    graph: "langgraph_rag_quiz",
    route: result.route,
    resource: result.resource,
    quiz: quizItems.length
      ? quizItems
      : [
          {
            type: "short_answer",
            question:
              result.answer.quickCheck?.question ||
              "Explain the main idea from this topic.",
            answer:
              result.answer.quickCheck?.expectedAnswer ||
              result.answer.directAnswer,
            explanation: result.answer.studentExplanation,
            sourceRefs: result.answer.sourceRefs,
          },
        ],
    sourceRefs: result.answer.sourceRefs,
    concepts: result.answer.concepts,
    at: result.at,
  });
}

export async function runBookGraph(input = {}) {
  const result = await runCoreGraph({
    ...input,
    mode: "book",
    question:
      clean(input.question) ||
      "Turn this saved resource or topic into a beautiful flipable study book with chapters, examples, board visuals, and quiz checks.",
  });

  const refs = arr(result.answer.sourceRefs);

  const pages = [
    {
      pageNo: 1,
      pageType: "cover",
      title: result.resource.title || "Gemma Study Book",
      subtitle: result.answer.directAnswer,
      sourceRefs: refs.slice(0, 2),
    },
    {
      pageNo: 2,
      pageType: "explanation",
      title: "Human Tutor Explanation",
      body: result.answer.studentExplanation,
      sourceRefs: refs.slice(0, 3),
    },
    ...arr(result.answer.teachingSteps)
      .slice(0, 8)
      .map((step, index) => ({
        pageNo: index + 3,
        pageType: "lesson",
        title: step.title || `Lesson ${index + 1}`,
        body: step.text || "",
        sourceRefs: step.sourceRef
          ? [{ sourceRef: step.sourceRef }]
          : refs.slice(0, 2),
      })),
    {
      pageNo: 20,
      pageType: "board",
      title: "Tutor Board",
      boardPlan: result.answer.boardPlan,
      sourceRefs: refs.slice(0, 4),
    },
    {
      pageNo: 21,
      pageType: "quiz",
      title: "Quick Check",
      quickCheck: result.answer.quickCheck,
      sourceRefs: refs.slice(0, 4),
    },
  ];

  return sanitizeObject({
    ok: true,
    graph: "langgraph_rag_book",
    route: result.route,
    resource: result.resource,
    book: {
      bookTitle: `${result.resource.title || "Gemma Resource"} Study Book`,
      pages,
      concepts: result.answer.concepts,
      sourceRefs: refs,
    },
    at: result.at,
  });
}

export async function runQuizAnswerGraph(input = {}) {
  const question = clean(input.question || input.quizQuestion || "");
  const studentAnswer = clean(input.studentAnswer || input.answer || "");

  const result = await runCoreGraph({
    ...input,
    mode: "quiz_review",
    question: [
      "Check this student's quiz answer.",
      `Quiz question: ${question}`,
      `Student answer: ${studentAnswer}`,
      "Explain what is correct, what is missing, and what to review next.",
    ].join("\n"),
    limit: input.limit || 10,
  });

  return sanitizeObject({
    ok: true,
    graph: "langgraph_rag_quiz_review",
    route: result.route,
    resource: result.resource,
    review: result.answer,
    sourceRefs: result.answer.sourceRefs,
    memorySignal: result.answer.memorySignal,
    at: result.at,
  });
}

export async function getGemmaResourceMemoryGraph({
  deviceId = "",
  resourceId = "",
} = {}) {
  const query = {
    status: { $ne: "archived" },
  };

  if (deviceId) query.deviceId = deviceId;

  if (resourceId && mongoose.Types.ObjectId.isValid(String(resourceId))) {
    query._id = resourceId;
  }

  const resources = await GemmaResource.find(query)
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(20)
    .lean();

  const memories = [];

  for (const resource of resources) {
    const memory = await loadTutorMemory(resource._id);
    const subject = detectSubject({ resource });

    memories.push({
      resource: publicResource(resource, {
        concepts: unique([...(resource.concepts || []), ...(resource.tags || []), subject], 20),
      }),
      weakConcepts: memory.weakConcepts || [],
      recentQuestions: arr(memory.conversations).slice(-5).map((item) => ({
        at: item.at,
        question: item.question,
        mode: item.mode,
        route: item.route,
        confidence: item.confidence,
      })),
      reviewHistory: memory.reviewHistory || [],
    });
  }

  return sanitizeObject({
    ok: true,
    graph: "langgraph_rag_memory",
    deviceId,
    resources: memories,
    summary: {
      resourceCount: memories.length,
      weakConceptCount: memories.reduce(
        (sum, item) => sum + Number(item.weakConcepts?.length || 0),
        0
      ),
      reviewCount: memories.reduce(
        (sum, item) => sum + Number(item.reviewHistory?.length || 0),
        0
      ),
    },
    at: new Date().toISOString(),
  });
}