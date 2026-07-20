import ReadinessDeadline from "../../models/ReadinessDeadline.js";
import ReadinessTask from "../../models/ReadinessTask.js";
import ReadinessUserPreference from "../../models/ReadinessUserPreference.js";

import { requireUserId } from "./readinessDate.util.js";
import { getHeavyWeeks } from "./readinessHeavyWeek.service.js";

import {
  addDaysByTimezone,
  endOfDayInTimezone,
  formatDateInTimezone,
  normalizeTimezone,
  startOfDayInTimezone,
} from "./readinessTimezone.util.js";

const CURRENT_DEADLINE_STATUSES = ["active", "pending", "in_progress"];

const OPEN_TASK_STATUSES = [
  "planned",
  "not_started",
  "half_done",
  "confused",
  "skipped",
  "rescheduled",
];

const STATIC_WORDS = [
  "sample",
  "demo",
  "static",
  "dummy",
  "placeholder",
  "test deadline",
  "untitled deadline",
];

async function getUserTimezone(userId, requestedTimezone) {
  if (requestedTimezone) return normalizeTimezone(requestedTimezone);

  const preference = await ReadinessUserPreference.findOne({ userId })
    .select("timezone country")
    .lean();

  return normalizeTimezone(
    preference?.timezone || preference?.country || "Asia/Dhaka"
  );
}

function isStaticLikeDeadline(deadline = {}) {
  const title = String(deadline.title || "").trim().toLowerCase();
  const source = String(deadline.source || "").trim().toLowerCase();

  if (!title) return true;

  if (STATIC_WORDS.some((word) => title === word || title.includes(word))) {
    return true;
  }

  if (["sample", "demo", "static", "dummy", "seed"].includes(source)) {
    return true;
  }

  return false;
}

function isCurrentOfficialDeadline(deadline = {}, todayStart) {
  const status = String(deadline.status || "active").toLowerCase();

  if (!CURRENT_DEADLINE_STATUSES.includes(status)) return false;
  if (isStaticLikeDeadline(deadline)) return false;

  const dueDate = new Date(deadline.dueDate);

  if (Number.isNaN(dueDate.getTime())) return false;

  return dueDate.getTime() >= todayStart.getTime();
}

function taskBelongsToCurrentDeadline(task, todayStart) {
  const deadline = task.deadlineId;

  if (!deadline || typeof deadline !== "object") return true;

  return isCurrentOfficialDeadline(deadline, todayStart);
}

function normalizeDeadline(deadline, fallbackTimezone) {
  const timezone = normalizeTimezone(deadline.timezone || fallbackTimezone);
  const dateKey = formatDateInTimezone(deadline.dueDate, timezone);

  return {
    ...deadline,
    date: dateKey,
    dateKey,
    timezone,
  };
}

function normalizeTask(task, fallbackTimezone) {
  const timezone = normalizeTimezone(task.timezone || fallbackTimezone);
  const dateKey = formatDateInTimezone(task.scheduledDate, timezone);

  return {
    ...task,
    date: dateKey,
    dateKey,
    timezone,
  };
}

export async function getDashboard(query = {}) {
  const userId = requireUserId(query);
  const timezone = await getUserTimezone(userId, query.timezone || query.tz);

  const todayStart = startOfDayInTimezone(query.date || new Date(), timezone);

  const next30End = endOfDayInTimezone(
    addDaysByTimezone(todayStart, 29, timezone),
    timezone
  );

  const [deadlinesRaw, tasksRaw, heavyWeekData] = await Promise.all([
    ReadinessDeadline.find({
      userId,
      status: { $in: CURRENT_DEADLINE_STATUSES },
      dueDate: { $gte: todayStart },
    })
      .sort({ dueDate: 1, riskLevel: -1, createdAt: -1 })
      .limit(200)
      .lean(),

    ReadinessTask.find({
      userId,
      calendarType: "preparation",
      status: { $in: OPEN_TASK_STATUSES },
      scheduledDate: {
        $gte: todayStart,
        $lte: next30End,
      },
    })
      .populate("deadlineId")
      .sort({ scheduledDate: 1, startTime: 1, priority: -1 })
      .limit(300)
      .lean(),

    getHeavyWeeks({ userId, timezone }).catch(() => ({ weeks: [] })),
  ]);

  const deadlines = deadlinesRaw
    .filter((deadline) => isCurrentOfficialDeadline(deadline, todayStart))
    .map((deadline) => normalizeDeadline(deadline, timezone));

  const upcomingTasks = tasksRaw
    .filter((task) => taskBelongsToCurrentDeadline(task, todayStart))
    .map((task) => normalizeTask(task, timezone));

  const todayKey = formatDateInTimezone(todayStart, timezone);

  const todayTasks = upcomingTasks.filter((task) => task.dateKey === todayKey);

  const readinessScores = deadlines
    .map((deadline) => Number(deadline.readinessScore))
    .filter((score) => Number.isFinite(score));

  const averageReadiness = readinessScores.length
    ? Math.round(
        readinessScores.reduce((sum, score) => sum + score, 0) /
          readinessScores.length
      )
    : 0;

  const weeks = heavyWeekData?.weeks || [];

  return {
    timezone,
    todayDate: todayKey,

    averageReadiness,

    deadlines,

    today: todayTasks,
    tasks: todayTasks,

    upcomingTasks,
    calendar2Tasks: upcomingTasks,

    heavyWeeks: weeks,

    summary: {
      activeDeadlines: deadlines.length,
      aiPreparationTasks: upcomingTasks.length,
      heavyWeeks: weeks.filter((week) => week.isHeavy).length,
      criticalDeadlines: deadlines.filter(
        (deadline) => deadline.riskLevel === "Critical"
      ).length,
      highRiskDeadlines: deadlines.filter((deadline) =>
        ["High", "Critical"].includes(String(deadline.riskLevel || ""))
      ).length,
    },
  };
}