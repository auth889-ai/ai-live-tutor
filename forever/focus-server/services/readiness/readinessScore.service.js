import ReadinessDeadline from "../../models/ReadinessDeadline.js";
import ReadinessTask from "../../models/ReadinessTask.js";

import { callReadinessGemma } from "./readinessAi.service.js";
import { clamp, clean, daysBetween } from "./readinessDate.util.js";

function riskFromScore(score, daysLeft) {
  if (score >= 80) return "Low";
  if (score >= 55 && daysLeft >= 2) return "Medium";
  if (score >= 35) return "High";
  return "Critical";
}

export async function recalculateDeadlineReadiness(deadlineId) {
  const deadline = await ReadinessDeadline.findById(deadlineId);
  if (!deadline) return null;

  const tasks = await ReadinessTask.find({ deadlineId: deadline._id });

  const total = Math.max(1, tasks.length);

  const done = tasks.filter((task) => task.status === "done").length;
  const halfDone = tasks.filter((task) => task.status === "half_done").length;
  const confused = tasks.filter((task) => task.status === "confused").length;
  const missed = tasks.filter((task) =>
    ["not_started", "skipped"].includes(task.status)
  ).length;
  const recoveryDone = tasks.filter(
    (task) => task.type === "recovery" && task.status === "done"
  ).length;
  const practiceDone = tasks.filter(
    (task) => task.type === "practice" && task.status === "done"
  ).length;
  const planned = tasks.filter((task) => task.status === "planned").length;

  const daysLeft = Math.max(0, daysBetween(new Date(), deadline.dueDate));

  const completionPart = ((done + halfDone * 0.45) / total) * 58;
  const practicePart = Math.min(12, practiceDone * 4);
  const recoveryPart = Math.min(8, recoveryDone * 4);
  const timePart = Math.min(15, daysLeft * 1.5);

  const difficultyPenalty = clamp(deadline.difficulty || 3, 1, 5) * 2;
  const confusedPenalty = confused * 8;
  const missedPenalty = missed * 7;

  const baseScore = clamp(
    completionPart +
      practicePart +
      recoveryPart +
      timePart -
      difficultyPenalty -
      confusedPenalty -
      missedPenalty,
    0,
    100
  );

  const weakTopics = [
    ...new Set(
      tasks
        .filter((task) =>
          ["confused", "not_started", "skipped"].includes(task.status)
        )
        .map((task) => clean(task.topic))
        .filter(Boolean)
    ),
  ].slice(0, 8);

  const fallback = {
    finalReadinessScore: Math.round(baseScore),
    riskLevel: riskFromScore(baseScore, daysLeft),
    reason:
      "Calculated from task completion, missed work, confusion, practice, recovery, difficulty, and days left.",
    nextAction:
      tasks.find((task) => task.status === "planned")?.title ||
      (weakTopics[0]
        ? `Do a 15-minute recovery block on ${weakTopics[0]}.`
        : "Do one small preparation block today."),
    weakTopics,
  };

  const ai = await callReadinessGemma(
    `Return JSON only:
{
  "finalReadinessScore": number,
  "riskLevel": "Low|Medium|High|Critical",
  "reason": "short reason",
  "nextAction": "one concrete next action",
  "weakTopics": ["topic"]
}

You are judging readiness for a university deadline.

Deadline:
${JSON.stringify({
  title: deadline.title,
  courseCode: deadline.courseCode,
  courseTitle: deadline.courseTitle,
  type: deadline.type,
  dueDate: deadline.dueDate,
  topics: deadline.topics,
  difficulty: deadline.difficulty,
  estimatedHours: deadline.estimatedHours,
})}

Evidence:
${JSON.stringify({
  daysLeft,
  totalTasks: total,
  done,
  halfDone,
  missed,
  confused,
  planned,
  practiceDone,
  recoveryDone,
  baseScore: Math.round(baseScore),
  weakTopics,
})}

Rules:
- Do not overrate if practice is missing.
- Confused topics reduce confidence.
- Missed tasks reduce confidence.
- If deadline is near and score is low, risk must be High or Critical.
- nextAction must be small and specific.`,
    fallback,
    { temperature: 0.08 }
  );

  const score = clamp(ai.finalReadinessScore ?? fallback.finalReadinessScore, 0, 100);

  deadline.readinessScore = Math.round(score);
  deadline.riskLevel = ["Low", "Medium", "High", "Critical"].includes(ai.riskLevel)
    ? ai.riskLevel
    : riskFromScore(score, daysLeft);
  deadline.aiReason = clean(ai.reason, fallback.reason);
  deadline.nextAction = clean(ai.nextAction, fallback.nextAction);
  deadline.weakTopics = Array.isArray(ai.weakTopics)
    ? ai.weakTopics.slice(0, 8)
    : fallback.weakTopics;

  await deadline.save();

  return deadline;
}