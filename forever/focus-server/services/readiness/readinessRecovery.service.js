import ReadinessDeadline from "../../models/ReadinessDeadline.js";
import ReadinessTask from "../../models/ReadinessTask.js";
import ReadinessCheckin from "../../models/ReadinessCheckin.js";

import { callReadinessGemma } from "./readinessAi.service.js";
import { autoReplanSingleDeadline } from "./readinessPlanner.service.js";
import { recalculateDeadlineReadiness } from "./readinessScore.service.js";
import { scheduleSms } from "./readinessSms.service.js";
import { getHeavyWeeks, smoothHeavyWeeks } from "./readinessHeavyWeek.service.js";

import {
  clamp,
  clean,
  dateOnly,
  makeError,
  requireObjectId,
  requireUserId,
} from "./readinessDate.util.js";

async function buildRecoveryAi({ answer, task, deadline, recentHistory, heavyWeeks }) {
  const fallback = {
    aiText:
      answer === "done"
        ? "Great. Readiness increased. Keep tomorrow's task small and steady."
        : answer === "half_done"
          ? "No problem. You kept momentum. I am moving the remaining part into a smaller next step."
          : answer === "confused"
            ? "Confusion is normal. Start with one simple explanation and one dry run. No pressure."
            : "You are not behind. We restart with one smaller task today.",
    voiceText:
      answer === "done"
        ? "Great job. Your readiness increased."
        : "You are not behind. Let us restart with one small task.",
    smsText: `${deadline?.title || "Deadline"}: do one small recovery task today. Reply DONE / HELP / SKIP.`,
    recoveryTaskTitle: `Recovery: ${task.topic || task.title}`,
    carryOverTitle: `Carry over: ${task.topic || task.title}`,
    focusTopic: task.topic || deadline?.topics?.[0] || deadline?.title || task.title,
    reason: "Small recovery task created from check-in.",
  };

  return callReadinessGemma(
    `Return JSON only:
{
  "aiText": "supportive recovery text",
  "voiceText": "short spoken motivation",
  "smsText": "urgent short SMS under 160 characters",
  "recoveryTaskTitle": "small concrete recovery task",
  "carryOverTitle": "small carry-over task if half done",
  "focusTopic": "topic",
  "reason": "why this helps"
}

You are Gemma acting as a guilt-free student recovery coach.

Context:
${JSON.stringify({
  answer,
  task: {
    title: task.title,
    topic: task.topic,
    durationMinutes: task.durationMinutes,
    type: task.type,
  },
  deadline: deadline
    ? {
        title: deadline.title,
        courseCode: deadline.courseCode,
        courseTitle: deadline.courseTitle,
        type: deadline.type,
        dueDate: deadline.dueDate,
        readinessScore: deadline.readinessScore,
        riskLevel: deadline.riskLevel,
      }
    : null,
  recentHistory: recentHistory.slice(0, 6).map((history) => ({
    answer: history.answer,
    createdAt: history.createdAt,
    readinessDelta: history.readinessDelta,
  })),
  heavyWeeks: heavyWeeks.filter((week) => week.isHeavy).slice(0, 2),
})}

Rules:
- Never shame.
- If done, celebrate and mention tomorrow.
- If half_done, preserve momentum and move remaining part as a small carry-over.
- If not_started or skip, create a smaller restart task.
- If confused, create a 15-minute explanation + dry-run task.
- Keep voiceText short.
- Keep smsText under 160 characters.`,
    fallback,
    { temperature: 0.18 }
  );
}

async function createRecoveryTask({ task, deadline, answer, ai }) {
  if (answer === "done") return null;

  const topic = clean(ai.focusTopic, task.topic || deadline?.topics?.[0] || task.title);

  const duration =
    answer === "half_done"
      ? Math.max(10, Math.ceil(task.durationMinutes * 0.45))
      : answer === "confused"
        ? 15
        : Math.max(10, Math.ceil(task.durationMinutes * 0.5));

  const type = answer === "half_done" ? "carry_over" : "recovery";

  return ReadinessTask.create({
    userId: task.userId,
    deadlineId: task.deadlineId,
    courseCode: task.courseCode,
    title:
      answer === "half_done"
        ? clean(ai.carryOverTitle, `Carry over: ${topic}`)
        : clean(ai.recoveryTaskTitle, `Recovery: ${topic}`),
    topic,
    type,
    scheduledDate: dateOnly(new Date()),
    startTime: "20:00",
    durationMinutes: clamp(duration, 10, 45),
    mode: "minimum",
    priority: 95,
    reason: clean(ai.reason, "Created from daily check-in recovery."),
    recoveryOfTaskId: task._id,
    aiGenerated: true,
  });
}

export async function checkinTask(taskId, payload = {}) {
  requireObjectId(taskId, "taskId");

  const task = await ReadinessTask.findById(taskId);

  if (!task) {
    throw makeError("Task not found.", 404, "task_not_found");
  }

  const userId = clean(payload.userId, task.userId);

  if (!userId) {
    throw makeError("userId is required.", 400, "user_required");
  }

  const answer = clean(payload.answer);

  if (!["done", "half_done", "not_started", "confused", "skip"].includes(answer)) {
    throw makeError("answer must be done, half_done, not_started, confused, or skip.");
  }

  const deadlineBefore = await ReadinessDeadline.findById(task.deadlineId);
  const readinessBefore = deadlineBefore?.readinessScore || 0;

  const recentHistory = await ReadinessCheckin.find({ userId })
    .sort({ createdAt: -1 })
    .limit(10);

  const { weeks } = await getHeavyWeeks({ userId });

  const ai = await buildRecoveryAi({
    answer,
    task,
    deadline: deadlineBefore,
    recentHistory,
    heavyWeeks: weeks,
  });

  task.status =
    answer === "skip"
      ? "skipped"
      : answer === "done"
        ? "done"
        : answer === "half_done"
          ? "half_done"
          : answer === "not_started"
            ? "not_started"
            : "confused";

  task.blockedReason = clean(payload.blockedReason);
  task.lastCheckinAt = new Date();
  task.checkinCount += 1;

  if (answer === "done") {
    task.completedAt = new Date();
  }

  await task.save();

  const recoveryTask = await createRecoveryTask({
    task,
    deadline: deadlineBefore,
    answer,
    ai,
  });

  const replan = await autoReplanSingleDeadline({
    userId,
    deadlineId: task.deadlineId,
    answer,
  });

  const smoothing = await smoothHeavyWeeks(userId);

  const deadlineAfter = await recalculateDeadlineReadiness(task.deadlineId);
  const readinessAfter = deadlineAfter?.readinessScore || 0;

  let smsReminder = null;

  if (payload.phone && answer !== "done") {
    const reminder = await scheduleSms({
      userId,
      phone: payload.phone,
      taskId: recoveryTask?._id || task._id,
      deadlineId: task.deadlineId,
      kind: "recovery",
      message: clean(
        ai.smsText,
        `${deadlineBefore?.title || "Deadline"}: do one small recovery task today.`
      ),
      sendAt: new Date(Date.now() + 2 * 60 * 1000),
    });

    smsReminder = reminder.reminder;
  }

  const checkin = await ReadinessCheckin.create({
    userId,
    taskId: task._id,
    deadlineId: task.deadlineId,
    answer,
    blockedReason: clean(payload.blockedReason),
    note: clean(payload.note),
    aiText: clean(ai.aiText),
    voiceText: clean(ai.voiceText),
    smsText: clean(ai.smsText),
    readinessBefore,
    readinessAfter,
    readinessDelta: readinessAfter - readinessBefore,
    createdRecoveryTaskId: recoveryTask?._id || null,
    autoReplan: {
      ...replan,
      smoothing,
    },
    aiPayload: ai,
  });

  return {
    checkin,
    task,
    deadline: deadlineAfter,
    recoveryTask,
    replan,
    smoothing,
    smsReminder,
    aiDriven: true,
    aiText: clean(ai.aiText),
    voiceText: clean(ai.voiceText),
    smsText: clean(ai.smsText),
  };
}

export async function regenerateRecoveryPlan(payload = {}) {
  const userId = requireUserId(payload);
  const deadlineId = requireObjectId(payload.deadlineId, "deadlineId");

  const deadline = await ReadinessDeadline.findById(deadlineId);

  if (!deadline) {
    throw makeError("Deadline not found.", 404, "deadline_not_found");
  }

  const missedTasks = await ReadinessTask.find({
    userId,
    deadlineId,
    status: { $in: ["not_started", "skipped", "confused"] },
  }).sort({ scheduledDate: 1 });

  const plannedTasks = await ReadinessTask.find({
    userId,
    deadlineId,
    status: "planned",
  }).sort({ scheduledDate: 1 });

  const topic = clean(
    deadline.weakTopics?.[0] ||
      missedTasks[0]?.topic ||
      plannedTasks[0]?.topic ||
      deadline.topics?.[0],
    deadline.title
  );

  const fallback = {
    recoveryTasks: [
      {
        title: `Recovery: ${topic}`,
        topic,
        scheduledDate: new Date().toISOString().slice(0, 10),
        startTime: "20:00",
        durationMinutes: 15,
        reason: "Small restart task because old plan is no longer realistic.",
      },
    ],
    aiText: "Old plan is no longer realistic. I created a smaller recovery plan for today.",
    voiceText: "You are not behind. We restart with one small recovery task.",
  };

  const ai = await callReadinessGemma(
    `Return JSON only:
{
  "recoveryTasks": [
    {
      "title": "small recovery task",
      "topic": "topic",
      "scheduledDate": "YYYY-MM-DD",
      "startTime": "20:00",
      "durationMinutes": 15,
      "reason": "why this helps"
    }
  ],
  "aiText": "supportive recovery explanation",
  "voiceText": "short voice motivation"
}

Student is behind for this deadline:
${JSON.stringify({
  deadline: {
    title: deadline.title,
    type: deadline.type,
    dueDate: deadline.dueDate,
    readinessScore: deadline.readinessScore,
    riskLevel: deadline.riskLevel,
    weakTopics: deadline.weakTopics,
  },
  missedTasks: missedTasks.map((task) => ({
    title: task.title,
    topic: task.topic,
    status: task.status,
    durationMinutes: task.durationMinutes,
  })),
  plannedTasks: plannedTasks.slice(0, 10).map((task) => ({
    title: task.title,
    topic: task.topic,
    scheduledDate: task.scheduledDate,
    durationMinutes: task.durationMinutes,
  })),
})}

Rules:
- Recovery tasks must be smaller than original plan.
- No guilt/shame.
- Keep today task 10-20 minutes.
- Create at most 4 recovery tasks.`,
    fallback,
    { temperature: 0.16 }
  );

  const recoveryItems =
    Array.isArray(ai.recoveryTasks) && ai.recoveryTasks.length
      ? ai.recoveryTasks
      : fallback.recoveryTasks;

  const recoveryTasks = [];

  for (const item of recoveryItems.slice(0, 4)) {
    const task = await ReadinessTask.create({
      userId,
      deadlineId,
      courseCode: deadline.courseCode,
      title: clean(item.title, `Recovery: ${topic}`),
      topic: clean(item.topic, topic),
      type: "recovery",
      scheduledDate: dateOnly(item.scheduledDate || new Date()),
      startTime: clean(item.startTime, "20:00"),
      durationMinutes: clamp(item.durationMinutes || 15, 10, 45),
      mode: "minimum",
      priority: 100,
      reason: clean(
        item.reason,
        "Recovery plan generated because old plan is no longer realistic."
      ),
      aiGenerated: true,
    });

    recoveryTasks.push(task);
  }

  const replan = await autoReplanSingleDeadline({
    userId,
    deadlineId,
    answer: "not_started",
  });

  const smoothing = await smoothHeavyWeeks(userId);
  const updatedDeadline = await recalculateDeadlineReadiness(deadlineId);

  return {
    recoveryTasks,
    replan,
    smoothing,
    deadline: updatedDeadline,
    aiText: clean(ai.aiText, fallback.aiText),
    voiceText: clean(ai.voiceText, fallback.voiceText),
  };
}