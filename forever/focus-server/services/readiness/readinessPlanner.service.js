import ReadinessDeadline from "../../models/ReadinessDeadline.js";
import ReadinessTask from "../../models/ReadinessTask.js";
import ReadinessUserPreference from "../../models/ReadinessUserPreference.js";

import { callReadinessGemma } from "./readinessAi.service.js";

import {
  addDays,
  clamp,
  clean,
  dateOnly,
  daysBetween,
  makeError,
  normalizeStartTime,
  requireObjectId,
  requireUserId,
  ymd,
} from "./readinessDate.util.js";

import {
  addDaysByTimezone,
  endOfDayInTimezone,
  normalizeTimezone,
  startOfDayInTimezone,
} from "./readinessTimezone.util.js";

import { recalculateDeadlineReadiness } from "./readinessScore.service.js";
import { smoothHeavyWeeks } from "./readinessHeavyWeek.service.js";

const DEFAULT_TIME_SLOTS = ["09:00", "12:00", "15:00", "18:00", "20:00"];

const ACTIVE_DEADLINE_STATUSES = ["active", "pending", "in_progress"];

const OPEN_TASK_STATUSES = [
  "planned",
  "not_started",
  "half_done",
  "confused",
  "skipped",
  "rescheduled",
];

const VALID_TASK_TYPES = [
  "prep",
  "practice",
  "review",
  "outline",
  "implementation",
  "test",
  "submit",
  "mock",
  "recovery",
  "carry_over",
  "buffer",
  "quiz_day",
  "exam_day",
  "other",
];

const VALID_MODES = ["minimum", "normal", "strong"];

const STATIC_WORDS = [
  "sample",
  "demo",
  "static",
  "dummy",
  "placeholder",
  "test deadline",
  "untitled deadline",
];

const DAY_ALIASES = {
  sun: "sunday",
  sunday: "sunday",
  mon: "monday",
  monday: "monday",
  tue: "tuesday",
  tues: "tuesday",
  tuesday: "tuesday",
  wed: "wednesday",
  wednesday: "wednesday",
  thu: "thursday",
  thur: "thursday",
  thurs: "thursday",
  thursday: "thursday",
  fri: "friday",
  friday: "friday",
  sat: "saturday",
  saturday: "saturday",
};

function normalizeSlots(value = []) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  const set = new Set();

  for (const item of raw) {
    const slot = normalizeStartTime(item, "");
    if (slot) set.add(slot);
  }

  return [...set].sort();
}

function normalizeAvoidDays(value = []) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  const set = new Set();

  for (const item of raw) {
    const key = String(item || "").trim().toLowerCase();
    const day = DAY_ALIASES[key];
    if (day) set.add(day);
  }

  return [...set];
}

function dayName(date) {
  const d = dateOnly(date);

  if (!d) return "";

  return [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ][d.getDay()];
}

function isAvoidedDate(date, avoidDays = []) {
  if (!avoidDays.length) return false;
  return avoidDays.includes(dayName(date));
}

function isStaticLikeDeadline(deadline = {}) {
  const title = String(deadline.title || "").trim().toLowerCase();
  const source = String(deadline.source || "").trim().toLowerCase();

  if (!title) return true;

  if (STATIC_WORDS.some((word) => title === word || title.includes(word))) {
    return true;
  }

  return ["sample", "demo", "static", "dummy", "seed"].includes(source);
}

function taskVerb(type) {
  return (
    {
      outline: "Outline",
      implementation: "Work on",
      test: "Check",
      submit: "Submit",
      prep: "Revise",
      practice: "Practice",
      review: "Review",
      mock: "Mock test",
      buffer: "Buffer review",
      recovery: "Recovery",
      carry_over: "Finish",
      quiz_day: "Quiz day",
      exam_day: "Exam day",
      other: "Study",
    }[type] || "Study"
  );
}

function deadlineVerb(type) {
  return (
    {
      assignment: "Work on",
      project: "Build",
      lab: "Practice",
      quiz: "Revise",
      exam: "Prepare",
      presentation: "Prepare",
      reading: "Read",
      other: "Study",
    }[type] || "Study"
  );
}

function topicAt(deadline, index = 0) {
  const topics =
    Array.isArray(deadline.topics) && deadline.topics.length
      ? deadline.topics
      : [deadline.title];

  return topics[index % topics.length] || deadline.title;
}

function normalizeTaskType(value) {
  const type = String(value || "prep").trim().toLowerCase();
  return VALID_TASK_TYPES.includes(type) ? type : "prep";
}

function normalizeMode(value) {
  const mode = String(value || "normal").trim().toLowerCase();
  return VALID_MODES.includes(mode) ? mode : "normal";
}

function isQuizOrExam(deadline = {}) {
  const type = String(deadline.type || "").toLowerCase();
  return ["quiz", "exam"].includes(type);
}

function latestAllowedStudyDate(deadline, today) {
  const due = dateOnly(deadline.dueDate);

  if (!due) return today;

  if (!isQuizOrExam(deadline)) {
    return due;
  }

  const beforeDue = addDays(due, -1);

  if (beforeDue && beforeDue >= today) {
    return beforeDue;
  }

  return due;
}

function finalReviewDate(deadline, today) {
  const due = dateOnly(deadline.dueDate);

  if (!due) return today;

  if (!isQuizOrExam(deadline)) {
    return due;
  }

  const beforeDue = addDays(due, -1);

  if (beforeDue && beforeDue >= today) {
    return beforeDue;
  }

  return due;
}

async function getUserTimezone(userId, requestedTimezone) {
  if (requestedTimezone) return normalizeTimezone(requestedTimezone);

  const preference = await ReadinessUserPreference.findOne({ userId })
    .select("timezone country")
    .lean();

  return normalizeTimezone(
    preference?.timezone || preference?.country || "Asia/Dhaka"
  );
}

function aiDeadline(deadline) {
  return {
    id: String(deadline._id),
    title: deadline.title,
    type: deadline.type,
    courseCode: deadline.courseCode || "",
    courseTitle: deadline.courseTitle || "",
    dueDate: ymd(deadline.dueDate),
    dueTime: deadline.dueTime || "23:59",
    timezone: deadline.timezone || "Asia/Dhaka",
    topics: deadline.topics || [],
    difficulty: deadline.difficulty || 3,
    estimatedHours: deadline.estimatedHours || 3,
    weightPercent: deadline.weightPercent || 0,
    readinessScore: deadline.readinessScore || 0,
    riskLevel: deadline.riskLevel || "Medium",
    source: deadline.source || "manual",
    description: String(deadline.description || "").slice(0, 900),
    materialsText: String(deadline.materialsText || "").slice(0, 1200),
  };
}

export async function getPlanningPreferences(payload = {}) {
  const userId = requireUserId(payload);

  let preference = await ReadinessUserPreference.findOne({ userId });

  if (!preference) {
    preference = await ReadinessUserPreference.create({
      userId,
      country: "BD",
      timezone: "Asia/Dhaka",
      planning: {
        timeSlots: DEFAULT_TIME_SLOTS,
        maxDailyStudyMinutes: 150,
        softDailyWorkloadMinutes: 120,
        planningWindowDays: 30,
        recentOverdueDays: 0,
        avoidDays: [],
      },
    });
  }

  const existingPlanning = preference.planning || {};

  const slots = normalizeSlots(existingPlanning.timeSlots || []);
  const avoidDays = normalizeAvoidDays(existingPlanning.avoidDays || []);

  const planning = {
    timeSlots: slots.length ? slots : DEFAULT_TIME_SLOTS,

    maxDailyStudyMinutes: clamp(
      existingPlanning.maxDailyStudyMinutes ||
        preference.coaching?.maxDailyStudyMinutes ||
        150,
      30,
      600
    ),

    softDailyWorkloadMinutes: clamp(
      existingPlanning.softDailyWorkloadMinutes || 120,
      30,
      600
    ),

    planningWindowDays: clamp(existingPlanning.planningWindowDays || 30, 7, 90),

    recentOverdueDays: clamp(existingPlanning.recentOverdueDays ?? 0, 0, 21),

    avoidDays,
  };

  return { preference, planning };
}

export async function updatePlanningPreferences(payload = {}) {
  const userId = requireUserId(payload);
  const { preference } = await getPlanningPreferences({ userId });

  const incoming = payload.planning || payload;
  const current = preference.planning || {};

  const nextTimeSlots =
    incoming.timeSlots !== undefined
      ? normalizeSlots(incoming.timeSlots)
      : normalizeSlots(current.timeSlots || []);

  const nextAvoidDays =
    incoming.avoidDays !== undefined
      ? normalizeAvoidDays(incoming.avoidDays)
      : normalizeAvoidDays(current.avoidDays || []);

  preference.planning = {
    timeSlots: nextTimeSlots.length ? nextTimeSlots : DEFAULT_TIME_SLOTS,

    maxDailyStudyMinutes: clamp(
      incoming.maxDailyStudyMinutes ?? current.maxDailyStudyMinutes ?? 150,
      30,
      600
    ),

    softDailyWorkloadMinutes: clamp(
      incoming.softDailyWorkloadMinutes ??
        current.softDailyWorkloadMinutes ??
        120,
      30,
      600
    ),

    planningWindowDays: clamp(
      incoming.planningWindowDays ?? current.planningWindowDays ?? 30,
      7,
      90
    ),

    recentOverdueDays: clamp(
      incoming.recentOverdueDays ?? current.recentOverdueDays ?? 0,
      0,
      21
    ),

    avoidDays: nextAvoidDays,
  };

  preference.coaching = {
    ...(preference.coaching?.toObject?.() || preference.coaching || {}),
    maxDailyStudyMinutes: preference.planning.maxDailyStudyMinutes,
  };

  await preference.save();

  return {
    preference,
    planning: preference.planning,
  };
}

function findBestDate({
  today,
  due,
  preferredDate,
  duration,
  planning,
  loadByDay,
  allowDueDateIfNeeded = true,
}) {
  let candidate = dateOnly(preferredDate) || today;

  if (candidate < today) candidate = today;
  if (candidate > due) candidate = due;

  const preferredKey = ymd(candidate);
  const preferredLoad = loadByDay.get(preferredKey) || 0;

  if (
    !isAvoidedDate(candidate, planning.avoidDays) &&
    preferredLoad + duration <= planning.maxDailyStudyMinutes
  ) {
    return candidate;
  }

  for (
    let cursor = dateOnly(today);
    cursor <= due;
    cursor = addDays(cursor, 1)
  ) {
    if (
      isAvoidedDate(cursor, planning.avoidDays) &&
      !(allowDueDateIfNeeded && cursor.getTime() === due.getTime())
    ) {
      continue;
    }

    const key = ymd(cursor);
    const load = loadByDay.get(key) || 0;

    if (load + duration <= planning.softDailyWorkloadMinutes) {
      return cursor;
    }
  }

  for (
    let cursor = dateOnly(today);
    cursor <= due;
    cursor = addDays(cursor, 1)
  ) {
    const key = ymd(cursor);
    const load = loadByDay.get(key) || 0;

    if (load + duration <= planning.maxDailyStudyMinutes) {
      return cursor;
    }
  }

  return due;
}

function decideBlockCount(deadline, planning, today) {
  const due = dateOnly(deadline.dueDate);
  const latest = latestAllowedStudyDate(deadline, today);
  const daysAvailable = Math.max(1, daysBetween(today, latest) + 1);

  const difficulty = clamp(deadline.difficulty || 3, 1, 5);
  const topicsCount =
    Array.isArray(deadline.topics) && deadline.topics.length
      ? deadline.topics.length
      : 1;

  const estimatedMinutes = clamp(
    Number(deadline.estimatedHours || 3) * 60,
    30,
    1800
  );

  const baseDuration = difficulty >= 4 ? 60 : 45;
  const estimatedBlocks = Math.ceil(estimatedMinutes / baseDuration);

  let minimumBlocks = 1;

  if (isQuizOrExam(deadline)) {
    minimumBlocks = Math.min(
      Math.max(2, topicsCount + 1),
      Math.max(2, daysAvailable)
    );
  } else if (["assignment", "project", "lab", "presentation"].includes(deadline.type)) {
    minimumBlocks = Math.min(4, Math.max(2, daysAvailable));
  }

  const maxPossibleByCapacity = Math.max(
    1,
    Math.floor(
      (daysAvailable * planning.maxDailyStudyMinutes) / Math.max(30, baseDuration)
    )
  );

  return clamp(
    Math.max(minimumBlocks, estimatedBlocks),
    1,
    Math.min(18, maxPossibleByCapacity || 1)
  );
}

function getTaskTypeForBlock(deadline, index, blockCount) {
  const type = String(deadline.type || "").toLowerCase();

  if (["quiz", "exam"].includes(type)) {
    if (index === blockCount - 1) return "review";
    if (index >= Math.max(0, blockCount - 3)) return "practice";
    return "prep";
  }

  if (["assignment", "project", "lab", "presentation"].includes(type)) {
    if (index === 0) return "outline";
    if (index === blockCount - 1) return "submit";
    if (index === blockCount - 2) return "test";
    return "implementation";
  }

  if (type === "reading") {
    return index === blockCount - 1 ? "review" : "prep";
  }

  return index === blockCount - 1 ? "review" : "prep";
}

function fallbackCrossDeadlinePlan({ deadlines, planning, today }) {
  const tasks = [];
  const loadByDay = new Map();

  const slots =
    Array.isArray(planning.timeSlots) && planning.timeSlots.length
      ? planning.timeSlots
      : DEFAULT_TIME_SLOTS;

  for (const deadline of deadlines) {
    const officialDue = dateOnly(deadline.dueDate);

    if (!officialDue || officialDue < today) continue;

    const latestStudy = latestAllowedStudyDate(deadline, today);
    const daysLeft = Math.max(0, daysBetween(today, officialDue));
    const difficulty = clamp(deadline.difficulty || 3, 1, 5);
    const blockDuration = difficulty >= 4 ? 60 : 45;
    const blockCount = decideBlockCount(deadline, planning, today);

    for (let index = 0; index < blockCount; index += 1) {
      const rawPreferredDate = addDays(latestStudy, -(blockCount - 1 - index));
      const preferredDate =
        rawPreferredDate && rawPreferredDate >= today
          ? rawPreferredDate
          : addDays(today, index);

      const scheduledDate = findBestDate({
        today,
        due: latestStudy,
        preferredDate,
        duration: blockDuration,
        planning,
        loadByDay,
        allowDueDateIfNeeded: true,
      });

      const key = ymd(scheduledDate);
      const currentLoad = loadByDay.get(key) || 0;

      const finalDuration = Math.min(
        blockDuration,
        Math.max(15, planning.maxDailyStudyMinutes - currentLoad)
      );

      if (finalDuration < 15) continue;

      loadByDay.set(key, currentLoad + finalDuration);

      const taskType = getTaskTypeForBlock(deadline, index, blockCount);
      const topic =
        taskType === "review"
          ? `${deadline.title} final review`
          : topicAt(deadline, index);

      tasks.push({
        deadlineId: String(deadline._id),
        title: `${taskVerb(taskType)} ${topic}`,
        topic,
        topics: deadline.topics || [],
        type: taskType,
        scheduledDate: ymd(scheduledDate),
        startTime: slots[tasks.length % slots.length],
        durationMinutes: finalDuration,
        mode:
          daysLeft <= 2
            ? "strong"
            : taskType === "review"
              ? "minimum"
              : "normal",
        priority: clamp(
          50 +
            difficulty * 8 +
            Math.max(0, 10 - daysLeft) * 4 +
            (isQuizOrExam(deadline) ? 12 : 0) +
            (taskType === "review" ? 8 : 0),
          1,
          100
        ),
        reason: isQuizOrExam(deadline)
          ? `Preparation for ${deadline.title}. Quiz/exam tasks are scheduled before the official date ${ymd(officialDue)}.`
          : `Preparation for ${deadline.title}, due in ${daysLeft} day(s).`,
        instructions:
          taskType === "review"
            ? "Review summary notes, weak points, and key formulas/concepts only."
            : "Complete one focused study block and produce visible output.",
        expectedOutput:
          taskType === "practice"
            ? "Solved practice questions or mock answers."
            : taskType === "review"
              ? "Final checklist or short revision sheet."
              : "Short notes, checklist, draft, or completed work section.",
      });
    }
  }

  return tasks;
}

/**
 * Gemma is called only from generateReadinessPlan().
 * No refresh/list/settings/manual task endpoint should call this helper.
 */
async function callGemmaOnlyForGenerateCalendar2({
  deadlines,
  planning,
  today,
  timezone,
}) {
  const fallback = {
    tasks: fallbackCrossDeadlinePlan({ deadlines, planning, today }),
  };

  if (process.env.READINESS_PLAN_USE_GEMMA === "false") {
    return {
      ...fallback,
      plannerSource: "fallback",
    };
  }

  const prompt = `Return JSON only. No markdown.

You are Gemma Readiness Coach.

Create Calendar 2 AI routine JSON from Calendar 1 official deadlines.

Today: ${ymd(today)}
Timezone: ${timezone}
Planning window: next ${planning.planningWindowDays} days.

User planning input:
- Free time slots: ${planning.timeSlots.join(", ")}
- Daily maximum study minutes: ${planning.maxDailyStudyMinutes}
- Soft workload minutes: ${planning.softDailyWorkloadMinutes}
- Avoid days: ${
    planning.avoidDays.length ? planning.avoidDays.join(", ") : "none"
  }

Calendar 1 official deadlines:
${JSON.stringify(deadlines.map(aiDeadline), null, 2)}

Critical rules:
- Calendar 1 is source of truth. Do not modify Calendar 1.
- Create Calendar 2 preparation tasks only.
- Use only real deadline ids from Calendar 1.
- Use only user free time slots.
- Avoid user avoid-days unless no earlier safe date exists.
- Never schedule any task after the official deadline date.
- For quiz/exam:
  - Decide when the user should start based on today, due date, topics, difficulty, estimated hours, workload, and free slots.
  - Start early enough.
  - Do not wait until quiz day if earlier dates exist.
  - Place prep/practice/review before the official quiz/exam date.
  - Final review should be one day before quiz/exam when possible.
- For assignment/project/lab:
  - Create outline, implementation, check/test, submit blocks.
- Spread workload across days.
- Do not exceed daily maximum study minutes.
- Prefer soft workload limit when possible.
- Return strict JSON only:
{
  "tasks": [
    {
      "deadlineId": "real Calendar 1 id",
      "title": "task title",
      "topic": "topic",
      "topics": ["topic"],
      "type": "prep|practice|review|outline|implementation|test|submit|mock|buffer|other",
      "scheduledDate": "YYYY-MM-DD",
      "startTime": "HH:mm",
      "durationMinutes": 45,
      "mode": "minimum|normal|strong",
      "priority": 70,
      "reason": "why this task is placed here",
      "instructions": "what user should do",
      "expectedOutput": "what should be completed"
    }
  ]
}`;

  try {
    console.log(
      "[readinessPlanner] Gemma called only because user clicked Generate Calendar 2."
    );

    const ai = await callReadinessGemma(prompt, fallback, {
      temperature: 0.08,
    });

    if (!ai || !Array.isArray(ai.tasks) || !ai.tasks.length) {
      return {
        ...fallback,
        plannerSource: "fallback_after_empty_gemma",
      };
    }

    return {
      ...ai,
      plannerSource: "gemma",
    };
  } catch (error) {
    console.warn(
      "[readinessPlanner] Gemma failed during Generate Calendar 2, fallback used:",
      error.message
    );

    return {
      ...fallback,
      plannerSource: "fallback_after_gemma_error",
    };
  }
}

function validateAndRepairGemmaTasks({ rawTasks, deadlines, planning, today }) {
  const deadlineMap = new Map(
    deadlines.map((deadline) => [String(deadline._id), deadline])
  );

  const slots =
    Array.isArray(planning.timeSlots) && planning.timeSlots.length
      ? planning.timeSlots
      : DEFAULT_TIME_SLOTS;

  const loadByDay = new Map();
  const valid = [];

  for (const item of Array.isArray(rawTasks) ? rawTasks : []) {
    const deadlineId = String(item.deadlineId || item.deadline_id || "");
    const deadline = deadlineMap.get(deadlineId);

    if (!deadline) continue;

    const officialDue = dateOnly(deadline.dueDate);

    if (!officialDue || officialDue < today) continue;

    const latestStudy = latestAllowedStudyDate(deadline, today);
    let durationMinutes = clamp(item.durationMinutes || 45, 10, 180);
    const aiDate = dateOnly(item.scheduledDate || item.date || today) || today;

    let scheduledDate = findBestDate({
      today,
      due: latestStudy,
      preferredDate: aiDate,
      duration: durationMinutes,
      planning,
      loadByDay,
      allowDueDateIfNeeded: true,
    });

    if (scheduledDate > latestStudy) {
      scheduledDate = latestStudy;
    }

    let startTime = normalizeStartTime(item.startTime, "");

    if (!startTime || !slots.includes(startTime)) {
      startTime = slots[valid.length % slots.length];
    }

    const key = ymd(scheduledDate);
    const currentLoad = loadByDay.get(key) || 0;

    if (currentLoad + durationMinutes > planning.maxDailyStudyMinutes) {
      durationMinutes = Math.max(
        10,
        planning.maxDailyStudyMinutes - currentLoad
      );
    }

    if (durationMinutes < 10) continue;

    loadByDay.set(key, currentLoad + durationMinutes);

    let repairedType = normalizeTaskType(item.type);

    if (isQuizOrExam(deadline) && scheduledDate.getTime() === latestStudy.getTime()) {
      repairedType = repairedType === "practice" ? "practice" : "review";
    }

    valid.push({
      deadlineId: deadline._id,
      courseCode: deadline.courseCode || "",
      courseTitle: deadline.courseTitle || "",
      deadlineTitle: deadline.title,

      title: clean(
        item.title,
        `${deadlineVerb(deadline.type)} ${deadline.title}`
      ),
      topic: clean(item.topic, topicAt(deadline)),
      topics: Array.isArray(item.topics)
        ? item.topics.map((topic) => clean(topic)).filter(Boolean)
        : deadline.topics || [],

      type: repairedType,
      scheduledDate,
      startTime,
      durationMinutes,
      mode: normalizeMode(item.mode),
      priority: clamp(item.priority || 60, 1, 100),
      difficulty: deadline.difficulty || 3,

      reason: clean(
        item.reason,
        isQuizOrExam(deadline)
          ? `AI preparation for ${deadline.title}; quiz/exam preparation must be before ${ymd(officialDue)}.`
          : `AI preparation for ${deadline.title}`
      ),
      instructions: clean(item.instructions),
      expectedOutput: clean(item.expectedOutput),
    });
  }

  return valid;
}

/**
 * This is the ONLY function that calls Gemma.
 * Use only for Generate 30 Days / Generate Calendar 2.
 */
export async function generateReadinessPlan(payload = {}) {
  const userId = requireUserId(payload);
  const timezone = await getUserTimezone(userId, payload.timezone || payload.tz);

  const todayStart = startOfDayInTimezone(payload.today || new Date(), timezone);
  const today = dateOnly(todayStart);

  const { planning } = await getPlanningPreferences({ userId });

  const planningWindowDays = clamp(planning.planningWindowDays || 30, 7, 90);

  const planningEnd = endOfDayInTimezone(
    addDaysByTimezone(todayStart, planningWindowDays - 1, timezone),
    timezone
  );

  const filter = {
    userId,
    status: { $in: ACTIVE_DEADLINE_STATUSES },
  };

  if (payload.deadlineId) {
    filter._id = requireObjectId(payload.deadlineId, "deadlineId");
  } else {
    filter.dueDate = {
      $gte: todayStart,
      $lte: planningEnd,
    };
  }

  const deadlinesRaw = await ReadinessDeadline.find(filter).sort({
    dueDate: 1,
    difficulty: -1,
    weightPercent: -1,
  });

  const deadlines = deadlinesRaw.filter((deadline) => {
    if (isStaticLikeDeadline(deadline)) return false;

    const due = dateOnly(deadline.dueDate);

    if (!due) return false;

    return due >= today;
  });

  if (!deadlines.length) {
    return {
      created: 0,
      tasks: [],
      planning,
      timezone,
      plannerSource: "none",
      message:
        "No current/future active Calendar 1 official deadlines found for Calendar 2 generation.",
    };
  }

  const aiRoutine = await callGemmaOnlyForGenerateCalendar2({
    deadlines,
    planning,
    today,
    timezone,
  });

  let validTasks = validateAndRepairGemmaTasks({
    rawTasks: aiRoutine?.tasks || [],
    deadlines,
    planning,
    today,
  });

  if (!validTasks.length) {
    validTasks = validateAndRepairGemmaTasks({
      rawTasks: fallbackCrossDeadlinePlan({ deadlines, planning, today }),
      deadlines,
      planning,
      today,
    });
  }

  if (payload.force !== false) {
    await ReadinessTask.deleteMany({
      userId,
      aiGenerated: true,
      calendarType: "preparation",
      status: { $in: OPEN_TASK_STATUSES },
      scheduledDate: {
        $gte: todayStart,
        $lte: planningEnd,
      },
    });
  }

  const batchId = `plan-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const createdTasks = [];

  for (const item of validTasks.slice(0, 200)) {
    const task = await ReadinessTask.create({
      userId,
      deadlineId: item.deadlineId,

      courseCode: item.courseCode,
      courseTitle: item.courseTitle,
      deadlineTitle: item.deadlineTitle,

      title: item.title,
      topic: item.topic,
      topics: item.topics,

      type: item.type,
      calendarType: "preparation",

      scheduledDate: item.scheduledDate,
      startTime: item.startTime,
      durationMinutes: item.durationMinutes,

      mode: item.mode,
      priority: item.priority,
      difficulty: item.difficulty,

      reason: item.reason,
      instructions: item.instructions,
      expectedOutput: item.expectedOutput,

      status: "planned",
      aiGenerated: true,
      autoReplanned: false,
      replanBatchId: batchId,
    });

    createdTasks.push(task);
  }

  for (const deadline of deadlines) {
    await recalculateDeadlineReadiness(deadline._id);
    deadline.lastPlannedAt = new Date();
    await deadline.save();
  }

  const smoothing = await smoothHeavyWeeks(userId).catch((error) => ({
    message: `Heavy week smoothing skipped: ${error.message}`,
  }));

  return {
    created: createdTasks.length,
    tasks: createdTasks,
    smoothing,
    planning,
    timezone,
    plannerSource: aiRoutine?.plannerSource || "unknown",
    message: `Generated ${createdTasks.length} Calendar 2 preparation task(s). ${
      smoothing.message || ""
    }`,
  };
}

/**
 * Manual Calendar 2 add.
 * No Gemma call.
 */
export async function createReadinessTask(payload = {}) {
  const userId = requireUserId(payload);
  const deadlineId = requireObjectId(payload.deadlineId, "deadlineId");

  const deadline = await ReadinessDeadline.findOne({
    _id: deadlineId,
    userId,
  });

  if (!deadline) {
    throw makeError("Official deadline not found.", 404, "deadline_not_found");
  }

  const { planning } = await getPlanningPreferences({ userId });

  const scheduledDate = dateOnly(
    payload.scheduledDate || payload.date || new Date()
  );

  const officialDue = dateOnly(deadline.dueDate);
  const latestStudy = latestAllowedStudyDate(deadline, dateOnly(new Date()));

  if (scheduledDate > officialDue) {
    throw makeError(
      "Calendar 2 task cannot be scheduled after Calendar 1 deadline.",
      400
    );
  }

  if (isQuizOrExam(deadline) && scheduledDate > latestStudy) {
    throw makeError(
      "Quiz/exam preparation should be before the official quiz/exam date.",
      400
    );
  }

  if (
    isAvoidedDate(scheduledDate, planning.avoidDays) &&
    scheduledDate.getTime() !== officialDue.getTime()
  ) {
    throw makeError("This date is in your avoid-days list.", 400);
  }

  let startTime = normalizeStartTime(payload.startTime, "");

  if (!startTime || !planning.timeSlots.includes(startTime)) {
    startTime = planning.timeSlots[0] || DEFAULT_TIME_SLOTS[0];
  }

  const task = await ReadinessTask.create({
    userId,
    deadlineId: deadline._id,

    courseCode: deadline.courseCode || "",
    courseTitle: deadline.courseTitle || "",
    deadlineTitle: deadline.title,

    title: clean(
      payload.title,
      `${deadlineVerb(deadline.type)} ${deadline.title}`
    ),
    topic: clean(payload.topic, topicAt(deadline)),
    topics: Array.isArray(payload.topics)
      ? payload.topics.map((topic) => clean(topic)).filter(Boolean)
      : [],

    type: normalizeTaskType(payload.type),
    calendarType: "preparation",

    scheduledDate,
    startTime,
    durationMinutes: clamp(payload.durationMinutes || 45, 10, 180),

    mode: normalizeMode(payload.mode),
    priority: clamp(payload.priority || 60, 1, 100),
    difficulty: deadline.difficulty || 3,

    reason: clean(payload.reason, "Manual Calendar 2 task."),
    instructions: clean(payload.instructions),
    expectedOutput: clean(payload.expectedOutput),

    status: clean(payload.status, "planned"),
    aiGenerated: false,
  });

  return { task };
}

/**
 * Manual Calendar 2 edit.
 * No Gemma call.
 */
export async function updateReadinessTask(taskId, payload = {}) {
  const userId = requireUserId(payload);
  requireObjectId(taskId, "taskId");

  const task = await ReadinessTask.findOne({
    _id: taskId,
    userId,
  });

  if (!task) {
    throw makeError("Task not found.", 404, "task_not_found");
  }

  const deadline = await ReadinessDeadline.findOne({
    _id: task.deadlineId,
    userId,
  });

  const { planning } = await getPlanningPreferences({ userId });

  if (payload.title !== undefined) task.title = clean(payload.title, task.title);
  if (payload.topic !== undefined) task.topic = clean(payload.topic, task.topic);
  if (payload.type !== undefined) task.type = normalizeTaskType(payload.type);
  if (payload.mode !== undefined) task.mode = normalizeMode(payload.mode);
  if (payload.reason !== undefined) task.reason = clean(payload.reason);

  if (payload.instructions !== undefined) {
    task.instructions = clean(payload.instructions);
  }

  if (payload.expectedOutput !== undefined) {
    task.expectedOutput = clean(payload.expectedOutput);
  }

  if (payload.scheduledDate !== undefined || payload.date !== undefined) {
    const nextDate = dateOnly(payload.scheduledDate || payload.date);

    if (deadline && nextDate > dateOnly(deadline.dueDate)) {
      throw makeError(
        "Calendar 2 task cannot be moved after Calendar 1 deadline.",
        400
      );
    }

    if (deadline && isQuizOrExam(deadline)) {
      const latestStudy = latestAllowedStudyDate(deadline, dateOnly(new Date()));

      if (nextDate > latestStudy) {
        throw makeError(
          "Quiz/exam preparation should be before the official quiz/exam date.",
          400
        );
      }
    }

    if (
      isAvoidedDate(nextDate, planning.avoidDays) &&
      deadline &&
      nextDate.getTime() !== dateOnly(deadline.dueDate).getTime()
    ) {
      throw makeError("This date is in your avoid-days list.", 400);
    }

    task.scheduledDate = nextDate;
  }

  if (payload.startTime !== undefined) {
    const nextTime = normalizeStartTime(payload.startTime, "");

    if (!nextTime) {
      throw makeError("Invalid startTime. Use HH:mm.", 400);
    }

    task.startTime = planning.timeSlots.includes(nextTime)
      ? nextTime
      : planning.timeSlots[0] || DEFAULT_TIME_SLOTS[0];
  }

  if (payload.durationMinutes !== undefined) {
    task.durationMinutes = clamp(payload.durationMinutes, 10, 180);
  }

  if (payload.priority !== undefined) {
    task.priority = clamp(payload.priority, 1, 100);
  }

  if (payload.status !== undefined) {
    task.status = clean(payload.status, task.status);

    if (task.status === "done" && !task.completedAt) {
      task.completedAt = new Date();
    }

    if (task.status !== "done") {
      task.completedAt = null;
    }
  }

  await task.save();

  return { task };
}

/**
 * Manual Calendar 2 delete.
 * No Gemma call.
 */
export async function deleteReadinessTask(taskId, payload = {}) {
  const userId = requireUserId(payload);
  requireObjectId(taskId, "taskId");

  const task = await ReadinessTask.findOneAndDelete({
    _id: taskId,
    userId,
  });

  if (!task) {
    throw makeError("Task not found.", 404, "task_not_found");
  }

  return {
    deleted: true,
    taskId,
  };
}

/**
 * Deterministic recovery replan.
 * No Gemma call.
 */
export async function autoReplanSingleDeadline({ userId, deadlineId, answer }) {
  if (answer === "done") {
    return {
      changed: 0,
      message: "No replan needed after Done.",
    };
  }

  const deadline = await ReadinessDeadline.findById(deadlineId);

  if (!deadline) {
    return {
      changed: 0,
      message: "Deadline not found.",
    };
  }

  const { planning } = await getPlanningPreferences({ userId });

  const today = dateOnly(new Date());
  const officialDue = dateOnly(deadline.dueDate);
  const latestStudy = latestAllowedStudyDate(deadline, today);
  const daysLeft = Math.max(1, daysBetween(today, latestStudy));

  const futureTasks = await ReadinessTask.find({
    userId,
    deadlineId,
    status: "planned",
    scheduledDate: { $gte: today },
  }).sort({
    scheduledDate: 1,
    priority: -1,
  });

  if (!futureTasks.length) {
    return {
      changed: 0,
      message: "No future planned tasks to replan.",
    };
  }

  const capacityPerDay = answer === "confused" ? 1 : 2;
  let cursor = 0;
  let changed = 0;
  const loadByDay = new Map();

  for (const task of futureTasks) {
    let newDate = addDays(
      today,
      Math.min(daysLeft - 1, Math.floor(cursor / capacityPerDay))
    );

    if (newDate > latestStudy) {
      newDate = latestStudy;
    }

    if (
      isAvoidedDate(newDate, planning.avoidDays) &&
      newDate.getTime() !== officialDue.getTime()
    ) {
      newDate = findBestDate({
        today,
        due: latestStudy,
        preferredDate: newDate,
        duration: task.durationMinutes || 30,
        planning,
        loadByDay,
      });
    }

    task.scheduledDate = newDate;

    task.durationMinutes = clamp(
      answer === "half_done"
        ? Math.ceil(task.durationMinutes * 0.85)
        : Math.ceil(task.durationMinutes * 0.7),
      10,
      50
    );

    task.mode = answer === "half_done" ? task.mode : "minimum";
    task.priority = clamp((task.priority || 60) + 8, 1, 100);
    task.autoReplanned = true;
    task.reason = `${task.reason || ""} Auto-replanned after ${answer}.`.trim();

    await task.save();

    cursor += 1;
    changed += 1;
  }

  return {
    changed,
    message: `Auto-replanned ${changed} future task(s) into smaller realistic blocks.`,
  };
}