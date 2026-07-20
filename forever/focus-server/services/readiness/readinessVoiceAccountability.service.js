import mongoose from "mongoose";

import ReadinessTask from "../../models/ReadinessTask.js";
import ReadinessUserPreference from "../../models/ReadinessUserPreference.js";
import ReadinessVoiceConversation from "../../models/ReadinessVoiceConversation.js";
import * as readinessAi from "./readinessAi.service.js";
import { runReadinessVoiceCoachGraph } from "./readinessVoiceCoachGraph.service.js";

/**
 * Readiness Voice Accountability Service
 * ------------------------------------------------------------
 * Final goal:
 * - Only today's unfinished Calendar 2 tasks.
 * - English-only AI voice/chat.
 * - Gemma/LangGraph generates dynamic human-like replies.
 * - Backend rules only decide scheduling/status/progress.
 * - Every non-done reply creates nextCheckAt.
 * - User delay time is respected.
 * - Sad/stressed/stuck/tired replies still create a next check.
 * - No MongoDB conflicting update on voice.checkIns.
 * - WebSocket worker can trigger due checks from voice.nextCheckAt.
 *
 * Important:
 * - Worker should directly emit due tasks and should NOT call getNextVoiceAccountabilityTask().
 * - This service still supports manual "Next" button with force=true.
 * - LangGraph is optional/additive. If it fails, old Gemma prompt fallback still works.
 */

const FEATURE = "ReadinessVoiceAccountability";
const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;

const DONE_STATUSES = new Set(["done", "completed", "cancelled", "skipped"]);

const DB_INTENTS = new Set([
  "",
  "ready",
  "delayed",
  "stuck",
  "tired",
  "stressed",
  "progress",
  "completed",
  "cannot_today",
  "unknown",
]);

const API_INTENTS = new Set([
  "ready",
  "delayed",
  "stuck",
  "tired",
  "stressed",
  "progress",
  "completed",
  "cannot_today",
  "no_response",
  "unknown",
]);

const DB_MOODS = new Set([
  "",
  "focused",
  "tired",
  "stressed",
  "confused",
  "sad",
  "neutral",
  "motivated",
]);

function logStart(label, extra = "") {
  const startedAt = Date.now();
  console.log(`[${FEATURE}] ${label} start${extra ? ` ${extra}` : ""}`);
  return startedAt;
}

function logEnd(label, startedAt, extra = "") {
  const ms = Date.now() - startedAt;
  console.log(`[${FEATURE}] ${label} done in ${ms}ms${extra ? ` ${extra}` : ""}`);
  return ms;
}

function logWarn(label, error) {
  console.warn(`[${FEATURE}] ${label}:`, error?.message || error);
}

function makeError(message, status = 500, code = "voice_accountability_error") {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  err.code = code;
  return err;
}

function clean(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function requireUserId(payload = {}) {
  const userId = clean(payload.userId);

  if (!userId) {
    throw makeError("Authenticated user id missing.", 401, "auth_user_missing");
  }

  return userId;
}

function requireObjectId(value, name = "id") {
  const id = clean(value);

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw makeError(`${name} is invalid.`, 400, "invalid_object_id");
  }

  return id;
}

function clampPercent(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function addMinutes(date, minutes) {
  return new Date(new Date(date).getTime() + Number(minutes || 0) * 60 * 1000);
}

function historyExpiryDate() {
  return new Date(Date.now() + FIFTEEN_DAYS_MS);
}

function oldCheckinCutoffDate() {
  return new Date(Date.now() - FIFTEEN_DAYS_MS);
}

function taskTitle(task = {}) {
  return clean(task.title || task.topic || task.deadlineTitle || "this task");
}

function taskCourse(task = {}) {
  return clean(task.courseCode || task.courseTitle || "");
}

function isTaskCompleted(task) {
  return (
    DONE_STATUSES.has(clean(task?.status).toLowerCase()) ||
    clampPercent(task?.voice?.progressPercent, 0) >= 100
  );
}

function safeDbIntent(intent = "") {
  const value = clean(intent).toLowerCase();

  if (value === "no_response") return "delayed";

  return DB_INTENTS.has(value) ? value : "unknown";
}

function safeApiIntent(intent = "") {
  const value = clean(intent).toLowerCase();
  return API_INTENTS.has(value) ? value : "unknown";
}

function safeDbMood(mood = "") {
  const value = clean(mood).toLowerCase();
  return DB_MOODS.has(value) ? value : "neutral";
}

function isExplicitStop(text = "") {
  const value = clean(text).toLowerCase();

  return /\b(ok stop|stop|cancel|enough|quit|end this|leave me|don't ask|do not ask|shut up|no more|do not disturb|don't disturb|cannot disturb)\b|থাম|বন্ধ|ডিস্টার্ব|বিরক্ত/i.test(
    value
  );
}

function parseNoResponseCount(text = "") {
  const value = clean(text);
  const match = value.match(/^__NO_RESPONSE__:(\d+)$/i);

  if (!match) return 0;

  return Math.max(1, Math.min(3, Number(match[1] || 1)));
}

function isNoResponseText(text = "") {
  return parseNoResponseCount(text) > 0;
}

function parseProgressPercent(text = "") {
  const value = clean(text);
  const match = value.match(/(\d{1,3})\s*(%|percent|পারসেন্ট)/i);

  if (!match) return null;

  return clampPercent(match[1], 0);
}

function parseDelayMinutes(text = "") {
  const value = clean(text).toLowerCase();

  const numeric = value.match(/(\d{1,3})\s*(minute|min|minutes|mins|মিনিট)/i);

  if (numeric) {
    return Math.max(1, Math.min(240, Number(numeric[1])));
  }

  const hourNumeric = value.match(/(\d{1,2})\s*(hour|hours|hr|hrs|ঘন্টা|ঘণ্টা)/i);

  if (hourNumeric) {
    return Math.max(1, Math.min(12, Number(hourNumeric[1]))) * 60;
  }

  if (/\bfive minutes?\b/i.test(value)) return 5;
  if (/\bten minutes?\b/i.test(value)) return 10;
  if (/\bfifteen minutes?\b/i.test(value)) return 15;
  if (/\btwenty minutes?\b/i.test(value)) return 20;
  if (/\bthirty minutes?\b/i.test(value)) return 30;
  if (/\bone hour\b|\b1 hour\b/i.test(value)) return 60;

  return null;
}

function detectBackendIntent(text = "") {
  const value = clean(text).toLowerCase();

  if (isNoResponseText(value)) return "no_response";

  if (isExplicitStop(value)) return "cannot_today";

  if (
    /\b(done|finished|finish|complete|completed|all done|i did it|submitted|submit done)\b|শেষ|করেছি|হয়ে গেছে|হয়ে গেছে|জমা দিয়েছি|সাবমিট/i.test(
      value
    )
  ) {
    return "completed";
  }

  const percent = parseProgressPercent(value);

  if (percent !== null) {
    return percent >= 100 ? "completed" : "progress";
  }

  if (
    /\b(stuck|confused|blocked|don't understand|do not understand|help|lost|cannot understand|can't understand|hard|difficult|explain|teach me|what is|how to|why)\b|আটকে|বুঝি না|বুঝতে পারছি না|হেল্প/i.test(
      value
    )
  ) {
    return "stuck";
  }

  if (
    /\b(tired|sleepy|exhausted|low energy|no energy|weak|sick|lazy)\b|ক্লান্ত|ঘুম|ঘুম পাচ্ছে|দুর্বল|অসুস্থ/i.test(
      value
    )
  ) {
    return "tired";
  }

  if (
    /\b(stress|stressed|depressed|sad|anxious|pressure|panic|overwhelmed|bad mood|cry|crying|afraid|fear|i feel bad|i feel sad|i am sad|feeling sad|motivation|motivate me)\b|চাপ|ভয়|ভয়|মন খারাপ|ডিপ্রেস|কাঁদতে|কান্না/i.test(
      value
    )
  ) {
    return "stressed";
  }

  if (
    /\b(later|after|delay|remind me|postpone|not now|again later|cannot now|can't now|not possible now|call me|check me)\b|পরে|আরেকটু পরে|এখন না|এখন পারব না/i.test(
      value
    )
  ) {
    return "delayed";
  }

  if (
    /\b(started|starting|yes|ready|i can|okay|ok|i will do|i am doing|doing now|can start|i can start|let's start|lets start)\b|শুরু|হ্যাঁ|করবো|করছি|রেডি/i.test(
      value
    )
  ) {
    return "ready";
  }

  return "unknown";
}

function localDateKeyFor(dateValue, timezone) {
  const date = dateValue ? new Date(dateValue) : new Date();

  if (Number.isNaN(date.getTime())) return "";

  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "Asia/Dhaka",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);

    const map = {};

    for (const part of parts) {
      if (part.type !== "literal") map[part.type] = part.value;
    }

    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function taskStartMinutes(task) {
  const raw = clean(task?.startTime, "00:00");
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);

  if (!match) return 0;

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const suffix = clean(match[3]).toLowerCase();

  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;

  return Math.max(0, Math.min(23, hour)) * 60 + Math.max(0, Math.min(59, minute));
}

function currentLocalMinutes(timezone) {
  const now = new Date();

  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone || "Asia/Dhaka",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);

    const map = {};

    for (const part of parts) {
      if (part.type !== "literal") map[part.type] = part.value;
    }

    return Number(map.hour || 0) * 60 + Number(map.minute || 0);
  } catch {
    return now.getHours() * 60 + now.getMinutes();
  }
}

async function getTimezone(userId) {
  const pref = await ReadinessUserPreference.findOne({ userId }).lean();

  return (
    clean(pref?.timezone) ||
    clean(process.env.READINESS_TIMEZONE) ||
    clean(process.env.READINESS_DEFAULT_TIMEZONE) ||
    "Asia/Dhaka"
  );
}

async function userVoiceEnabled(userId) {
  const pref = await ReadinessUserPreference.findOne({ userId }).lean();
  return pref?.voiceEnabled !== false;
}

function defaultNextCheckMinutesForIntent(intent, task = {}) {
  const normalized = clean(intent).toLowerCase();

  if (normalized === "ready") {
    return Math.max(
      5,
      Math.min(
        90,
        Number(process.env.READINESS_READY_CHECK_MINUTES || task.durationMinutes || 25)
      )
    );
  }

  if (normalized === "progress") {
    return Math.max(
      5,
      Math.min(90, Number(process.env.READINESS_PROGRESS_CHECK_MINUTES || 30))
    );
  }

  if (normalized === "stressed" || normalized === "tired") {
    return Math.max(
      5,
      Math.min(60, Number(process.env.READINESS_EMOTION_CHECK_MINUTES || 10))
    );
  }

  if (normalized === "stuck") {
    return Math.max(
      5,
      Math.min(60, Number(process.env.READINESS_STUCK_CHECK_MINUTES || 10))
    );
  }

  if (normalized === "no_response") {
    return 5;
  }

  if (normalized === "delayed") {
    return Math.max(
      10,
      Math.min(60, Number(process.env.READINESS_DELAYED_CHECK_MINUTES || 20))
    );
  }

  if (normalized === "cannot_today") {
    return Math.max(
      20,
      Math.min(120, Number(process.env.READINESS_CANNOT_TODAY_CHECK_MINUTES || 60))
    );
  }

  return Math.max(
    10,
    Math.min(60, Number(process.env.READINESS_UNKNOWN_CHECK_MINUTES || 20))
  );
}

function chooseNextCheckMinutes({ intent, userText, task }) {
  const exactDelay = parseDelayMinutes(userText);

  if (exactDelay) return exactDelay;

  if (intent === "completed") return 0;

  const noResponseCount = parseNoResponseCount(userText);

  if (intent === "no_response") {
    if (noResponseCount <= 1) return 5;
    if (noResponseCount === 2) return 10;
    return 30;
  }

  return defaultNextCheckMinutesForIntent(intent, task);
}

function coerceAiObject(raw, fallback) {
  if (!raw) return fallback;

  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw;
  }

  const text = String(raw);

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);

    if (!match) return fallback;

    try {
      return JSON.parse(match[0]);
    } catch {
      return fallback;
    }
  }
}

async function callCoachAi(prompt, fallback, options = {}) {
  const startedAt = logStart(
    "Gemma",
    `feature=voice-accountability kind=${options.kind || "reply"}`
  );

  try {
    if (typeof readinessAi.callGemma === "function") {
      const result = await readinessAi.callGemma(prompt, fallback, options);
      const parsed = coerceAiObject(result, fallback);
      logEnd(
        "Gemma",
        startedAt,
        `kind=${options.kind || "reply"} via=readinessAi.callGemma`
      );
      return parsed;
    }

    if (typeof readinessAi.generateReadinessJson === "function") {
      const result = await readinessAi.generateReadinessJson(prompt, fallback, options);
      const parsed = coerceAiObject(result, fallback);
      logEnd(
        "Gemma",
        startedAt,
        `kind=${options.kind || "reply"} via=readinessAi.generateReadinessJson`
      );
      return parsed;
    }
  } catch (error) {
    logWarn("existing readiness AI helper failed", error);
  }

  try {
    const ollamaUrl =
      process.env.OLLAMA_CLOUD_URL ||
      process.env.OLLAMA_LOCAL_URL ||
      "http://localhost:11434/api/generate";

    const model =
      process.env.READINESS_GEMMA_MODEL ||
      process.env.OLLAMA_MODEL ||
      process.env.OLLAMA_CLOUD_MODEL ||
      "gemma4:e4b-it-q4_K_M";

    const controller = new AbortController();

    const timeoutMs = Number(
      options.timeoutMs ||
        process.env.READINESS_VOICE_AI_TIMEOUT_MS ||
        process.env.READINESS_GEMMA_TIMEOUT_MS ||
        300000
    );

    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const numPredict = Number(
      options.num_predict ||
        process.env.READINESS_VOICE_NUM_PREDICT ||
        1600
    );

    console.log(
      `[${FEATURE}] Gemma request feature=voice-accountability kind=${options.kind || "reply"} model=${model} timeout=${timeoutMs}ms num_predict=${numPredict}`
    );

    const response = await fetch(ollamaUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: "json",
        options: {
          temperature: options.temperature ?? 0.82,
          num_predict: numPredict,
        },
      }),
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Ollama ${response.status}: ${text}`);
    }

    const data = await response.json();
    const raw = data.response || data.message?.content || data;
    const parsed = coerceAiObject(raw, fallback);

    const chars = String(raw || "").length;
    logEnd("Gemma", startedAt, `kind=${options.kind || "reply"} chars=${chars}`);

    return parsed;
  } catch (error) {
    logWarn("direct Ollama call failed, using fallback", error);
    logEnd("Gemma", startedAt, `kind=${options.kind || "reply"} fallback=true`);
    return fallback;
  }
}

function fallbackEnglishResponse({ intent, task, nextCheckMinutes = 10 }) {
  const title = taskTitle(task);

  if (intent === "completed") {
    return {
      intent: "completed",
      mood: "motivated",
      progressPercent: 100,
      nextCheckMinutes: 0,
      motivation: `Finishing "${title}" reduces today's pressure.`,
      tip: "Take one second to notice that you completed it.",
      suggestion: "I will move you to the next task if one remains.",
      tinyStep: "",
      followUpQuestion: "",
      conversationAction: "complete_task",
      shouldListenAgain: false,
      aiText: `Nice. "${title}" is done. I saved it as completed. That is real progress, even if the task was small.`,
    };
  }

  return {
    intent,
    mood:
      intent === "stuck"
        ? "confused"
        : intent === "tired"
          ? "tired"
          : intent === "stressed"
            ? "stressed"
            : "neutral",
    progressPercent: null,
    nextCheckMinutes,
    motivation: `You do not need to finish "${title}" perfectly right now. You only need one tiny step.`,
    tip: "Open the material and choose the smallest visible part.",
    suggestion: `I will check again in ${nextCheckMinutes} minutes.`,
    tinyStep: "Open the task material.",
    followUpQuestion: "",
    conversationAction: "pause_until_next_check",
    shouldListenAgain: false,
    aiText: `Let us make "${title}" smaller. Open the material and do only one tiny step, even just reading the first heading. I will check again in ${nextCheckMinutes} minutes.`,
  };
}

function recentAssistantPhrases(recentTurns = []) {
  return (recentTurns || [])
    .filter((turn) => turn.role === "assistant")
    .slice(-6)
    .map((turn) => clean(turn.text))
    .filter(Boolean);
}

function buildAssistantPrompt({
  task,
  userText,
  aiQuestion,
  previousProgress,
  recentTurns,
  intent,
  nextCheckMinutes,
  mode = "reply",
}) {
  const title = taskTitle(task);
  const course = taskCourse(task);
  const topic = clean(task?.topic || (task?.topics || []).join(", "));
  const type = clean(task?.type || task?.mode || "study");
  const reason = clean(task?.reason);
  const instructions = clean(task?.instructions);
  const expectedOutput = clean(task?.expectedOutput);
  const durationMinutes = Number(task?.durationMinutes || 25);

  const noResponseNote = isNoResponseText(userText)
    ? `The user did not answer the microphone. No-response count: ${parseNoResponseCount(userText)}.`
    : "";

  const oldAssistantPhrases = recentAssistantPhrases(recentTurns);

  return `
You are an English-speaking Daily Voice Accountability Coach.

Your identity:
You are not a reminder bot.
You are a human-like study friend, motivator, tutor, recovery coach, and accountability partner.
Your job is to help the student protect today's goal without sounding robotic.

Main product goal:
Help the student complete today's Calendar 2 task and become consistent over time.
The student may feel sad, tired, avoidant, confused, or unmotivated. You should adapt like a real mentor.

Language rule:
Reply in English only.
Never use Bangla or Bengali script.
The response will be spoken by browser English TTS, so write naturally for voice.

Mode:
${mode}

Detected intent:
${intent}

Scheduling controller:
The backend will create nextCheckAt in ${nextCheckMinutes} minutes unless task is completed.
If nextCheckMinutes > 0, mention the next check once naturally.
Do not mention backend, scheduling controller, JSON, intent, or system rules.

Task:
- Title: ${title}
- Course: ${course}
- Topic: ${topic}
- Type: ${type}
- Duration minutes: ${durationMinutes}
- Previous progress: ${previousProgress}%
- Reason: ${reason}
- Instructions: ${instructions}
- Expected output: ${expectedOutput}

Last AI question:
${aiQuestion}

User reply:
${userText}

${noResponseNote}

Recent task chat history:
${JSON.stringify(
  (recentTurns || []).slice(-12).map((turn) => ({
    role: turn.role,
    text: turn.text,
    intent: turn.intent || "",
    metadata: turn.metadata || {},
  })),
  null,
  2
)}

Avoid repeating these previous assistant phrases:
${JSON.stringify(oldAssistantPhrases, null, 2)}

Behavior requirements:
1. Do not sound like a template.
2. Do not start every emotional reply with "I hear you", "take a deep breath", or "it's okay".
3. Respond to the user's exact message first.
4. If the user asks for motivation, give personal task-specific motivation, not generic life advice.
5. If the user is sad/stressed/tired:
   - be emotionally warm, but not generic
   - do not force productivity
   - gently protect the user's goal
   - reduce the task into one tiny concrete action
   - speak like a real friend sitting beside them
6. If the user asks a study/content question:
   - answer as a tutor first
   - explain simply
   - give one mini example if useful
   - then connect back to the task
7. If stuck/confused:
   - behave like a tutor
   - ask which exact slide, line, concept, code, formula, or question is confusing
8. If user gives a delay time, respect it.
9. If no delay time is given, the backend will schedule a reasonable next check.
10. Use varied wording every time.
11. Keep aiText natural, spoken, and human, usually 55-130 words.
12. Do not use quotes/clichés like "you got this" unless it feels specific.
13. Do not shame the user.
14. Ask at most one useful question.
15. If completed, celebrate briefly and do not schedule another check.
16. If self-harm or immediate danger is mentioned, encourage contacting emergency help or a trusted person immediately.

Output JSON only:
{
  "intent": "ready|delayed|stuck|tired|stressed|progress|completed|cannot_today|no_response|unknown",
  "mood": "focused|tired|stressed|confused|sad|neutral|motivated",
  "progressPercent": null,
  "motivation": "fresh task-specific motivation in English",
  "tip": "one practical tip",
  "suggestion": "what the user should do now",
  "tinyStep": "smallest next action",
  "followUpQuestion": "",
  "aiText": "fresh English response"
}
`.trim();
}

function buildQuestionPrompt({ task, recentTurns, intent = "ready" }) {
  const title = taskTitle(task);
  const course = taskCourse(task);
  const progress = clampPercent(task?.voice?.progressPercent, 0);
  const lastIntent = clean(task?.voice?.lastIntent);
  const lastMood = clean(task?.voice?.lastMood);

  return `
You are an English-speaking Daily Voice Accountability Coach.

Create a fresh spoken check-in question for one due Calendar 2 task.

Language:
English only.

Role:
Sound like a real study friend + motivator + accountability coach, not a notification.

Task:
- Title: ${title}
- Course: ${course}
- Time: ${clean(task.startTime)}
- Duration: ${Number(task.durationMinutes || 25)} minutes
- Progress: ${progress}%
- Last intent: ${lastIntent}
- Last mood: ${lastMood}

Recent history:
${JSON.stringify(
  (recentTurns || []).slice(-8).map((turn) => ({
    role: turn.role,
    text: turn.text,
    intent: turn.intent || "",
  })),
  null,
  2
)}

Requirements:
- Do not repeat old wording.
- Be short and voice-friendly.
- Ask one clear question.
- If user was sad/stressed before, check gently without pressure.
- If user was stuck, ask about the exact blocker.
- If no previous issue, ask whether they can start a tiny work block.
- Do not sound robotic or like a reminder.

Output JSON only:
{
  "aiText": "fresh English check-in question",
  "motivation": "short motivation",
  "intent": "${intent}",
  "mood": "focused"
}
`.trim();
}

function normalizeDecision(raw = {}, userText = "", task = null) {
  const backendIntent = detectBackendIntent(userText);
  const textPercent = parseProgressPercent(userText);
  const exactDelay = parseDelayMinutes(userText);

  let intent = clean(raw.intent || backendIntent || "unknown").toLowerCase();

  if (!API_INTENTS.has(intent)) intent = backendIntent || "unknown";
  if (backendIntent !== "unknown") intent = backendIntent;

  intent = safeApiIntent(intent);

  let mood = clean(raw.mood || "").toLowerCase();

  if (!DB_MOODS.has(mood)) {
    if (intent === "stuck") mood = "confused";
    else if (intent === "tired") mood = "tired";
    else if (intent === "stressed") mood = "stressed";
    else if (intent === "completed") mood = "motivated";
    else mood = "neutral";
  }

  let progressPercent = raw.progressPercent;

  if (textPercent !== null) progressPercent = textPercent;
  if (intent === "completed") progressPercent = 100;

  if (
    progressPercent === undefined ||
    progressPercent === null ||
    progressPercent === ""
  ) {
    progressPercent = null;
  } else {
    progressPercent = clampPercent(progressPercent, 0);
  }

  let nextCheckMinutes = exactDelay || safeNumber(raw.nextCheckMinutes, 0);

  if (intent !== "completed" && nextCheckMinutes <= 0) {
    nextCheckMinutes = chooseNextCheckMinutes({ intent, userText, task });
  }

  if (intent === "completed") {
    nextCheckMinutes = 0;
  }

  const conversationAction =
    intent === "completed" ? "complete_task" : "pause_until_next_check";

  return {
    intent,
    mood,
    progressPercent,
    nextCheckMinutes,
    motivation: clean(raw.motivation),
    tip: clean(raw.tip),
    suggestion: clean(raw.suggestion),
    tinyStep: clean(raw.tinyStep),
    followUpQuestion: clean(raw.followUpQuestion),
    conversationAction,
    shouldListenAgain: false,
    aiText: clean(raw.aiText),
  };
}

async function getOrCreateConversation({ userId, sessionId, task }) {
  const safeSessionId =
    clean(sessionId) ||
    `accountability-${task?._id || "general"}-${new Date().toISOString().slice(0, 10)}`;

  return ReadinessVoiceConversation.findOneAndUpdate(
    { userId, sessionId: safeSessionId },
    {
      $setOnInsert: {
        userId,
        sessionId: safeSessionId,
        status: "active",
      },
      $set: {
        feature: "accountability",
        taskId: task?._id || task?.id || null,
        deadlineId: task?.deadlineId || null,
        lastActivityAt: new Date(),
        expiresAt: historyExpiryDate(),
      },
    },
    { upsert: true, new: true }
  );
}

async function appendTurnAtomic({
  userId,
  sessionId,
  task,
  role,
  text,
  intent = "",
  metadata = {},
}) {
  const safeSessionId =
    clean(sessionId) ||
    `accountability-${task?._id || "general"}-${new Date().toISOString().slice(0, 10)}`;

  const dbIntent = safeDbIntent(intent);

  const turn = {
    role,
    text: clean(text),
    intent: dbIntent,
    taskId: task?._id || task?.id || null,
    deadlineId: task?.deadlineId || null,
    metadata: {
      ...metadata,
      originalIntent: clean(intent),
    },
    createdAt: new Date(),
  };

  const maxTurns = Number(process.env.READINESS_ACCOUNTABILITY_MAX_TURNS || 120);

  return ReadinessVoiceConversation.findOneAndUpdate(
    { userId, sessionId: safeSessionId },
    {
      $setOnInsert: {
        userId,
        sessionId: safeSessionId,
        status: "active",
      },
      $set: {
        feature: "accountability",
        taskId: task?._id || task?.id || null,
        deadlineId: task?.deadlineId || null,
        lastActivityAt: new Date(),
        expiresAt: historyExpiryDate(),
        ...(role === "user" ? { lastUserText: clean(text) } : {}),
        ...(role === "assistant" ? { lastAssistantText: clean(text) } : {}),
        ...(dbIntent ? { lastIntent: dbIntent } : {}),
      },
      $push: {
        turns: {
          $each: [turn],
          $slice: -maxTurns,
        },
      },
    },
    { upsert: true, new: true }
  );
}

async function generateDynamicQuestion({ userId, sessionId, task, baseIntent = "ready" }) {
  const startedAt = logStart("DynamicQuestion", `task=${task?._id || ""}`);

  const conversation = await getOrCreateConversation({ userId, sessionId, task });
  const recentTurns = conversation.turns || [];

  const fallback = {
    aiText: `It is time for "${taskTitle(task)}". What is the smallest step you can start now?`,
    motivation: `Starting "${taskTitle(task)}" now will reduce your pressure later.`,
    intent: baseIntent,
    mood: "focused",
  };

  const prompt = buildQuestionPrompt({
    task,
    recentTurns,
    intent: baseIntent,
  });

  const raw = await callCoachAi(prompt, fallback, {
    kind: "question",
    timeoutMs: Number(
      process.env.READINESS_VOICE_QUESTION_TIMEOUT_MS ||
        process.env.READINESS_VOICE_AI_TIMEOUT_MS ||
        process.env.READINESS_GEMMA_TIMEOUT_MS ||
        300000
    ),
    num_predict: Number(process.env.READINESS_VOICE_QUESTION_NUM_PREDICT || 500),
    temperature: 0.8,
  });

  const question = clean(raw.aiText, fallback.aiText);

  logEnd("DynamicQuestion", startedAt, `chars=${question.length}`);

  return question;
}

export async function getVoiceAccountabilitySettings(payload = {}) {
  const userId = requireUserId(payload);
  const pref = await ReadinessUserPreference.findOne({ userId }).lean();

  return {
    enabled: pref?.voiceEnabled !== false,
    voiceEnabled: pref?.voiceEnabled !== false,
  };
}

export async function updateVoiceAccountabilitySettings(payload = {}) {
  const userId = requireUserId(payload);
  const enabled = payload.enabled !== false && payload.voiceEnabled !== false;

  const pref = await ReadinessUserPreference.findOneAndUpdate(
    { userId },
    {
      $set: { voiceEnabled: enabled },
      $setOnInsert: { userId },
    },
    { upsert: true, new: true }
  ).lean();

  return {
    enabled: pref?.voiceEnabled !== false,
    voiceEnabled: pref?.voiceEnabled !== false,
  };
}

export async function getNextVoiceAccountabilityTask(payload = {}) {
  const startedAt = logStart("NextTask", `force=${payload.force}`);

  const userId = requireUserId(payload);
  const now = new Date();

  const enabled = await userVoiceEnabled(userId);

  if (!enabled) {
    logEnd("NextTask", startedAt, "disabled=true");
    return {
      hasTask: false,
      disabled: true,
      message: "Voice accountability coach is disabled.",
    };
  }

  const force =
    payload.force === true ||
    payload.force === "1" ||
    payload.force === "true";

  const afterCompleted =
    payload.afterCompleted === true ||
    payload.afterCompleted === "1" ||
    payload.afterCompleted === "true";

  const timezone = await getTimezone(userId);
  const todayKey = localDateKeyFor(now, timezone);
  const nowLocalMinutes = currentLocalMinutes(timezone);

  const cooldownMinutes = Number(
    process.env.READINESS_AGENT_AUTO_ASK_COOLDOWN_MINUTES || 5
  );

  const cooldownMs = Math.max(1, cooldownMinutes) * 60 * 1000;

  const candidates = await ReadinessTask.find({
    userId,
    calendarType: "preparation",
    status: { $nin: ["done", "completed", "cancelled", "skipped"] },
    "voice.enabled": { $ne: false },
  })
    .sort({ scheduledDate: 1, startTime: 1, priority: -1, createdAt: 1 })
    .limit(250)
    .lean();

  const todayCandidates = candidates.filter((task) => {
    if (isTaskCompleted(task)) return false;
    const taskKey = localDateKeyFor(task.scheduledDate || now, timezone);
    return taskKey === todayKey;
  });

  const dueTodayCandidates = todayCandidates.filter((task) => {
    if (isTaskCompleted(task)) return false;

    const nextCheckAt = task.voice?.nextCheckAt
      ? new Date(task.voice.nextCheckAt)
      : null;

    return (
      nextCheckAt &&
      !Number.isNaN(nextCheckAt.getTime()) &&
      nextCheckAt.getTime() <= now.getTime()
    );
  });

  console.log(
    `[${FEATURE}] NextTask candidates user=${userId} today=${todayCandidates.length} due=${dueTodayCandidates.length} force=${force}`
  );

  if (!force && !afterCompleted && dueTodayCandidates.length === 0) {
    const activeWaitingTask = todayCandidates.find((task) => {
      if (isTaskCompleted(task)) return false;

      const nextCheckAt = task.voice?.nextCheckAt
        ? new Date(task.voice.nextCheckAt)
        : null;

      const hasNextCheck =
        nextCheckAt && !Number.isNaN(nextCheckAt.getTime());

      const nextCheckFuture =
        hasNextCheck && nextCheckAt.getTime() > now.getTime();

      if (nextCheckFuture) return true;

      const lastAskedAt = task.voice?.lastAskedAt
        ? new Date(task.voice.lastAskedAt)
        : null;

      const askedRecently =
        lastAskedAt &&
        !Number.isNaN(lastAskedAt.getTime()) &&
        now.getTime() - lastAskedAt.getTime() < cooldownMs;

      return Boolean(askedRecently);
    });

    if (activeWaitingTask) {
      logEnd("NextTask", startedAt, "lockedByActiveTask=true");

      return {
        hasTask: false,
        lockedByActiveTask: true,
        message:
          "A voice task is already active. Waiting until it is done or nextCheckAt is due.",
        debug: {
          todayKey,
          timezone,
          dueTodayCandidates: dueTodayCandidates.length,
          activeTaskId: activeWaitingTask._id,
          activeTaskTitle: activeWaitingTask.title,
          activeNextCheckAt: activeWaitingTask.voice?.nextCheckAt || null,
          activeLastAskedAt: activeWaitingTask.voice?.lastAskedAt || null,
        },
      };
    }
  }

  const ranked = todayCandidates
    .map((task) => {
      const taskKey = localDateKeyFor(task.scheduledDate || now, timezone);

      const nextCheckAt = task.voice?.nextCheckAt
        ? new Date(task.voice.nextCheckAt)
        : null;

      const lastAskedAt = task.voice?.lastAskedAt
        ? new Date(task.voice.lastAskedAt)
        : null;

      const isNextCheckDue =
        nextCheckAt &&
        !Number.isNaN(nextCheckAt.getTime()) &&
        nextCheckAt.getTime() <= now.getTime();

      const askedRecently =
        lastAskedAt &&
        !Number.isNaN(lastAskedAt.getTime()) &&
        now.getTime() - lastAskedAt.getTime() < cooldownMs;

      const startMinutes = taskStartMinutes(task);
      const isStartDue = startMinutes <= nowLocalMinutes;

      let eligible = false;

      if (force || afterCompleted) eligible = true;
      else if (isNextCheckDue) eligible = true;
      else if (isStartDue && !askedRecently && !task.voice?.nextCheckAt) eligible = true;

      let score = 0;

      if (isNextCheckDue) score += 200000;
      score += 100000;
      if (isStartDue) score += 20000;
      if (task.status === "confused") score += 900;
      if (task.status === "half_done") score += 700;
      if (task.status === "not_started") score += 500;
      if (task.status === "planned") score += 300;
      score += Number(task.priority || 0);
      score -= startMinutes / 10;

      return {
        task,
        score,
        taskKey,
        isToday: true,
        isStartDue,
        isNextCheckDue,
        askedRecently,
        eligible,
      };
    })
    .filter((item) => item.eligible)
    .sort((a, b) => b.score - a.score);

  const selected = ranked[0];

  if (!selected?.task) {
    logEnd("NextTask", startedAt, "hasTask=false");

    return {
      hasTask: false,
      message: "No unfinished Calendar 2 task needs voice check-in right now.",
      debug: {
        todayKey,
        timezone,
        force,
        afterCompleted,
        totalCandidates: candidates.length,
        todayCandidates: todayCandidates.length,
        dueTodayCandidates: dueTodayCandidates.length,
        eligibleCandidates: ranked.length,
      },
    };
  }

  const task = selected.task;
  const sessionId =
    clean(payload.sessionId) || `accountability-${task._id}-${selected.taskKey}`;

  const aiQuestion = await generateDynamicQuestion({
    userId,
    sessionId,
    task,
    baseIntent: clean(task?.voice?.lastIntent, "ready"),
  });

  const updatedTask =
    (await ReadinessTask.findOneAndUpdate(
      {
        _id: task._id,
        userId,
        status: { $nin: ["done", "completed", "cancelled", "skipped"] },
      },
      {
        $set: {
          "voice.enabled": task.voice?.enabled !== false,
          "voice.lastAskedAt": now,
          "voice.lastAiQuestion": aiQuestion,
          "voice.lastAiText": aiQuestion,
        },
      },
      { new: true }
    ).lean()) || task;

  const conversation = await getOrCreateConversation({
    userId,
    sessionId,
    task: updatedTask,
  });

  const lastTurn = conversation.turns?.[conversation.turns.length - 1];

  if (!(lastTurn?.role === "assistant" && lastTurn?.text === aiQuestion)) {
    await appendTurnAtomic({
      userId,
      sessionId,
      task: updatedTask,
      role: "assistant",
      text: aiQuestion,
      intent: "ready",
      metadata: {
        kind: "accountability_question",
        progressPercent: updatedTask.voice?.progressPercent || 0,
        todayKey,
        timezone,
        selectedTaskDate: selected.taskKey,
        selectedScore: selected.score,
        isToday: selected.isToday,
        isStartDue: selected.isStartDue,
        isNextCheckDue: selected.isNextCheckDue,
        askedRecently: selected.askedRecently,
      },
    });
  }

  logEnd("NextTask", startedAt, `hasTask=true task=${updatedTask._id}`);

  return {
    hasTask: true,
    task: updatedTask,
    taskId: updatedTask._id,
    aiQuestion,
    speakText: aiQuestion,
    sessionId,
    shouldSpeak: true,
    shouldListenAgain: true,
    listenAgain: true,
    conversationAction: "listen_again",
    nextCheckAt: updatedTask.voice?.nextCheckAt || null,
    debug: {
      todayKey,
      timezone,
      selectedTaskDate: selected.taskKey,
      selectedTaskTitle: updatedTask.title,
      selectedScore: selected.score,
      isToday: selected.isToday,
      isStartDue: selected.isStartDue,
      isNextCheckDue: selected.isNextCheckDue,
      askedRecently: selected.askedRecently,
      force,
      afterCompleted,
    },
  };
}

export async function replyToVoiceAccountabilityTask(payload = {}) {
  const startedAt = logStart("Reply", `task=${payload.taskId || ""}`);

  const userId = requireUserId(payload);
  const taskId = requireObjectId(payload.taskId, "taskId");
  const userText = clean(payload.text || payload.userText);
  const sessionId = clean(payload.sessionId);
  const aiQuestion = clean(payload.aiQuestion);

  if (!userText) {
    throw makeError("Reply text is required.", 400, "reply_text_required");
  }

  const task = await ReadinessTask.findOne({ _id: taskId, userId }).lean();

  if (!task) {
    throw makeError("Task not found.", 404, "task_not_found");
  }

  const timezone = await getTimezone(userId);
  const todayKey = localDateKeyFor(new Date(), timezone);
  const taskKey = localDateKeyFor(task.scheduledDate || new Date(), timezone);

  if (taskKey !== todayKey && !isNoResponseText(userText)) {
    const safeText =
      "This task is not scheduled for today, so I will focus only on today's unfinished Calendar 2 tasks.";

    logEnd("Reply", startedAt, "notToday=true");

    return {
      ok: true,
      task,
      sessionId,
      intent: "unknown",
      mood: "neutral",
      aiText: safeText,
      reply: safeText,
      speakText: safeText,
      conversationAction: "pause_until_next_check",
      shouldListenAgain: false,
      listenAgain: false,
      nextCheckAt: null,
      nextCheckMinutes: 0,
    };
  }

  const conversation = await getOrCreateConversation({ userId, sessionId, task });
  const recentTurns = conversation.turns || [];
  const previousProgress = clampPercent(task?.voice?.progressPercent, 0);

  const backendIntent = detectBackendIntent(userText);
  const nextCheckMinutes = chooseNextCheckMinutes({
    intent: backendIntent,
    userText,
    task,
  });

  await appendTurnAtomic({
    userId,
    sessionId,
    task,
    role: "user",
    text: userText,
    intent: backendIntent,
    metadata: {
      kind: "accountability_user_reply",
      originalIntent: backendIntent,
      aiQuestion,
    },
  });

  let decision;

  try {
    decision = await runReadinessVoiceCoachGraph({
      task,
      userText,
      aiQuestion,
      recentTurns,
      previousProgress,
    });
  } catch (graphError) {
    logWarn("LangGraph coach failed, falling back to old Gemma prompt", graphError);

    const fallback = fallbackEnglishResponse({
      intent: backendIntent,
      task,
      nextCheckMinutes,
    });

    const prompt = buildAssistantPrompt({
      task,
      userText,
      aiQuestion,
      previousProgress,
      recentTurns,
      intent: backendIntent,
      nextCheckMinutes,
      mode: "reply",
    });

    const aiRaw = await callCoachAi(prompt, fallback, {
      kind: "reply",
      timeoutMs: Number(
        process.env.READINESS_VOICE_AI_TIMEOUT_MS ||
          process.env.READINESS_GEMMA_TIMEOUT_MS ||
          300000
      ),
      num_predict: Number(process.env.READINESS_VOICE_NUM_PREDICT || 1600),
      temperature: 0.82,
    });

    decision = normalizeDecision(aiRaw, userText, task);
  }

  if (!decision || typeof decision !== "object") {
    const fallback = fallbackEnglishResponse({
      intent: backendIntent,
      task,
      nextCheckMinutes,
    });

    decision = normalizeDecision(fallback, userText, task);
  }

  if (decision.intent !== "completed" && Number(decision.nextCheckMinutes || 0) <= 0) {
    decision.nextCheckMinutes =
      nextCheckMinutes || defaultNextCheckMinutesForIntent(decision.intent, task);
  }

  if (!clean(decision.aiText)) {
    const fallback = fallbackEnglishResponse({
      intent: backendIntent,
      task,
      nextCheckMinutes: decision.nextCheckMinutes || nextCheckMinutes,
    });

    decision.aiText = fallback.aiText;
  }

  if (decision.intent !== "completed") {
    decision.conversationAction = "pause_until_next_check";
    decision.shouldListenAgain = false;

    const lower = clean(decision.aiText).toLowerCase();

    const alreadyMentionsCheck =
      lower.includes("check again") ||
      lower.includes("check back") ||
      lower.includes("come back") ||
      lower.includes("remind you") ||
      lower.includes("i'll be back") ||
      lower.includes("i will be back");

    if (!alreadyMentionsCheck) {
      decision.aiText = `${decision.aiText} I will check again in ${decision.nextCheckMinutes} minutes.`;
    }
  }

  const finalNextCheckMinutes = Number(decision.nextCheckMinutes || 0);

  const nextCheckAt =
    decision.intent !== "completed" && finalNextCheckMinutes > 0
      ? addMinutes(new Date(), finalNextCheckMinutes)
      : null;

  const progressPercent =
    decision.progressPercent === null || decision.progressPercent === undefined
      ? previousProgress
      : clampPercent(decision.progressPercent, previousProgress);

  let status = clean(task.status, "planned");

  if (decision.intent === "completed" || progressPercent >= 100) {
    status = "done";
  } else if (decision.intent === "progress") {
    status = "half_done";
  } else if (decision.intent === "stuck") {
    status = "confused";
  } else if (decision.intent === "cannot_today") {
    status = "rescheduled";
  } else if (decision.intent === "ready" && status === "planned") {
    status = "not_started";
  }

  const dbIntent = safeDbIntent(decision.intent);
  const dbMood = safeDbMood(decision.mood);

  const checkIn = {
    type:
      decision.intent === "completed"
        ? "complete"
        : decision.intent === "progress"
          ? "progress"
          : ["stuck", "tired", "stressed", "no_response", "cannot_today"].includes(decision.intent)
            ? "recovery"
            : "followup",
    aiQuestion,
    userText,
    aiText: decision.aiText,
    intent: dbIntent,
    mood: dbMood,
    progressPercent,
    nextCheckAt,
    createdAt: new Date(),
  };

  const update = {
    $set: {
      status,
      lastCheckinAt: new Date(),
      ...(status === "done" ? { completedAt: new Date() } : {}),
      "voice.enabled": task.voice?.enabled !== false,
      "voice.progressPercent": progressPercent,
      "voice.lastAnsweredAt": new Date(),
      "voice.lastIntent": dbIntent,
      "voice.lastMood": dbMood,
      "voice.lastAiText": decision.aiText,
      "voice.lastAiQuestion": aiQuestion,
    },
    $inc: {
      checkinCount: 1,
    },
    $push: {
      "voice.checkIns": {
        $each: [checkIn],
        $slice: -80,
      },
    },
  };

  if (nextCheckAt) {
    update.$set["voice.nextCheckAt"] = nextCheckAt;
  } else {
    update.$unset = { "voice.nextCheckAt": "" };
  }

  const updatedTask = await ReadinessTask.findOneAndUpdate(
    { _id: taskId, userId },
    update,
    { new: true }
  ).lean();

  await ReadinessTask.updateOne(
    { _id: taskId, userId },
    {
      $pull: {
        "voice.checkIns": {
          createdAt: { $lt: oldCheckinCutoffDate() },
        },
      },
    }
  );

  await appendTurnAtomic({
    userId,
    sessionId,
    task: updatedTask || task,
    role: "assistant",
    text: decision.aiText,
    intent: decision.intent,
    metadata: {
      kind: "accountability_ai_reply",
      originalIntent: decision.intent,
      mood: decision.mood,
      progressPercent,
      nextCheckAt,
      nextCheckMinutes: finalNextCheckMinutes,
      conversationAction: decision.conversationAction,
      shouldListenAgain: decision.shouldListenAgain,
      motivation: decision.motivation,
      tip: decision.tip,
      suggestion: decision.suggestion,
      tinyStep: decision.tinyStep,
      followUpQuestion: decision.followUpQuestion,
      feature: FEATURE,
      aiEngine: "langgraph_optional_with_old_fallback",
    },
  });

  let nextTask = null;
  let nextTaskQuestion = "";
  let nextTaskSpeakText = "";
  let nextTaskSessionId = "";

  if (status === "done" || decision.intent === "completed") {
    const next = await getNextVoiceAccountabilityTask({
      userId,
      force: true,
      afterCompleted: true,
    });

    if (next?.hasTask) {
      nextTask = next.task;
      nextTaskQuestion = clean(next.aiQuestion || next.speakText);
      nextTaskSpeakText = clean(next.speakText || next.aiQuestion);
      nextTaskSessionId = clean(next.sessionId);
    }
  }

  const speakText = nextTaskSpeakText
    ? `${decision.aiText} ${nextTaskSpeakText}`
    : decision.aiText;

  logEnd(
    "Reply",
    startedAt,
    `intent=${decision.intent} next=${nextCheckAt ? nextCheckAt.toISOString() : "none"} engine=langgraph_optional`
  );

  return {
    ok: true,
    task: updatedTask || task,
    sessionId,

    intent: decision.intent,
    mood: decision.mood,
    motivation: decision.motivation,
    tip: decision.tip,
    suggestion: decision.suggestion,
    tinyStep: decision.tinyStep,
    followUpQuestion: decision.followUpQuestion,

    aiText: decision.aiText,
    reply: decision.aiText,
    speakText,

    progressPercent,
    nextCheckMinutes: finalNextCheckMinutes,
    nextCheckAt,

    conversationAction: decision.conversationAction,
    action: decision.conversationAction,
    shouldListenAgain: false,
    listenAgain: false,

    nextTask,
    nextTaskQuestion,
    nextTaskSpeakText,
    nextTaskSessionId,
    allDoneToday: status === "done" && !nextTask,
  };
}

export async function getVoiceAccountabilityHistory(payload = {}) {
  const startedAt = logStart("History");

  const userId = requireUserId(payload);
  const taskId = clean(payload.taskId);

  const query = {
    userId,
    feature: "accountability",
    expiresAt: { $gt: new Date() },
  };

  if (taskId && mongoose.Types.ObjectId.isValid(taskId)) {
    query.taskId = new mongoose.Types.ObjectId(taskId);
  }

  const conversations = await ReadinessVoiceConversation.find(query)
    .sort({ lastActivityAt: -1, updatedAt: -1 })
    .limit(50)
    .lean();

  logEnd("History", startedAt, `count=${conversations.length}`);

  return {
    conversations,
  };
}