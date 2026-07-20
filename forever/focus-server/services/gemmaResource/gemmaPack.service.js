// server/services/gemmaResource/gemmaPack.service.js

import axios from "axios";
import { summarizeChunksForPrompt } from "./chunker.service.js";

function clean(value = "") {
  return String(value || "").trim();
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getOllamaBaseUrl() {
  const raw =
    clean(process.env.GEMMA_RESOURCE_OLLAMA_URL) ||
    clean(process.env.OFFLINE_RESOURCE_OLLAMA_URL) ||
    clean(process.env.OLLAMA_LOCAL_URL) ||
    "http://localhost:11434";

  return raw.replace(/\/api\/generate\/?$/i, "").replace(/\/+$/, "");
}

function getOllamaGenerateUrl() {
  const raw =
    clean(process.env.GEMMA_RESOURCE_OLLAMA_URL) ||
    clean(process.env.OFFLINE_RESOURCE_OLLAMA_URL) ||
    clean(process.env.OLLAMA_LOCAL_URL) ||
    "http://localhost:11434";

  const value = raw.replace(/\/+$/, "");

  if (value.endsWith("/api/generate")) return value;

  return `${value}/api/generate`;
}

function getGemmaModel() {
  return (
    clean(process.env.GEMMA_RESOURCE_OLLAMA_MODEL) ||
    clean(process.env.OFFLINE_RESOURCE_LOCAL_MODEL) ||
    clean(process.env.OLLAMA_LOCAL_MODEL) ||
    "gemma4:e4b"
  );
}

function safeArray(value, max = 80) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === "string") return clean(item);
      return item;
    })
    .filter(Boolean)
    .slice(0, max);
}

function safeString(value = "", max = 12000) {
  const text = clean(value);
  if (text.length <= max) return text;
  return text.slice(0, max);
}

function extractJsonFromText(text = "") {
  const raw = clean(text);

  if (!raw) throw new Error("Gemma returned an empty response.");

  try {
    return JSON.parse(raw);
  } catch {}

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }

  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");

  if (first >= 0 && last > first) {
    const sliced = raw.slice(first, last + 1);

    try {
      return JSON.parse(sliced);
    } catch {}
  }

  throw new Error("Gemma did not return valid JSON.");
}

export function getGemmaPackClientInfo() {
  return {
    baseUrl: getOllamaBaseUrl(),
    generateUrl: getOllamaGenerateUrl(),
    model: getGemmaModel(),
  };
}

async function callGemmaText({
  prompt,
  temperature = 0.15,
  timeoutMs = numberEnv("GEMMA_RESOURCE_AI_TIMEOUT_MS", 900000),
  numCtx = numberEnv("GEMMA_RESOURCE_NUM_CTX", 8192),
  numPredict = numberEnv("GEMMA_RESOURCE_NUM_PREDICT", 3800),
} = {}) {
  const generateUrl = getOllamaGenerateUrl();
  const model = getGemmaModel();

  const response = await axios.post(
    generateUrl,
    {
      model,
      prompt,
      stream: false,
      options: {
        temperature,
        num_ctx: numCtx,
        num_predict: numPredict,
      },
    },
    {
      timeout: timeoutMs,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    }
  );

  const text = clean(response.data?.response || response.data?.text || "");

  if (!text) {
    throw new Error("Gemma returned no text.");
  }

  return {
    text,
    model: response.data?.model || model,
    raw: response.data,
  };
}

async function callGemmaJson(options = {}) {
  const result = await callGemmaText(options);

  const json = extractJsonFromText(result.text);

  return {
    json,
    model: result.model,
  };
}

function normalizeStudyPack(pack = {}, fallback = {}) {
  const sections = safeArray(pack.sections, 80).map((section, index) => ({
    title: safeString(section?.title || `Section ${index + 1}`, 180),
    summary: safeString(section?.summary || "", 1000),
    sourceRef: safeString(section?.sourceRef || section?.start || "", 80),
    start: safeString(section?.start || "", 80),
    end: safeString(section?.end || "", 80),
    chunkIds: safeArray(section?.chunkIds, 20).map((item) => String(item)),
  }));

  const roadmap = safeArray(pack.roadmap, 30).map((step, index) => ({
    step: safeString(step?.step || `Step ${index + 1}`, 80),
    title: safeString(step?.title || step?.step || `Step ${index + 1}`, 160),
    whatToDo: safeString(step?.whatToDo || step?.description || "", 900),
    why: safeString(step?.why || "", 700),
    sourceRef: safeString(step?.sourceRef || "", 80),
    chunkIds: safeArray(step?.chunkIds, 20).map((item) => String(item)),
  }));

  const practiceQuestions = safeArray(pack.practiceQuestions, 40).map(
    (question, index) => ({
      question: safeString(question?.question || `Question ${index + 1}`, 800),
      answer: safeString(question?.answer || "", 1200),
      type: safeString(question?.type || "short_answer", 80),
      difficulty: safeString(question?.difficulty || "medium", 80),
      sourceRef: safeString(question?.sourceRef || "", 80),
      chunkIds: safeArray(question?.chunkIds, 20).map((item) => String(item)),
    })
  );

  return {
    summary: safeString(pack.summary || fallback.summary || "", 3000),
    deepExplanation: safeString(
      pack.deepExplanation || fallback.deepExplanation || "",
      10000
    ),
    sections,
    keyPoints: safeArray(pack.keyPoints, 80).map((item) => safeString(item, 400)),
    concepts: safeArray(pack.concepts, 80).map((item) => safeString(item, 120)),
    tags: safeArray(pack.tags, 40).map((item) => safeString(item, 80)),
    quickRevision: safeArray(pack.quickRevision, 80).map((item) =>
      safeString(item, 400)
    ),
    roadmap,
    practiceQuestions,
  };
}

function createFallbackStudyPack({ fetched = {}, chunks = [], error = "" } = {}) {
  const firstChunks = Array.isArray(chunks) ? chunks.slice(0, 12) : [];

  const sections = firstChunks.map((chunk, index) => ({
    title: chunk.sourceRef || `Section ${index + 1}`,
    summary: clean(chunk.textPreview || chunk.text || "").slice(0, 500),
    sourceRef: chunk.sourceRef || `Chunk ${index + 1}`,
    start: chunk.timestampStart || "",
    end: chunk.timestampEnd || "",
    chunkIds: [chunk.chunkId].filter(Boolean),
  }));

  const keywordSet = new Set();

  for (const chunk of firstChunks) {
    for (const keyword of chunk.keywords || []) {
      keywordSet.add(keyword);
    }
  }

  const concepts = [...keywordSet].slice(0, 20);

  return {
    summary:
      clean(fetched.text).slice(0, 1200) ||
      "This resource was saved offline. The AI study pack could not be fully generated, but the content is available for later study.",
    deepExplanation:
      "The resource has been extracted and chunked. Gemma can still answer from the saved chunks after the Ask Gemma step is enabled.",
    sections,
    keyPoints: concepts.slice(0, 10).map((item) => `Review: ${item}`),
    concepts,
    tags: [fetched.sourceType || "resource", "offline-ready"].filter(Boolean),
    quickRevision: sections.slice(0, 8).map((section) => section.summary),
    roadmap: [
      {
        step: "Step 1",
        title: "Review summary",
        whatToDo: "Read the resource summary and identify the main topic.",
        why: "This gives context before detailed study.",
        sourceRef: "",
        chunkIds: [],
      },
      {
        step: "Step 2",
        title: "Study sections",
        whatToDo: "Go section by section using the generated source references.",
        why: "Chunked study reduces overload.",
        sourceRef: "",
        chunkIds: [],
      },
      {
        step: "Step 3",
        title: "Ask questions",
        whatToDo: "Use Ask Gemma to explain confusing parts from saved chunks.",
        why: "Grounded Q&A makes offline tutoring useful.",
        sourceRef: "",
        chunkIds: [],
      },
    ],
    practiceQuestions: [
      {
        question: "What is the main idea of this saved resource?",
        answer: "Use the summary and first sections to answer from the saved content.",
        type: "short_answer",
        difficulty: "easy",
        sourceRef: "",
        chunkIds: [],
      },
    ],
    aiError: error,
  };
}

function buildStudyPackPrompt({ fetched = {}, chunks = [], studyGoal = "" } = {}) {
  const maxContextChars = numberEnv("GEMMA_RESOURCE_MAX_CONTEXT_CHARS", 55000);

  const context = summarizeChunksForPrompt(chunks, maxContextChars);

  return `
You are Gemma Resource & Tutor.

Create a grounded offline study pack from the saved resource content.

Resource:
- Title: ${fetched.title || "Saved Resource"}
- Source type: ${fetched.sourceType || "unknown"}
- Study goal: ${studyGoal || fetched.studyGoal || "Learn this resource offline"}

Rules:
- Return ONLY valid JSON.
- Do not use markdown fences.
- Do not invent information outside the saved content.
- Use source references from chunks when possible.
- Make it useful for offline learning.
- If content is code/DSA, explain progressively: intuition, steps, dry run idea, complexity.
- If content has timestamps/pages, preserve them in sections.
- Keep the answer concise enough to parse but detailed enough to study.

Saved content chunks:
${context}

Return exactly this JSON shape:
{
  "summary": "clear overview of the resource",
  "deepExplanation": "detailed teaching explanation based only on saved content",
  "sections": [
    {
      "title": "section title",
      "summary": "what this section teaches",
      "sourceRef": "timestamp/page/chunk ref",
      "start": "optional start timestamp/page",
      "end": "optional end timestamp/page",
      "chunkIds": ["chunk_1"]
    }
  ],
  "keyPoints": ["important point"],
  "concepts": ["concept name"],
  "tags": ["short tag"],
  "quickRevision": ["short revision bullet"],
  "roadmap": [
    {
      "step": "Step 1",
      "title": "what learner should do",
      "whatToDo": "instruction",
      "why": "reason",
      "sourceRef": "timestamp/page/chunk ref",
      "chunkIds": ["chunk_1"]
    }
  ],
  "practiceQuestions": [
    {
      "question": "question",
      "answer": "answer",
      "type": "short_answer",
      "difficulty": "easy|medium|hard",
      "sourceRef": "timestamp/page/chunk ref",
      "chunkIds": ["chunk_1"]
    }
  ]
}`;
}

export async function buildGemmaStudyPack({
  fetched = {},
  chunks = [],
  studyGoal = "",
} = {}) {
  const safeChunks = Array.isArray(chunks) ? chunks : [];

  if (!safeChunks.length) {
    throw new Error("Cannot build study pack without chunks.");
  }

  const prompt = buildStudyPackPrompt({
    fetched,
    chunks: safeChunks,
    studyGoal,
  });

  try {
    const result = await callGemmaJson({
      prompt,
      temperature: 0.14,
      timeoutMs: numberEnv("GEMMA_RESOURCE_AI_TIMEOUT_MS", 900000),
      numCtx: numberEnv("GEMMA_RESOURCE_NUM_CTX", 8192),
      numPredict: numberEnv("GEMMA_RESOURCE_NUM_PREDICT", 3800),
    });

    const pack = normalizeStudyPack(result.json, {
      summary: fetched.text?.slice?.(0, 1000) || "",
    });

    return {
      ...pack,
      ai: {
        ok: true,
        model: result.model,
        provider: "ollama-local",
        baseUrl: getOllamaBaseUrl(),
        generatedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    const fallback = createFallbackStudyPack({
      fetched,
      chunks: safeChunks,
      error: error.message || String(error),
    });

    return {
      ...fallback,
      ai: {
        ok: false,
        model: getGemmaModel(),
        provider: "ollama-local",
        baseUrl: getOllamaBaseUrl(),
        error: error.message || String(error),
        generatedAt: new Date().toISOString(),
      },
    };
  }
}

export async function testGemmaPackConnection() {
  const prompt = `
Return only valid JSON:
{
  "ok": true,
  "message": "Gemma Resource Tutor is ready"
}`;

  const result = await callGemmaJson({
    prompt,
    temperature: 0,
    timeoutMs: 30000,
    numCtx: 1024,
    numPredict: 200,
  });

  return {
    ok: Boolean(result.json?.ok),
    message: result.json?.message || "",
    model: result.model,
  };
}