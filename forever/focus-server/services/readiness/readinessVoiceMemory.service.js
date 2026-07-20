import ReadinessVoiceMemory from "../../models/ReadinessVoiceMemory.js";
import ReadinessCheckin from "../../models/ReadinessCheckin.js";
import ReadinessTask from "../../models/ReadinessTask.js";
import ReadinessDeadline from "../../models/ReadinessDeadline.js";
import { callReadinessGemma } from "./readinessAi.service.js";
import { clean, dateOnly, addDays } from "./readinessDate.util.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function detectEmotion(text = "", intent = "") {
  const value = clean(text).toLowerCase();
  const evidence = [];

  const has = (regex, label) => {
    const ok = regex.test(value);
    if (ok) evidence.push(label);
    return ok;
  };

  if (
    has(/stress|pressure|চাপ|ভয়|ভয়|panic|anxious|anxiety|tension|কষ্ট/i, "stress words") ||
    intent === "ask_motivation"
  ) {
    return { current: "stressed", confidence: 0.78, evidence };
  }

  if (has(/overwhelmed|too much|সব একসাথে|পারছি না|cannot handle|ভেঙে/i, "overwhelm words")) {
    return { current: "overwhelmed", confidence: 0.82, evidence };
  }

  if (has(/confused|stuck|বুঝি না|বুঝতে পারছি না|কঠিন|help/i, "confusion words") || intent === "checkin_confused") {
    return { current: "confused", confidence: 0.8, evidence };
  }

  if (has(/tired|ঘুম|ক্লান্ত|exhausted|low energy/i, "tired words")) {
    return { current: "tired", confidence: 0.72, evidence };
  }

  if (has(/skip|later|কাল|avoid|no time|করিনি|not started/i, "avoidance words") || intent === "checkin_not_started") {
    return { current: "avoidant", confidence: 0.68, evidence };
  }

  if (has(/done|finished|complete|করেছি|শেষ|ভালো লাগছে/i, "progress words") || intent === "checkin_done") {
    return { current: "motivated", confidence: 0.62, evidence };
  }

  return { current: "neutral", confidence: 0.35, evidence };
}

function deriveTone({ emotion, recentBadCount, preferenceTone = "balanced" }) {
  if (emotion.current === "overwhelmed" || emotion.current === "stressed") {
    return {
      current: "reassuring",
      reason: "Student sounds stressed/overwhelmed, so reduce pressure and give one tiny step.",
    };
  }

  if (emotion.current === "confused") {
    return {
      current: "gentle",
      reason: "Student is confused, so explain slowly with examples and no guilt.",
    };
  }

  if (recentBadCount >= 4) {
    return {
      current: "direct",
      reason: "Repeated skip/not-started pattern needs direct but still supportive accountability.",
    };
  }

  if (emotion.current === "avoidant" || recentBadCount >= 2) {
    return {
      current: preferenceTone === "strict" ? "strict" : "direct",
      reason: "Avoidance pattern detected; coach should give a clear smallest action.",
    };
  }

  if (preferenceTone === "gentle") return { current: "gentle", reason: "User prefers gentle coaching." };
  if (preferenceTone === "strict") return { current: "direct", reason: "User prefers stricter coaching." };

  return { current: "balanced", reason: "No high emotional risk; balanced coaching is appropriate." };
}

function detectPotentialTopic(text = "", task = null, deadline = null) {
  const topicFromTask = clean(task?.topic || task?.topics?.[0] || "");
  if (topicFromTask) return topicFromTask;

  const topicFromDeadline = clean(deadline?.weakTopics?.[0] || deadline?.topics?.[0] || "");
  if (topicFromDeadline) return topicFromDeadline;

  const value = clean(text);
  const patterns = [
    /(?:stuck on|confused about|help with|বুঝি না|কঠিন)\s+([^,.!?]{2,60})/i,
    /(?:topic|chapter|concept)\s*[:=-]?\s*([^,.!?]{2,60})/i,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return clean(match[1]).slice(0, 80);
  }

  return "";
}

function calcRiskLevel({ repeatedSkips, repeatedNotStarted, repeatedConfusion, repeatedStress }) {
  const score = repeatedSkips * 2 + repeatedNotStarted * 2 + repeatedConfusion * 1.5 + repeatedStress;
  if (score >= 14) return "critical";
  if (score >= 8) return "high";
  if (score >= 4) return "medium";
  return "low";
}

async function buildRecentCheckinStats(userId) {
  const since = addDays(dateOnly(new Date()), -7);
  const checkins = await ReadinessCheckin.find({ userId, createdAt: { $gte: since } })
    .sort({ createdAt: -1 })
    .limit(40);

  const badAnswers = new Set(["skip", "not_started", "confused"]);
  const recentBadCount = checkins.filter((item) => badAnswers.has(item.answer)).length;

  return {
    checkins,
    recentBadCount,
    repeatedSkips: checkins.filter((item) => item.answer === "skip").length,
    repeatedNotStarted: checkins.filter((item) => item.answer === "not_started").length,
    repeatedConfusion: checkins.filter((item) => item.answer === "confused").length,
    repeatedStress: checkins.filter((item) => item.blockedReason === "stressed").length,
  };
}

export async function getOrCreateVoiceMemory(userId) {
  return ReadinessVoiceMemory.findOneAndUpdate(
    { userId },
    {
      $setOnInsert: {
        userId,
        longSummary: "",
        lastActivityAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );
}

export async function updateVoiceMemoryAfterTurn({
  userId,
  sessionId,
  text,
  intent,
  task = null,
  deadline = null,
  assistantText = "",
  checkin = null,
  preference = null,
}) {
  const memory = await getOrCreateVoiceMemory(userId);
  const stats = await buildRecentCheckinStats(userId);
  const emotion = detectEmotion(text, intent);
  const tone = deriveTone({
    emotion,
    recentBadCount: stats.recentBadCount,
    preferenceTone: preference?.coaching?.tone || "balanced",
  });

  const topic = detectPotentialTopic(text, task, deadline);
  const courseCode = clean(task?.courseCode || deadline?.courseCode || "");

  memory.emotionalState.current = emotion.current;
  memory.emotionalState.confidence = clamp(emotion.confidence, 0, 1);
  memory.emotionalState.lastDetectedAt = new Date();
  memory.emotionalState.evidence = emotion.evidence.slice(0, 8);

  const previousRisk = memory.struggleProfile.streakRiskLevel;
  memory.struggleProfile.repeatedSkips = stats.repeatedSkips;
  memory.struggleProfile.repeatedNotStarted = stats.repeatedNotStarted;
  memory.struggleProfile.repeatedConfusion = stats.repeatedConfusion;
  memory.struggleProfile.repeatedStress = stats.repeatedStress;
  memory.struggleProfile.streakRiskLevel = calcRiskLevel(memory.struggleProfile);

  if (["checkin_not_started", "checkin_confused"].includes(intent) || emotion.current !== "neutral") {
    memory.struggleProfile.lastStruggleAt = new Date();
  }

  memory.adaptiveTone.current = tone.current;
  memory.adaptiveTone.reason = tone.reason;
  if (memory.adaptiveTone.current !== tone.current || previousRisk !== memory.struggleProfile.streakRiskLevel) {
    memory.adaptiveTone.lastChangedAt = new Date();
  }

  if (topic && (intent === "checkin_confused" || emotion.current === "confused")) {
    const idx = memory.weakTopics.findIndex(
      (item) => clean(item.topic).toLowerCase() === topic.toLowerCase() && clean(item.courseCode) === courseCode
    );

    if (idx >= 0) {
      memory.weakTopics[idx].count += 1;
      memory.weakTopics[idx].lastMentionedAt = new Date();
      memory.weakTopics[idx].evidence = [text.slice(0, 180), ...(memory.weakTopics[idx].evidence || [])].slice(0, 5);
    } else {
      memory.weakTopics.push({
        topic,
        courseCode,
        count: 1,
        lastMentionedAt: new Date(),
        evidence: [text.slice(0, 180)],
      });
    }

    memory.weakTopics = memory.weakTopics
      .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
      .slice(0, 20);
  }

  memory.counters.totalVoiceTurns += 1;
  if (checkin) memory.counters.totalCheckinsFromVoice += 1;
  if (["medium", "high", "critical"].includes(memory.struggleProfile.streakRiskLevel)) {
    memory.counters.totalRecoveryMoments += 1;
  }

  memory.lastUserNeed = text.slice(0, 500);
  memory.lastCoachPromise = clean(assistantText).slice(0, 500);
  memory.lastSessionId = sessionId;
  memory.lastActivityAt = new Date();

  const compactContext = {
    previousSummary: memory.longSummary,
    latestUserText: text,
    latestAssistantText: assistantText,
    intent,
    emotion: memory.emotionalState,
    adaptiveTone: memory.adaptiveTone,
    struggleProfile: memory.struggleProfile,
    weakTopics: memory.weakTopics.slice(0, 6),
    task: task
      ? {
          title: task.title,
          topic: task.topic,
          status: task.status,
          courseCode: task.courseCode,
        }
      : null,
    deadline: deadline
      ? {
          title: deadline.title,
          courseCode: deadline.courseCode,
          riskLevel: deadline.riskLevel,
          readinessScore: deadline.readinessScore,
        }
      : null,
  };

  const summary = await callReadinessGemma(
    `Return JSON only:
{"longSummary":"3-5 sentence durable memory summary for future coaching. Mention repeated struggles, emotional pattern, weak topics, and what tone works. No sensitive diagnosis."}

Context:
${JSON.stringify(compactContext)}`,
    {
      longSummary:
        memory.longSummary ||
        `Student currently seems ${memory.emotionalState.current}. Tone should be ${memory.adaptiveTone.current}. Weak topics: ${
          memory.weakTopics
            .slice(0, 3)
            .map((item) => item.topic)
            .join(", ") || "none yet"
        }.`,
    },
    {
      system: "You compress study-coaching memory safely. No medical labels. Keep it practical and short.",
      temperature: 0.15,
    }
  );

  memory.longSummary = clean(summary.longSummary, memory.longSummary).slice(0, 2200);

  await memory.save();

  return memory;
}

export async function buildVoiceMemoryContext(userId) {
  const memory = await getOrCreateVoiceMemory(userId);

  const todayTask = await ReadinessTask.findOne({
    userId,
    status: "planned",
    scheduledDate: { $gte: dateOnly(new Date()), $lte: addDays(dateOnly(new Date()), 1) },
  }).sort({ priority: -1, startTime: 1 });

  const urgentDeadline = await ReadinessDeadline.findOne({
    userId,
    status: "active",
    dueDate: { $gte: new Date() },
  }).sort({ dueDate: 1, readinessScore: 1 });

  return {
    memory,
    compact: {
      longSummary: memory.longSummary,
      emotionalState: memory.emotionalState,
      adaptiveTone: memory.adaptiveTone,
      struggleProfile: memory.struggleProfile,
      weakTopics: memory.weakTopics.slice(0, 8),
      lastUserNeed: memory.lastUserNeed,
      lastCoachPromise: memory.lastCoachPromise,
      todayTask: todayTask
        ? {
            id: todayTask._id,
            title: todayTask.title,
            topic: todayTask.topic,
            durationMinutes: todayTask.durationMinutes,
            status: todayTask.status,
          }
        : null,
      urgentDeadline: urgentDeadline
        ? {
            id: urgentDeadline._id,
            title: urgentDeadline.title,
            courseCode: urgentDeadline.courseCode,
            dueDate: urgentDeadline.dueDate,
            readinessScore: urgentDeadline.readinessScore,
            riskLevel: urgentDeadline.riskLevel,
          }
        : null,
    },
  };
}