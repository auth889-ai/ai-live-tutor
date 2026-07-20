import { studyRuntimeConfig } from "../../config/studyRuntime.config.js";
import { qwenEnabled, callQwenGenerate } from "../qwenCompat.service.js";

/**
 * server/services/ai/agenticGemma.service.js
 * ------------------------------------------------------------
 * Final fixed Gemma service for Feature 1.
 *
 * IMPORTANT DESIGN:
 * - Realtime page detection stays Cloud Gemma first.
 * - Local Gemma is fallback for realtime only if cloud fails.
 * - Voice conversation uses Local Gemma first, Cloud fallback.
 * - No fixed domain detection.
 * - No hardcoded website rules.
 * - Gemma must judge dynamically from:
 *   goal + page text/title/url + behavior + previous state + backend scores.
 *
 * Fixes:
 * - Prevents raw JSON from showing in popup/voice/reason.
 * - Handles valid JSON, fenced JSON, nested JSON string, prose + JSON.
 * - Recovers useful fields from truncated JSON.
 * - Increases num_predict to reduce cut-off JSON.
 * - Adds self-check prompt so Gemma does not over-confidently mark unrelated pages as study.
 */

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripImagePrefix(base64 = "") {
  return String(base64 || "").replace(/^data:image\/\w+;base64,/, "");
}

function clamp01(value, fallback = 0.5) {
  const n = Number(value);

  if (!Number.isFinite(n)) return fallback;

  return Math.max(0, Math.min(1, n));
}

function asArray(value, max = 12) {
  if (!Array.isArray(value)) return [];

  return value.filter(Boolean).map(String).slice(0, max);
}

function removeMarkdownFence(text = "") {
  return String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function repairJsonText(text = "") {
  return String(text || "")
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
}

function extractFirstJsonObject(text = "") {
  const raw = removeMarkdownFence(repairJsonText(text));

  if (!raw) return "";

  const first = raw.indexOf("{");

  if (first === -1) return "";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = first; i < raw.length; i += 1) {
    const ch = raw[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") depth += 1;

    if (ch === "}") {
      depth -= 1;

      if (depth === 0) {
        return raw.slice(first, i + 1);
      }
    }
  }

  return raw.slice(first);
}

function tryJsonParse(text = "") {
  const raw = repairJsonText(text);

  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {}

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fenced?.[1]) {
    try {
      return JSON.parse(repairJsonText(fenced[1]));
    } catch {}
  }

  const objectText = extractFirstJsonObject(raw);

  if (objectText) {
    try {
      return JSON.parse(repairJsonText(objectText));
    } catch {}

    try {
      const quotedKeys = repairJsonText(objectText).replace(
        /([,{]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g,
        '$1"$2"$3'
      );

      return JSON.parse(quotedKeys);
    } catch {}
  }

  return null;
}

function parsePossiblyNestedJson(response = "") {
  const raw = clean(response);

  if (!raw) return null;

  let parsed = tryJsonParse(raw);

  if (typeof parsed === "string") {
    const nested = tryJsonParse(parsed);

    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      parsed = nested;
    }
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed;
  }

  return null;
}

function regexStringValue(raw = "", key = "") {
  const text = String(raw || "");
  const pattern = new RegExp(`"${key}"\\s*:\\s*"([^"]*)`, "i");
  const match = text.match(pattern);

  return match?.[1] ? clean(match[1]) : "";
}

function regexNumberValue(raw = "", key = "", fallback = 0.5) {
  const text = String(raw || "");
  const pattern = new RegExp(`"${key}"\\s*:\\s*([0-9.]+)`, "i");
  const match = text.match(pattern);

  if (!match?.[1]) return fallback;

  const n = Number(match[1]);

  return Number.isFinite(n) ? n : fallback;
}

function regexBooleanValue(raw = "", key = "", fallback = false) {
  const text = String(raw || "");
  const pattern = new RegExp(`"${key}"\\s*:\\s*(true|false)`, "i");
  const match = text.match(pattern);

  if (!match?.[1]) return fallback;

  return match[1].toLowerCase() === "true";
}

function looksLikeRawJson(value = "") {
  const text = clean(value);

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

function safeUserText(value = "", fallback = "") {
  const text = clean(value);

  if (!text) return fallback;
  if (looksLikeRawJson(text)) return fallback;

  return text;
}

function inferFallbackTypeFromRaw(rawText = "") {
  const raw = String(rawText || "").toLowerCase();

  const typeRaw = regexStringValue(rawText, "type");

  if (["study", "partial", "non-study"].includes(typeRaw)) {
    return typeRaw;
  }

  if (raw.includes('"non-study"') || raw.includes("non-study")) {
    return "non-study";
  }

  if (raw.includes('"study"') || raw.includes("study")) {
    return "study";
  }

  return "partial";
}

function recoverFromTruncatedJson(rawText = "", meta = {}) {
  const raw = String(rawText || "");

  const type = inferFallbackTypeFromRaw(raw);
  const decisionRaw = regexStringValue(raw, "decision");
  const reasonRaw = regexStringValue(raw, "reason");
  const motivationRaw = regexStringValue(raw, "motivation");
  const voiceRaw = regexStringValue(raw, "voiceText");
  const replyRaw = regexStringValue(raw, "reply");
  const followUpRaw = regexStringValue(raw, "followUpQuestion");
  const confidenceRaw = regexNumberValue(raw, "confidence", 0.45);
  const needsUserCheckRaw = regexBooleanValue(raw, "needsUserCheck", false);

  const decision = ["continue", "ask", "intervene", "refocus"].includes(
    decisionRaw
  )
    ? decisionRaw
    : type === "non-study"
      ? "intervene"
      : type === "study"
        ? "continue"
        : "ask";

  const reason =
    safeUserText(reasonRaw) ||
    (type === "non-study"
      ? "This page does not clearly support your current study goal."
      : type === "study"
        ? "This page appears connected to your current study goal."
        : "AI could not fully verify whether this page helps your study goal.");

  const motivation =
    safeUserText(motivationRaw) ||
    (type === "non-study"
      ? "Let’s return to your study goal for five minutes."
      : type === "study"
        ? "Good. Keep going with your study goal."
        : "Please confirm if this page helps your study goal.");

  const voiceText =
    safeUserText(voiceRaw) ||
    safeUserText(replyRaw) ||
    (type === "non-study"
      ? "This may not support your study goal. Return to your study for five minutes."
      : type === "study"
        ? "This looks useful for your study goal. Keep going."
        : "Is this page helping your study goal?");

  const followUpQuestion =
    safeUserText(followUpRaw) ||
    (type === "partial" ? "Is this page helping your study goal?" : "");

  return {
    provider: meta.provider || "gemma",
    mode: meta.mode || "recovered",
    type,
    correctedType: type,
    confidence: clamp01(
      confidenceRaw,
      type === "non-study" ? 0.7 : type === "study" ? 0.7 : 0.45
    ),
    decision,
    reason,
    motivation,
    voiceText,
    reply: voiceText,
    followUpQuestion,
    needsUserCheck:
      type === "partial" ? true : Boolean(needsUserCheckRaw && type !== "study"),
    shouldContinueConversation: type === "partial",
    finalDecisionMade: type !== "partial",
    conversationStage: meta.stage || 1,
    stopReason: "Recovered usable fields from incomplete Gemma JSON.",
    memoryNote: reason,
    visualAnalysis: {
      summary: "No screenshot provided or no reliable visual evidence.",
      uiType: "unknown",
      visibleElements: [],
      userActivity: "unknown",
      distractionSignals: [],
      studySignals: [],
      visualConfidence: 0.5,
    },
    textAnalysis: {
      summary: reason,
      goalMatch:
        type === "study" ? "strong" : type === "non-study" ? "none" : "unknown",
      importantTerms: [],
      confidence: clamp01(confidenceRaw, 0.5),
    },
    selfCheck: {
      goalUnderstanding: "",
      pageUnderstanding: "",
      directGoalEvidence:
        type === "study" ? "medium" : type === "non-study" ? "none" : "unknown",
      behaviorMeaning: "unclear",
      uncertainty: type === "partial" ? "high" : "medium",
    },
    conflict: {
      exists: false,
      kind: "none",
      explanation: "No important conflict detected.",
    },
    conflictingSignals: [],
    screenshotInfluence: "none",
    explainability: {
      bullets: [reason],
      evidence: [],
      userVisibleReason: reason,
    },
    rawParsed: {},
    parseOk: false,
  };
}

function normalizeOllamaGenerateUrl(url = "") {
  const cleanUrl = clean(url).replace(/\/+$/, "");

  if (!cleanUrl) return "";
  if (cleanUrl.endsWith("/api/generate")) return cleanUrl;

  return `${cleanUrl}/api/generate`;
}

function getRuntimeValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && clean(value)) {
      return clean(value);
    }
  }

  return "";
}

function getCloudConfig() {
  return {
    url: getRuntimeValue(
      studyRuntimeConfig?.cloudGemmaUrl,
      process.env.OLLAMA_CLOUD_URL
    ),
    model: getRuntimeValue(
      studyRuntimeConfig?.cloudGemmaModel,
      process.env.OLLAMA_CLOUD_MODEL
    ),
  };
}

function getLocalConfig() {
  return {
    url: getRuntimeValue(
      studyRuntimeConfig?.localGemmaUrl,
      process.env.OLLAMA_LOCAL_URL,
      process.env.OLLAMA_URL
    ),
    model: getRuntimeValue(
      studyRuntimeConfig?.localGemmaModel,
      process.env.OLLAMA_LOCAL_MODEL,
      process.env.OLLAMA_MODEL
    ),
  };
}

function getTimeouts() {
  return {
    cloudTimeout: Number(process.env.OLLAMA_CLOUD_TIMEOUT_MS || 45000),
    localTimeout: Number(process.env.OLLAMA_LOCAL_TIMEOUT_MS || 25000),
  };
}

async function callOllama({
  url,
  model,
  prompt,
  images = [],
  timeoutMs = 45000,
  label = "Gemma",
  mode = "realtime",
}) {
  if (!url || !model) {
    throw new Error(`${label} URL/model missing`);
  }

  // FOREVER: route the study classification to Qwen (text or vision) instead of Ollama/Gemma.
  if (qwenEnabled()) {
    const q = await callQwenGenerate({ prompt, images, json: true, temperature: mode === "deep" ? 0.2 : 0.1, timeoutMs });
    return { text: q.text, raw: q.raw, model: q.model, latencyMs: q.latencyMs };
  }

  const finalUrl = normalizeOllamaGenerateUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const body = {
    model,
    prompt,
    stream: false,
    format: "json",
    options: {
      temperature: mode === "deep" ? 0.2 : 0.1,
      num_predict: mode === "voice" ? 900 : mode === "deep" ? 1100 : 800,
      num_ctx: mode === "deep" ? 4096 : 3072,
      repeat_penalty: 1.05,
    },
  };

  if (Array.isArray(images) && images.length) {
    body.images = images;
  }

  const startedAt = Date.now();

  try {
    console.log(`[${label}] calling:`, finalUrl, "model:", model);

    const res = await fetch(finalUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");

      throw new Error(
        `${label} failed ${res.status}: ${errorText || res.statusText}`
      );
    }

    const data = await res.json();

    console.log(`[${label}] success in ${Date.now() - startedAt}ms`);

    return data.response || "";
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeVisualAnalysis(parsed = {}) {
  const visual =
    typeof parsed.visualAnalysis === "object" && parsed.visualAnalysis !== null
      ? parsed.visualAnalysis
      : {};

  return {
    summary:
      safeUserText(visual.summary) ||
      (typeof parsed.visualAnalysis === "string"
        ? safeUserText(parsed.visualAnalysis)
        : "") ||
      "No screenshot provided or no reliable visual evidence.",
    uiType: visual.uiType || parsed.uiType || "unknown",
    visibleElements: asArray(visual.visibleElements || parsed.visibleElements, 10),
    userActivity: visual.userActivity || parsed.userActivity || "unknown",
    distractionSignals: asArray(
      visual.distractionSignals || parsed.distractionSignals,
      8
    ),
    studySignals: asArray(visual.studySignals || parsed.studySignals, 8),
    visualConfidence: clamp01(
      visual.visualConfidence ?? visual.confidence ?? parsed.visualConfidence,
      0.5
    ),
  };
}

function normalizeTextAnalysis(parsed = {}, fallbackReason = "") {
  const text =
    typeof parsed.textAnalysis === "object" && parsed.textAnalysis !== null
      ? parsed.textAnalysis
      : {};

  return {
    summary:
      safeUserText(text.summary) ||
      safeUserText(parsed.textSummary) ||
      fallbackReason,
    goalMatch: text.goalMatch || parsed.goalMatch || "unknown",
    importantTerms: asArray(text.importantTerms || parsed.importantTerms, 10),
    confidence: clamp01(text.confidence ?? parsed.textConfidence, 0.5),
  };
}

function normalizeSelfCheck(parsed = {}) {
  const raw =
    typeof parsed.selfCheck === "object" && parsed.selfCheck !== null
      ? parsed.selfCheck
      : {};

  return {
    goalUnderstanding: safeUserText(raw.goalUnderstanding) || "",
    pageUnderstanding: safeUserText(raw.pageUnderstanding) || "",
    directGoalEvidence: raw.directGoalEvidence || "unknown",
    behaviorMeaning: raw.behaviorMeaning || "unclear",
    uncertainty: raw.uncertainty || "medium",
  };
}

function normalizeConflict(parsed = {}) {
  const raw =
    typeof parsed.conflict === "object" && parsed.conflict !== null
      ? parsed.conflict
      : {};

  const conflictingSignals = asArray(parsed.conflictingSignals || raw.signals, 8);

  return {
    exists:
      typeof raw.exists === "boolean"
        ? raw.exists
        : Boolean(conflictingSignals.length),
    kind: raw.kind || parsed.conflictKind || "none",
    explanation:
      safeUserText(raw.explanation) ||
      safeUserText(parsed.conflictExplanation) ||
      "No important conflict detected.",
    conflictingSignals,
  };
}

function normalizeExplainability(parsed = {}, fallbackReason = "") {
  const raw =
    typeof parsed.explainability === "object" && parsed.explainability !== null
      ? parsed.explainability
      : {};

  const bullets = asArray(raw.bullets || parsed.explainabilityBullets, 5)
    .map((item) => safeUserText(item))
    .filter(Boolean);

  const evidence = asArray(raw.evidence || parsed.evidence, 5)
    .map((item) => safeUserText(item))
    .filter(Boolean);

  return {
    bullets: bullets.length
      ? bullets
      : [fallbackReason || "AI compared the page with your study goal."],
    evidence,
    userVisibleReason:
      safeUserText(raw.userVisibleReason) ||
      safeUserText(parsed.userVisibleReason) ||
      fallbackReason ||
      "AI compared the page with your study goal.",
  };
}

function normalizeAgentResult(parsed = {}, meta = {}) {
  const safe =
    parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};

  const allowedTypes = ["study", "partial", "non-study"];
  const allowedActions = ["continue", "ask", "intervene", "refocus"];

  const rawType = clean(safe.type || safe.finalType || safe.classification);
  const type = allowedTypes.includes(rawType) ? rawType : "partial";

  const decisionRaw = clean(safe.decision || safe.action);
  const decision = allowedActions.includes(decisionRaw)
    ? decisionRaw
    : type === "study"
      ? "continue"
      : type === "non-study"
        ? "intervene"
        : "ask";

  const confidence = clamp01(
    safe.finalConfidence ?? safe.confidence ?? safe.score,
    type === "non-study" ? 0.7 : 0.5
  );

  const reason =
    safeUserText(safe.reason || safe.decisionReason || safe.explanation) ||
    (type === "non-study"
      ? "This page does not look connected to your study goal."
      : type === "study"
        ? "This page looks connected to your study goal."
        : "AI is not fully sure whether this page helps your study goal.");

  const motivation =
    safeUserText(safe.motivation || safe.suggestion) ||
    (type === "non-study"
      ? "Let’s return to your study goal for five minutes."
      : type === "study"
        ? "Good. Keep going."
        : "Please confirm if this page helps your study goal.");

  const voiceText =
    safeUserText(safe.voiceText || safe.reply || safe.motivation) || motivation;

  const followUpQuestion =
    safeUserText(safe.followUpQuestion || safe.followUp) ||
    (type === "partial" ? "Is this page helping your study goal?" : "");

  const conflict = normalizeConflict(safe);

  return {
    provider: meta.provider || "gemma",
    mode: meta.mode || "realtime",

    type,
    correctedType: allowedTypes.includes(safe.correctedType)
      ? safe.correctedType
      : type,
    confidence,
    decision,

    reason,
    motivation,
    voiceText,
    reply: safeUserText(safe.reply) || voiceText,
    followUpQuestion,

    needsUserCheck:
      typeof safe.needsUserCheck === "boolean"
        ? safe.needsUserCheck
        : type === "partial",

    shouldContinueConversation:
      typeof safe.shouldContinueConversation === "boolean"
        ? safe.shouldContinueConversation
        : type === "partial",

    finalDecisionMade:
      typeof safe.finalDecisionMade === "boolean"
        ? safe.finalDecisionMade
        : type !== "partial",

    conversationStage: Number(safe.conversationStage || meta.stage || 1),
    stopReason: safeUserText(safe.stopReason) || "",
    memoryNote: safeUserText(safe.memoryNote) || reason,

    selfCheck: normalizeSelfCheck(safe),
    visualAnalysis: normalizeVisualAnalysis(safe),
    textAnalysis: normalizeTextAnalysis(safe, reason),

    conflict: {
      exists: conflict.exists,
      kind: conflict.kind,
      explanation: conflict.explanation,
    },

    conflictingSignals: conflict.conflictingSignals,

    screenshotInfluence:
      safe.screenshotInfluence || (meta.hasScreenshot ? "medium" : "none"),

    explainability: normalizeExplainability(safe, reason),

    rawParsed: safe,
    parseOk: true,
  };
}

function getVisibleText(payload = {}) {
  return (
    payload.page?.visibleText ||
    payload.page?.text ||
    payload.page?.bodyText ||
    payload.visibleText ||
    ""
  );
}

function buildConversationMemoryText(memory = []) {
  if (!Array.isArray(memory) || !memory.length) {
    return "No previous conversation memory.";
  }

  return memory
    .slice(-6)
    .map((turn, index) => {
      return `${index + 1}. ${turn.role || "unknown"}: ${
        turn.text || turn.coachMessage?.text || ""
      }`;
    })
    .join("\n");
}

function buildRealtimePrompt(payload = {}) {
  const visibleText = getVisibleText(payload);
  const maxText = Number(process.env.STUDY_MAX_TEXT_CHARS || 1200);

  return `
Return valid JSON only. No markdown. No explanation outside JSON.

You are Cloud Gemma, the dynamic realtime AI study-focus classifier.

Your job:
Decide whether the current page is helping the user's exact study goal.

Important:
- Do NOT use fixed domain rules.
- A website can be study or distraction depending on the user's goal.
- YouTube can be study if it teaches the goal, but distraction if it is unrelated.
- ChatGPT can be study if it helps the current goal, but distraction if unrelated.
- Social/media/music/video pages can be study only if their content clearly supports the goal.
- If title/text/behavior do not clearly support the goal, do NOT confidently say study.
- If evidence is mixed, choose "partial" and ask user.
- If evidence clearly conflicts with the goal, choose "non-study".
- Never put JSON inside reason, motivation, voiceText, or reply.
- Keep user-facing text short and natural.

User study goal:
${payload.goal || ""}

Current page:
URL: ${payload.page?.url || ""}
Domain: ${payload.page?.domain || ""}
Title: ${payload.page?.title || ""}

Visible page text:
${String(visibleText || "").slice(0, maxText)}

Behavior:
${JSON.stringify({
  dwellMs: payload.behavior?.dwellMs,
  scrollDepth: payload.behavior?.scrollDepth,
  scrollSpeed: payload.behavior?.scrollSpeed,
  tabSwitches: payload.behavior?.tabSwitches,
  idleMs: payload.behavior?.idleMs,
  typingCount: payload.behavior?.typingCount,
  mouseMoves: payload.behavior?.mouseMoves,
  routeChanges: payload.behavior?.routeChanges,
  isHidden: payload.behavior?.isHidden,
})}

Backend non-AI signals:
${JSON.stringify({
  relevanceScore: payload.relevanceScore,
  behaviorScore: payload.behaviorScore,
  patternScore: payload.patternScore,
  previousType: payload.previousState?.type,
  previousDomain: payload.previousState?.domain,
  previousTitle: payload.previousState?.title,
})}

Self-check before final answer:
1. What is the user's goal?
2. What is this page actually about?
3. Is there direct evidence this page helps the goal?
4. Is the behavior active study, passive watching, scrolling, idle, or unclear?
5. Are you over-trusting the website/domain/title?
6. If unsure, ask user instead of saying study.

Return this exact JSON shape:
{
  "type": "study or partial or non-study",
  "confidence": 0.0,
  "decision": "continue or ask or intervene or refocus",
  "reason": "short human reason",
  "needsUserCheck": false,
  "motivation": "short helpful motivation",
  "voiceText": "short spoken coaching sentence",
  "followUpQuestion": "",
  "selfCheck": {
    "goalUnderstanding": "short",
    "pageUnderstanding": "short",
    "directGoalEvidence": "strong or medium or weak or none",
    "behaviorMeaning": "active study or passive watch or scrolling or idle or unclear",
    "uncertainty": "low or medium or high"
  },
  "textAnalysis": {
    "summary": "short",
    "goalMatch": "strong or medium or weak or none or unknown",
    "importantTerms": [],
    "confidence": 0.0
  },
  "explainability": {
    "bullets": ["short evidence"],
    "evidence": [],
    "userVisibleReason": "simple reason"
  }
}
`;
}

function buildDeepPrompt(payload = {}) {
  return `
Return valid JSON only. No markdown.

You are the deep reasoning brain for a study monitoring system.
Analyze whether the page supports the user's study goal.

Important:
- Do not use fixed domain assumptions.
- Use page, behavior, memory, previous state, and screenshot if attached.
- If screenshot conflicts with text, mention visual conflict.
- Do not put JSON string inside user-facing fields.
- Keep reason/motivation/voiceText human and short.

Goal:
${payload.goal || ""}

Page:
${JSON.stringify(payload.page || {}).slice(0, 2200)}

Behavior:
${JSON.stringify(payload.behavior || {}).slice(0, 1000)}

Previous state:
${JSON.stringify(payload.previousState || {}).slice(0, 700)}

Conversation memory:
${buildConversationMemoryText(payload.conversationMemory)}

Screenshot:
${payload.page?.screenshotBase64 ? "attached" : "not attached"}

Return JSON:
{
  "type": "study or partial or non-study",
  "confidence": 0.0,
  "decision": "continue or ask or intervene or refocus",
  "reason": "short human reason",
  "reflection": "short self-check",
  "visualAnalysis": {
    "summary": "short visual summary",
    "uiType": "article or documentation or coding/editor or video lecture or short-video/reels or social feed or chat or search page or unknown",
    "visibleElements": [],
    "userActivity": "reading or coding or watching lecture or passive watching or scrolling or distracted browsing or unknown",
    "distractionSignals": [],
    "studySignals": [],
    "visualConfidence": 0.0
  },
  "textAnalysis": {
    "summary": "short",
    "goalMatch": "strong or medium or weak or none or unknown",
    "importantTerms": [],
    "confidence": 0.0
  },
  "conflict": {
    "exists": false,
    "kind": "none",
    "explanation": ""
  },
  "conflictingSignals": [],
  "screenshotInfluence": "none or weak or medium or strong",
  "needsUserCheck": false,
  "motivation": "short motivation",
  "voiceText": "spoken sentence",
  "followUpQuestion": "",
  "explainability": {
    "bullets": [],
    "evidence": [],
    "userVisibleReason": "simple reason"
  }
}
`;
}

function buildVoicePrompt(payload = {}) {
  return `
Return valid JSON only. No markdown.

You are a supportive voice AI study coach.

Important:
- If user admits distraction, classify non-study and give direct refocus.
- If user says page is useful for goal, classify study.
- If unclear, ask one short follow-up.
- Never return raw JSON as text.
- Keep reply friendly and short.

Goal:
${payload.goal || ""}

Conversation stage:
${payload.conversationStage || 1}

User said:
${payload.userMessage || payload.message || ""}

Current page:
${JSON.stringify(payload.page || {}).slice(0, 1200)}

Current activity:
${JSON.stringify(payload.activity || {}).slice(0, 1200)}

Conversation memory:
${buildConversationMemoryText(payload.conversationMemory)}

Return JSON:
{
  "reply": "short natural answer",
  "voiceText": "spoken version",
  "type": "partial",
  "correctedType": "partial",
  "confidence": 0.0,
  "decision": "ask",
  "reason": "short human reason",
  "needsUserCheck": false,
  "shouldContinueConversation": false,
  "finalDecisionMade": true,
  "conversationStage": 1,
  "followUpQuestion": "",
  "stopReason": "why",
  "memoryNote": "what to remember",
  "motivation": "short motivation",
  "tips": ["one tip"],
  "suggestions": ["one next action"],
  "explainability": {
    "bullets": ["why"],
    "evidence": [],
    "userVisibleReason": "simple reason"
  }
}
`;
}

async function runProviders({ providers, prompt, images = [], mode, stage = 1 }) {
  let lastError = null;

  const validProviders = providers.filter((p) => p.url && p.model);

  if (!validProviders.length) {
    throw new Error(`No Gemma provider configured for ${mode}`);
  }

  for (const provider of validProviders) {
    try {
      const raw = await callOllama({
        url: provider.url,
        model: provider.model,
        prompt,
        images,
        timeoutMs: provider.timeoutMs,
        label: provider.label,
        mode,
      });

      const parsed = parsePossiblyNestedJson(raw);

      if (parsed) {
        const normalized = normalizeAgentResult(parsed, {
          provider: provider.provider,
          mode,
          hasScreenshot: images.length > 0,
          stage,
        });

        console.log(
          `[${provider.label}] parsed:`,
          normalized.type,
          normalized.confidence,
          normalized.decision,
          `parseOk=${normalized.parseOk}`
        );

        return normalized;
      }

      const recovered = recoverFromTruncatedJson(raw, {
        provider: provider.provider,
        mode,
        stage,
      });

      console.warn(
        `[${provider.label}] JSON parse failed, recovered:`,
        recovered.type,
        recovered.decision
      );

      return recovered;
    } catch (error) {
      lastError = error;
      console.warn(`[${provider.label}] failed:`, error?.message || error);
    }
  }

  throw lastError || new Error(`No Gemma provider available for ${mode}`);
}

export async function analyzeRealtimeWithCloudGemma(payload = {}) {
  const prompt = buildRealtimePrompt(payload);
  const { cloudTimeout, localTimeout } = getTimeouts();
  const cloud = getCloudConfig();
  const local = getLocalConfig();

  /**
   * Your required logic:
   * - Detection/classification = Cloud first.
   * - Local is only fallback if cloud fails.
   * - No fixed domain detection.
   */
  return runProviders({
    mode: "realtime",
    prompt,
    providers: [
      {
        ...cloud,
        label: "Gemma realtime cloud",
        timeoutMs: Math.max(cloudTimeout, 45000),
        provider: "cloud-gemma",
      },
      {
        ...local,
        label: "Gemma realtime local fallback",
        timeoutMs: Math.max(localTimeout, 25000),
        provider: "local-gemma",
      },
    ],
  });
}

export async function analyzeDeepWithCloudGemma(payload = {}) {
  const prompt = buildDeepPrompt(payload);
  const { cloudTimeout, localTimeout } = getTimeouts();
  const cloud = getCloudConfig();
  const local = getLocalConfig();

  const images = payload.page?.screenshotBase64
    ? [stripImagePrefix(payload.page.screenshotBase64)]
    : [];

  return runProviders({
    mode: "deep",
    prompt,
    images,
    providers: [
      {
        ...cloud,
        label: "Gemma deep cloud",
        timeoutMs: Math.max(cloudTimeout, 60000),
        provider: "cloud-gemma",
      },
      {
        ...local,
        label: "Gemma deep local fallback",
        timeoutMs: Math.max(localTimeout, 30000),
        provider: "local-gemma",
      },
    ],
  });
}

export async function analyzeWithAgenticGemma(payload = {}) {
  return analyzeDeepWithCloudGemma(payload);
}

export async function analyzeVoiceReplyWithAgenticGemma(payload = {}) {
  const prompt = buildVoicePrompt(payload);
  const { cloudTimeout, localTimeout } = getTimeouts();
  const local = getLocalConfig();
  const cloud = getCloudConfig();

  const images = payload.page?.screenshotBase64
    ? [stripImagePrefix(payload.page.screenshotBase64)]
    : [];

  /**
   * Voice conversation:
   * - Local first for low-latency conversation.
   * - Cloud fallback.
   * This is only for chat/voice, not page detection.
   */
  return runProviders({
    mode: "voice",
    prompt,
    images,
    stage: payload.conversationStage || 1,
    providers: [
      {
        ...local,
        label: "Gemma voice local",
        timeoutMs: Math.max(localTimeout, 25000),
        provider: "local-gemma",
      },
      {
        ...cloud,
        label: "Gemma voice cloud fallback",
        timeoutMs: Math.max(cloudTimeout, 45000),
        provider: "cloud-gemma",
      },
    ],
  });
}