import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { ChatOllama } from "@langchain/ollama";

/**
 * Readiness Voice Coach Graph
 * ------------------------------------------------------------
 * Additive AI brain for Readiness Voice Accountability.
 *
 * IMPORTANT:
 * This file does NOT replace your old working system.
 * It only produces a better AI decision:
 * friend + mother-like care + tutor + mentor + accountability coach.
 *
 * Your old service still handles:
 * - today's task filtering
 * - ReadinessTask DB updates
 * - status/progress save
 * - voice.checkIns save
 * - nextCheckAt save
 * - conversation history
 * - next task handoff
 * - WebSocket/SMS worker behavior
 *
 * URL safety:
 * Your existing .env uses:
 * OLLAMA_CLOUD_URL=http://host:11434/api/generate
 *
 * ChatOllama needs:
 * baseUrl=http://host:11434
 *
 * So this file safely converts the URL internally and does NOT require
 * changing OLLAMA_CLOUD_URL.
 */

const FEATURE = "ReadinessVoiceCoachGraph";

const INTENTS = new Set([
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

const MOODS = new Set([
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

function clean(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function clampPercent(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function clampMinutes(value, fallback = 20) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(240, Math.round(n)));
}

function safeIntent(value = "unknown") {
  const intent = clean(value, "unknown").toLowerCase();
  return INTENTS.has(intent) ? intent : "unknown";
}

function safeMood(value = "neutral") {
  const mood = clean(value, "neutral").toLowerCase();
  return MOODS.has(mood) ? mood : "neutral";
}

function taskTitle(task = {}) {
  return clean(task.title || task.topic || task.deadlineTitle || "this task");
}

function taskCourse(task = {}) {
  return clean(task.courseCode || task.courseTitle || "");
}

function taskLabel(task = {}) {
  const title = taskTitle(task);
  const course = taskCourse(task);
  return course ? `${course}: ${title}` : title;
}

function parseNoResponseCount(text = "") {
  const match = clean(text).match(/^__NO_RESPONSE__:(\d+)$/i);
  if (!match) return 0;
  return Math.max(1, Math.min(3, Number(match[1] || 1)));
}

function parseDelayMinutes(text = "") {
  const value = clean(text).toLowerCase();

  const numeric = value.match(/(\d{1,3})\s*(minute|min|minutes|mins|মিনিট)/i);
  if (numeric) return Math.max(1, Math.min(240, Number(numeric[1])));

  const hour = value.match(/(\d{1,2})\s*(hour|hours|hr|hrs|ঘন্টা|ঘণ্টা)/i);
  if (hour) return Math.max(1, Math.min(12, Number(hour[1]))) * 60;

  if (/\bfive minutes?\b/i.test(value)) return 5;
  if (/\bten minutes?\b/i.test(value)) return 10;
  if (/\bfifteen minutes?\b/i.test(value)) return 15;
  if (/\btwenty minutes?\b/i.test(value)) return 20;
  if (/\bthirty minutes?\b/i.test(value)) return 30;
  if (/\bone hour\b|\b1 hour\b/i.test(value)) return 60;

  return null;
}

function parseProgressPercent(text = "") {
  const match = clean(text).match(/(\d{1,3})\s*(%|percent|পারসেন্ট)/i);
  if (!match) return null;
  return clampPercent(match[1], 0);
}

function detectFastIntent(text = "") {
  const value = clean(text).toLowerCase();

  if (/^__NO_RESPONSE__:\d+$/i.test(value)) return "no_response";

  if (
    /\b(done|finished|finish|complete|completed|all done|i did it|submitted|submit done)\b|শেষ|করেছি|হয়ে গেছে|হয়ে গেছে|জমা দিয়েছি|সাবমিট/i.test(
      value
    )
  ) {
    return "completed";
  }

  const progress = parseProgressPercent(value);
  if (progress !== null) return progress >= 100 ? "completed" : "progress";

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
    /\b(ok stop|stop|cancel|enough|quit|end this|leave me|don't ask|do not ask|shut up|no more|do not disturb|don't disturb|cannot disturb)\b|থাম|বন্ধ|ডিস্টার্ব|বিরক্ত/i.test(
      value
    )
  ) {
    return "cannot_today";
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

function moodForIntent(intent) {
  if (intent === "stuck") return "confused";
  if (intent === "tired") return "tired";
  if (intent === "stressed") return "stressed";
  if (intent === "completed") return "motivated";
  if (intent === "ready" || intent === "progress") return "focused";
  return "neutral";
}

function defaultMinutes(intent, userText, task = {}) {
  const exact = parseDelayMinutes(userText);
  if (exact) return exact;

  if (intent === "completed") return 0;

  if (intent === "no_response") {
    const count = parseNoResponseCount(userText);
    if (count <= 1) return 5;
    if (count === 2) return 10;
    return 30;
  }

  if (intent === "stressed" || intent === "tired" || intent === "stuck") {
    return Math.max(
      5,
      Math.min(60, Number(process.env.READINESS_EMOTION_CHECK_MINUTES || 10))
    );
  }

  if (intent === "delayed") {
    return Math.max(
      10,
      Math.min(60, Number(process.env.READINESS_DELAYED_CHECK_MINUTES || 20))
    );
  }

  if (intent === "unknown") {
    return Math.max(
      10,
      Math.min(60, Number(process.env.READINESS_UNKNOWN_CHECK_MINUTES || 20))
    );
  }

  if (intent === "ready" || intent === "progress") {
    return Math.max(
      5,
      Math.min(
        90,
        Number(task?.durationMinutes || process.env.READINESS_READY_CHECK_MINUTES || 25)
      )
    );
  }

  if (intent === "cannot_today") {
    return Math.max(
      20,
      Math.min(120, Number(process.env.READINESS_CANNOT_TODAY_CHECK_MINUTES || 60))
    );
  }

  return 20;
}

function stripCodeFences(text = "") {
  return clean(text)
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function safeJsonParse(text, fallback = null) {
  const raw = clean(text);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return fallback;

    try {
      return JSON.parse(match[0]);
    } catch {
      return fallback;
    }
  }
}

function isWeakText(text = "") {
  const value = clean(text).toLowerCase();

  if (!value) return true;
  if (value.length < 70) return true;

  if (
    /^i\s*(will|'ll)\s+check\s+(again|back)\s+in\s+\d+\s+minutes\.?$/i.test(
      clean(text)
    )
  ) {
    return true;
  }

  if (/^(ok|okay|sure|alright)[,. ]+\s*i\s*(will|'ll)\s+check/i.test(clean(text))) {
    return true;
  }

  return false;
}

function buildFallbackCoachText({
  task,
  userText,
  intent,
  nextCheckMinutes,
}) {
  const label = taskLabel(task);
  const line =
    nextCheckMinutes > 0
      ? `I will check back in ${nextCheckMinutes} minutes.`
      : "";

  if (intent === "completed") {
    return `I’m proud of that. "${label}" is done, and that is real progress. Finishing one planned task today is exactly how consistency becomes your identity. Take a second to notice the win, then we can move to the next task if one is waiting.`;
  }

  if (intent === "stressed") {
    return `I’m really sorry today feels heavy. I’m not going to force you to feel okay first, but I also don’t want this task to quietly steal your confidence. For "${label}", do one tiny thing only: open the material and read the first heading. No full study session, no pressure. Just reopen the door. ${line}`;
  }

  if (intent === "tired") {
    return `You sound low on energy, so we will not fight the whole task. Let’s make "${label}" almost too small to refuse: open it, sit with it for five minutes, and read only the easiest visible part. If your brain wakes up, continue; if not, you still protected your routine. ${line}`;
  }

  if (intent === "stuck") {
    return `Good, then we switch into tutor mode. Don’t fight "${label}" alone. Point me to the exact slide, line, formula, code, or question that feels confusing, and I’ll break it down step by step. For now, keep the material open so the blocker is visible. ${line}`;
  }

  if (intent === "delayed" || intent === "cannot_today") {
    return `Okay, I’ll give you space, but I’m still protecting your goal with you. Before you step away, open "${label}" once or keep it visible. You don’t need to study now; just reduce the restart friction so starting later is easier. ${line}`;
  }

  if (intent === "progress") {
    return `That is movement, and movement matters. Even partial progress on "${label}" breaks the avoidance loop. Now choose the next smallest part: one heading, one example, or one short question. If it gets confusing, tell me the exact spot and I’ll tutor you through it. ${line}`;
  }

  if (intent === "ready") {
    return `Good. Let’s turn that readiness into action before your brain starts negotiating. For "${label}", start with the smallest visible step: open the material, read the first heading, and work for one short block. I’m here with you, but you need to begin now. ${line}`;
  }

  if (intent === "no_response") {
    return `I didn’t hear a reply, and that’s okay. I’m not leaving you alone with "${label}". When I come back, we only need one small answer: start, delay, or ask for help. For now, keep the material nearby if you can. ${line}`;
  }

  return `I’m here with you. Let’s keep "${label}" from becoming a scary big task. Open the material and do one tiny visible step: the title, first heading, or first example. If you feel stuck, tell me exactly where, and I’ll tutor you through it. ${line}`;
}

function getOllamaBaseUrl() {
  const rawBase =
    process.env.OLLAMA_LANGGRAPH_BASE_URL ||
    process.env.LANGGRAPH_OLLAMA_BASE_URL ||
    process.env.OLLAMA_BASE_URL ||
    process.env.OLLAMA_HOST ||
    process.env.OLLAMA_CLOUD_BASE_URL ||
    process.env.OLLAMA_LOCAL_BASE_URL ||
    process.env.OLLAMA_CLOUD_URL ||
    process.env.OLLAMA_LOCAL_URL ||
    "http://localhost:11434";

  return clean(rawBase)
    .replace(/\/api\/generate\/?$/i, "")
    .replace(/\/$/, "");
}

function makeModel() {
  const baseUrl = getOllamaBaseUrl();

  return new ChatOllama({
    baseUrl,
    model:
      process.env.READINESS_GEMMA_MODEL ||
      process.env.OLLAMA_MODEL ||
      process.env.OLLAMA_CLOUD_MODEL ||
      "gemma4:e4b-it-q4_K_M",
    temperature: Number(process.env.READINESS_VOICE_TEMPERATURE || 0.82),
    numPredict: Number(process.env.READINESS_VOICE_NUM_PREDICT || 2200),
  });
}

async function invokeModelJson(prompt) {
  const startedAt = logStart("invokeModelJson", `base=${getOllamaBaseUrl()}`);

  const model = makeModel();
  const response = await model.invoke(prompt);

  const content =
    typeof response?.content === "string"
      ? response.content
      : Array.isArray(response?.content)
        ? response.content.map((item) => item?.text || "").join("\n")
        : String(response?.content || response || "");

  const parsed = safeJsonParse(stripCodeFences(content), null);

  logEnd(
    "invokeModelJson",
    startedAt,
    `chars=${content.length} parsed=${parsed ? "true" : "false"}`
  );

  return parsed;
}

const CoachState = Annotation.Root({
  userText: Annotation({
    reducer: (_, v) => v,
    default: () => "",
  }),
  task: Annotation({
    reducer: (_, v) => v,
    default: () => ({}),
  }),
  recentTurns: Annotation({
    reducer: (_, v) => v,
    default: () => [],
  }),
  aiQuestion: Annotation({
    reducer: (_, v) => v,
    default: () => "",
  }),
  previousProgress: Annotation({
    reducer: (_, v) => v,
    default: () => 0,
  }),
  intent: Annotation({
    reducer: (_, v) => v,
    default: () => "unknown",
  }),
  mood: Annotation({
    reducer: (_, v) => v,
    default: () => "neutral",
  }),
  nextCheckMinutes: Annotation({
    reducer: (_, v) => v,
    default: () => 20,
  }),
  needsTutor: Annotation({
    reducer: (_, v) => v,
    default: () => false,
  }),
  decision: Annotation({
    reducer: (_, v) => v,
    default: () => null,
  }),
});

async function classifyNode(state) {
  const startedAt = logStart("classifyNode");

  const intent = detectFastIntent(state.userText);
  const mood = moodForIntent(intent);
  const nextCheckMinutes = defaultMinutes(intent, state.userText, state.task);
  const needsTutor =
    intent === "stuck" ||
    /\b(explain|what is|how to|why|teach me|example|formula|code|line|slide)\b/i.test(
      clean(state.userText)
    );

  logEnd(
    "classifyNode",
    startedAt,
    `intent=${intent} mood=${mood} next=${nextCheckMinutes} tutor=${needsTutor}`
  );

  return {
    intent,
    mood,
    nextCheckMinutes,
    needsTutor,
  };
}

async function composeNode(state) {
  const startedAt = logStart(
    "composeNode",
    `intent=${state.intent} next=${state.nextCheckMinutes}`
  );

  const label = taskLabel(state.task);
  const title = taskTitle(state.task);
  const course = taskCourse(state.task);
  const topic = clean(state.task?.topic || (state.task?.topics || []).join(", "));
  const duration = Number(state.task?.durationMinutes || 25);

  const recent = JSON.stringify(
    (state.recentTurns || []).slice(-10).map((turn) => ({
      role: turn.role,
      text: turn.text,
      intent: turn.intent || "",
      metadata: turn.metadata || {},
    })),
    null,
    2
  );

  const prompt = `
You are an English-speaking Daily Voice Coach.

You are:
- caring like a close friend
- emotionally warm like a mother figure
- practical like a mentor
- explanatory like a tutor
- firm like an accountability coach

You are NOT a reminder bot.
You are NOT a therapy bot.
You are NOT just a scheduler.

Mission:
Help the student complete today's Calendar 2 task consistently.
Comfort first, then action. Never comfort only.
Push gently, not harshly.

Current task:
- Label: ${label}
- Title: ${title}
- Course: ${course}
- Topic: ${topic}
- Duration: ${duration} minutes
- Previous progress: ${state.previousProgress}%

User said:
${state.userText}

Detected intent:
${state.intent}

Detected mood:
${state.mood}

Next check:
${state.nextCheckMinutes} minutes

Previous AI question:
${state.aiQuestion}

Recent task chat:
${recent}

Rules:
1. Reply to the user's exact message first.
2. Every reply must include emotional support.
3. Every reply must include task-specific motivation.
4. Every reply must include one tiny concrete action for this exact task.
5. Every reply must offer tutor/mentor help.
6. Every reply must include a gentle accountability push.
7. If nextCheckMinutes > 0, mention the next check time once.
8. If user is sad/tired/stressed, comfort first, then tiny action.
9. If user is stuck or asks a question, tutor first, then tiny action.
10. If user says delay/not now, respect it but give one tiny pre-break action.
11. Never answer only with scheduling.
12. English only.
13. Keep aiText spoken and human, 80-150 words.
14. Do not mention JSON, backend, rules, graph, LangChain, prompt, model, or system.
15. Do not repeat old phrases.
16. Do not overuse "I hear you" or "take a deep breath".
17. If the user asks a general question unrelated to task, answer briefly, then reconnect to task.

Return ONLY valid JSON:
{
  "intent": "${state.intent}",
  "mood": "${state.mood}",
  "progressPercent": null,
  "nextCheckMinutes": ${state.nextCheckMinutes},
  "motivation": "task-specific motivation",
  "tutorHelp": "how you can help as tutor/mentor",
  "tinyStep": "one tiny action",
  "accountabilityPush": "gentle push",
  "aiText": "final spoken human reply"
}
`.trim();

  try {
    const raw = await invokeModelJson(prompt);

    const intent = safeIntent(raw?.intent || state.intent);
    const mood = safeMood(raw?.mood || state.mood);
    const nextCheckMinutes =
      intent === "completed"
        ? 0
        : clampMinutes(raw?.nextCheckMinutes, state.nextCheckMinutes);

    let aiText = clean(raw?.aiText);

    if (isWeakText(aiText)) {
      aiText = buildFallbackCoachText({
        task: state.task,
        userText: state.userText,
        intent,
        nextCheckMinutes,
      });
    }

    const progressPercent =
      intent === "completed"
        ? 100
        : raw?.progressPercent === null || raw?.progressPercent === undefined
          ? null
          : clampPercent(raw.progressPercent, state.previousProgress);

    const decision = {
      intent,
      mood,
      progressPercent,
      nextCheckMinutes,
      motivation: clean(raw?.motivation),
      tip: clean(raw?.tutorHelp),
      suggestion: clean(raw?.accountabilityPush),
      tinyStep: clean(raw?.tinyStep),
      followUpQuestion: "",
      conversationAction:
        intent === "completed" ? "complete_task" : "pause_until_next_check",
      shouldListenAgain: false,
      aiText,
    };

    logEnd(
      "composeNode",
      startedAt,
      `intent=${decision.intent} next=${decision.nextCheckMinutes} chars=${decision.aiText.length}`
    );

    return { decision };
  } catch (error) {
    logWarn("composeNode model failed", error);

    const intent = safeIntent(state.intent);
    const nextCheckMinutes =
      intent === "completed" ? 0 : clampMinutes(state.nextCheckMinutes, 20);

    const aiText = buildFallbackCoachText({
      task: state.task,
      userText: state.userText,
      intent,
      nextCheckMinutes,
    });

    const decision = {
      intent,
      mood: safeMood(state.mood),
      progressPercent: intent === "completed" ? 100 : null,
      nextCheckMinutes,
      motivation: "Tiny action keeps consistency alive.",
      tip: "Tell me the exact part that feels confusing and I will break it down.",
      suggestion: "Comfort first, then one tiny action.",
      tinyStep: "Open the material and read the first heading.",
      followUpQuestion: "",
      conversationAction:
        intent === "completed" ? "complete_task" : "pause_until_next_check",
      shouldListenAgain: false,
      aiText,
    };

    logEnd("composeNode", startedAt, "fallback=true");

    return { decision };
  }
}

const coachGraph = new StateGraph(CoachState)
  .addNode("classify", classifyNode)
  .addNode("compose", composeNode)
  .addEdge(START, "classify")
  .addEdge("classify", "compose")
  .addEdge("compose", END)
  .compile();

export async function runReadinessVoiceCoachGraph({
  task,
  userText,
  aiQuestion = "",
  recentTurns = [],
  previousProgress = 0,
}) {
  const startedAt = logStart("runReadinessVoiceCoachGraph");

  try {
    const result = await coachGraph.invoke({
      task: task || {},
      userText: clean(userText),
      aiQuestion: clean(aiQuestion),
      recentTurns: Array.isArray(recentTurns) ? recentTurns : [],
      previousProgress: clampPercent(previousProgress, 0),
    });

    const baseIntent = detectFastIntent(userText);
    const decision = result?.decision || {};

    const intent = safeIntent(decision.intent || baseIntent);
    const nextCheckMinutes =
      intent === "completed"
        ? 0
        : clampMinutes(
            decision.nextCheckMinutes,
            defaultMinutes(intent, userText, task)
          );

    let aiText = clean(decision.aiText);

    if (isWeakText(aiText)) {
      aiText = buildFallbackCoachText({
        task,
        userText,
        intent,
        nextCheckMinutes,
      });
    }

    const finalDecision = {
      intent,
      mood: safeMood(decision.mood || moodForIntent(intent)),
      progressPercent:
        intent === "completed"
          ? 100
          : typeof decision.progressPercent === "number"
            ? clampPercent(decision.progressPercent, previousProgress)
            : null,
      nextCheckMinutes,
      motivation: clean(decision.motivation),
      tip: clean(decision.tip),
      suggestion: clean(decision.suggestion),
      tinyStep: clean(decision.tinyStep),
      followUpQuestion: clean(decision.followUpQuestion),
      conversationAction:
        intent === "completed" ? "complete_task" : "pause_until_next_check",
      shouldListenAgain: false,
      aiText,
    };

    logEnd(
      "runReadinessVoiceCoachGraph",
      startedAt,
      `intent=${finalDecision.intent} next=${finalDecision.nextCheckMinutes} chars=${finalDecision.aiText.length}`
    );

    return finalDecision;
  } catch (error) {
    logWarn("runReadinessVoiceCoachGraph failed", error);

    const intent = detectFastIntent(userText);
    const nextCheckMinutes = defaultMinutes(intent, userText, task);
    const aiText = buildFallbackCoachText({
      task,
      userText,
      intent,
      nextCheckMinutes,
    });

    logEnd("runReadinessVoiceCoachGraph", startedAt, "fallback=true");

    return {
      intent,
      mood: moodForIntent(intent),
      progressPercent: intent === "completed" ? 100 : null,
      nextCheckMinutes: intent === "completed" ? 0 : nextCheckMinutes,
      motivation: "Tiny action keeps consistency alive.",
      tip: "Tell me the exact part that feels confusing and I will break it down.",
      suggestion: "Comfort first, then one tiny action.",
      tinyStep: "Open the material and read the first heading.",
      followUpQuestion: "",
      conversationAction:
        intent === "completed" ? "complete_task" : "pause_until_next_check",
      shouldListenAgain: false,
      aiText,
    };
  }
}

export default {
  runReadinessVoiceCoachGraph,
};