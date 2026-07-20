import PatternMemory, {
  makePatternGoalHash,
  makePatternKey,
} from "../models/PatternMemory.js";

function clean(value = "") {
  return String(value || "").trim();
}

function normalizeDomain(value = "") {
  return clean(value)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .trim();
}

function normalizeType(value = "") {
  const type = clean(value).toLowerCase().replace(/_/g, "-");
  if (type === "study") return "study";
  if (type === "partial") return "partial";
  if (type === "non-study" || type === "nonstudy") return "non-study";
  return "unknown";
}

function clamp(value, min = 0, max = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function clamp100(value, fallback = 50) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

export async function getPatternMemory({ deviceId, domain, goal }) {
  const cleanDeviceId = clean(deviceId);
  const cleanDomain = normalizeDomain(domain);
  const cleanGoal = clean(goal);

  if (!cleanDeviceId) {
    return { memoryScore: 0.5, memories: [] };
  }

  const goalHash = makePatternGoalHash(cleanGoal);
  const patternKey = makePatternKey({ domain: cleanDomain, pageType: "page" });

  const memories = await PatternMemory.find({
    deviceId: cleanDeviceId,
    $or: [
      { goalHash, patternKey },
      { patternKey },
      { domain: cleanDomain },
      { goal: cleanGoal },
    ],
  })
    .sort({ updatedAt: -1 })
    .limit(5)
    .lean();

  if (!memories.length) {
    return { memoryScore: 0.5, memories: [] };
  }

  const memoryScore =
    memories.reduce((sum, item) => sum + Number(item.confidence || 0.5), 0) /
    memories.length;

  return {
    memoryScore: clamp(memoryScore),
    memories,
  };
}

export async function updatePatternMemory({
  deviceId,
  userId = "",
  domain,
  goal,
  correctedType,
  isPositive,
  reason,
}) {
  const cleanDeviceId = clean(deviceId);
  const cleanUserId = clean(userId);
  const cleanDomain = normalizeDomain(domain);
  const cleanGoal = clean(goal);

  if (!cleanDeviceId || !cleanDomain) return null;

  const type = normalizeType(correctedType);
  const goalHash = makePatternGoalHash(cleanGoal);
  const patternKey = makePatternKey({ domain: cleanDomain, pageType: "page" });

  const inc = {
    totalCount: 1,
  };

  if (isPositive) inc.positiveCount = 1;
  else inc.negativeCount = 1;

  if (type === "study") inc.studyCount = 1;
  else if (type === "partial") inc.partialCount = 1;
  else if (type === "non-study") inc.nonStudyCount = 1;

  const confidence = isPositive ? 0.65 : 0.35;
  const memoryDelta = isPositive ? 8 : -8;

  const memory = await PatternMemory.findOneAndUpdate(
    {
      deviceId: cleanDeviceId,
      goalHash,
      patternKey,
    },
    {
      $inc: {
        ...inc,
        memoryScore: memoryDelta,
      },
      $set: {
        userId: cleanUserId,
        domain: cleanDomain,
        goal: cleanGoal,
        pageType: "page",
        learnedType: type,
        correctedType: type,
        confidence,
        lastReason: reason || "",
        lastFeedback: isPositive ? "correct" : "wrong",
        lastSeenAt: new Date(),
      },
      $setOnInsert: {
        deviceId: cleanDeviceId,
        goalHash,
        patternKey,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );

  if (memory) {
    const clamped = clamp100(memory.memoryScore, 50);
    if (clamped !== memory.memoryScore) {
      memory.memoryScore = clamped;
      await memory.save();
    }
  }

  return memory;
}

export async function learnFromActivity(activity, feedback = {}) {
  if (!activity) return null;

  const correctedType =
    feedback.correctedType ||
    activity?.ai?.type ||
    activity?.computed?.type ||
    "unknown";

  const isPositive =
    feedback.userFeedback === "yes" ||
    feedback.isPositive === true ||
    feedback.correct === true;

  return updatePatternMemory({
    deviceId: activity.deviceId,
    userId: activity.userId,
    domain: activity?.page?.domain,
    goal: activity.goal,
    correctedType,
    isPositive,
    reason: feedback.reason || activity?.ai?.reason || "",
  });
}

export default {
  getPatternMemory,
  updatePatternMemory,
  learnFromActivity,
};