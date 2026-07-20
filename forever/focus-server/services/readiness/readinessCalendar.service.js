import ReadinessDeadline from "../../models/ReadinessDeadline.js";
import ReadinessTask from "../../models/ReadinessTask.js";
import ReadinessUserPreference from "../../models/ReadinessUserPreference.js";

import {
  applyTimeToDate,
  clean,
  icsDate,
  requireUserId,
} from "./readinessDate.util.js";

import { getPlanningPreferences } from "./readinessPlanner.service.js";

import {
  addDaysByTimezone,
  endOfDayInTimezone,
  formatDateInTimezone,
  formatTimeInTimezone,
  normalizeTimezone,
  startOfDayInTimezone,
  zonedDateTimeToDate,
} from "./readinessTimezone.util.js";

const ACTIVE_DEADLINE_STATUSES = ["active", "pending", "in_progress"];

const OPEN_TASK_STATUSES = [
  "planned",
  "not_started",
  "half_done",
  "confused",
  "skipped",
  "rescheduled",
];

async function getUserTimezone(userId, requestedTimezone) {
  if (requestedTimezone) return normalizeTimezone(requestedTimezone);

  const pref = await ReadinessUserPreference.findOne({ userId })
    .select("timezone")
    .lean();

  return normalizeTimezone(pref?.timezone || "Asia/Dhaka");
}

function windowBounds({ from, to, days = 30, timezone }) {
  const start = startOfDayInTimezone(from || new Date(), timezone);

  const end = to
    ? endOfDayInTimezone(to, timezone)
    : endOfDayInTimezone(
        addDaysByTimezone(start, Number(days || 30) - 1, timezone),
        timezone
      );

  return { start, end };
}

function deadlineDateKey(deadline, fallbackTimezone) {
  return formatDateInTimezone(
    deadline.dueDate,
    deadline.timezone || fallbackTimezone
  );
}

function taskDateKey(task, timezone) {
  return formatDateInTimezone(task.scheduledDate, timezone);
}

function taskBelongsToCurrentDeadline(task, windowStart) {
  const deadline = task.deadlineId;

  if (!deadline || typeof deadline !== "object") return true;

  if (["completed", "archived", "cancelled"].includes(deadline.status)) {
    return false;
  }

  return new Date(deadline.dueDate).getTime() >= windowStart.getTime();
}

export async function getToday(query = {}) {
  const userId = requireUserId(query);
  const timezone = await getUserTimezone(userId, query.timezone || query.tz);

  const start = startOfDayInTimezone(query.date || new Date(), timezone);
  const end = endOfDayInTimezone(query.date || new Date(), timezone);

  const tasksRaw = await ReadinessTask.find({
    userId,
    scheduledDate: { $gte: start, $lte: end },
    status: { $in: OPEN_TASK_STATUSES },
  })
    .populate("deadlineId")
    .sort({ priority: -1, startTime: 1, createdAt: 1 })
    .lean();

  const tasks = tasksRaw
    .filter((task) => taskBelongsToCurrentDeadline(task, start))
    .map((task) => ({
      ...task,
      date: taskDateKey(task, timezone),
      dateKey: taskDateKey(task, timezone),
      timezone,
    }));

  return {
    timezone,
    date: start,
    dateKey: formatDateInTimezone(start, timezone),
    tasks,
  };
}

export async function getOfficialCalendar(query = {}) {
  const userId = requireUserId(query);
  const timezone = await getUserTimezone(userId, query.timezone || query.tz);

  const { start, end } = windowBounds({
    from: query.from || new Date(),
    to: query.to,
    days: query.days || 35,
    timezone,
  });

  const events = await ReadinessDeadline.find({
    userId,
    status: { $in: ACTIVE_DEADLINE_STATUSES },
    dueDate: { $gte: start, $lte: end },
  })
    .sort({ dueDate: 1 })
    .lean();

  return {
    timezone,
    window: { from: start, to: end },
    events: events.map((deadline) => {
      const eventTimezone = deadline.timezone || timezone;

      return {
        ...deadline,
        date: deadlineDateKey(deadline, timezone),
        dateKey: deadlineDateKey(deadline, timezone),
        time:
          deadline.dueTime ||
          formatTimeInTimezone(deadline.dueDate, eventTimezone),
        timezone: eventTimezone,
      };
    }),
  };
}

export async function getReadinessCalendar(query = {}) {
  const userId = requireUserId(query);
  const timezone = await getUserTimezone(userId, query.timezone || query.tz);

  const { start, end } = windowBounds({
    from: query.from || new Date(),
    to: query.to,
    days: query.days || 35,
    timezone,
  });

  const eventsRaw = await ReadinessTask.find({
    userId,
    calendarType: "preparation",
    scheduledDate: { $gte: start, $lte: end },
    status: { $in: OPEN_TASK_STATUSES },
  })
    .populate("deadlineId")
    .sort({ scheduledDate: 1, startTime: 1, priority: -1 })
    .lean();

  const events = eventsRaw
    .filter((task) => taskBelongsToCurrentDeadline(task, start))
    .map((task) => ({
      ...task,
      date: taskDateKey(task, timezone),
      dateKey: taskDateKey(task, timezone),
      timezone,
    }));

  return {
    timezone,
    window: { from: start, to: end },
    events,
  };
}

export async function getTwoCalendar(query = {}) {
  const userId = requireUserId(query);
  const timezone = await getUserTimezone(userId, query.timezone || query.tz);
  const { planning } = await getPlanningPreferences({ userId });

  const days = Number(query.days || planning.planningWindowDays || 30);

  const { start, end } = windowBounds({
    from: query.from || new Date(),
    to: query.to,
    days,
    timezone,
  });

  const [official, readinessRaw] = await Promise.all([
    ReadinessDeadline.find({
      userId,
      status: { $in: ACTIVE_DEADLINE_STATUSES },
      dueDate: { $gte: start, $lte: end },
    })
      .sort({ dueDate: 1 })
      .lean(),

    ReadinessTask.find({
      userId,
      calendarType: "preparation",
      scheduledDate: { $gte: start, $lte: end },
      status: { $in: OPEN_TASK_STATUSES },
    })
      .populate("deadlineId")
      .sort({ scheduledDate: 1, startTime: 1, priority: -1 })
      .lean(),
  ]);

  const readiness = readinessRaw.filter((task) =>
    taskBelongsToCurrentDeadline(task, start)
  );

  const officialEvents = official.map((deadline) => {
    const eventTimezone = deadline.timezone || timezone;
    const date = deadlineDateKey(deadline, timezone);
    const time =
      deadline.dueTime ||
      formatTimeInTimezone(deadline.dueDate, eventTimezone);

    return {
      id: String(deadline._id),
      _id: deadline._id,
      calendarType: "official",
      calendar: "calendar1",

      title: deadline.title,
      type: deadline.type,
      courseCode: deadline.courseCode || "",
      courseTitle: deadline.courseTitle || "",

      date,
      dateKey: date,
      dueDate: deadline.dueDate,
      dueTime: time,
      time,
      timezone: eventTimezone,

      topics: deadline.topics || [],
      source: deadline.source || "manual",
      status: deadline.status,
      riskLevel: deadline.riskLevel || "Medium",
      readinessScore: deadline.readinessScore || 0,
      description: deadline.description || "",
    };
  });

  const readinessEvents = readiness.map((task) => {
    const date = taskDateKey(task, timezone);

    return {
      id: String(task._id),
      _id: task._id,
      calendarType: "readiness",
      calendar: "calendar2",

      deadlineId: String(task.deadlineId?._id || task.deadlineId || ""),

      title: task.title,
      type: task.type,

      courseCode: task.courseCode || task.deadlineId?.courseCode || "",
      courseTitle: task.courseTitle || task.deadlineId?.courseTitle || "",
      deadlineTitle: task.deadlineTitle || task.deadlineId?.title || "",

      date,
      dateKey: date,
      scheduledDate: task.scheduledDate,
      startTime: task.startTime,
      time: task.startTime,
      timezone,

      durationMinutes: task.durationMinutes,
      status: task.status,
      topic: task.topic,
      topics: task.topics || [],
      reason: task.reason,
      instructions: task.instructions,
      expectedOutput: task.expectedOutput,
      priority: task.priority,
      mode: task.mode,
      aiGenerated: task.aiGenerated,
    };
  });

  const loadByDay = {};

  for (const task of readinessEvents) {
    loadByDay[task.date] =
      (loadByDay[task.date] || 0) + Number(task.durationMinutes || 0);
  }

  return {
    timezone,
    window: {
      from: start,
      to: end,
      fromKey: formatDateInTimezone(start, timezone),
      toKey: formatDateInTimezone(end, timezone),
      days,
    },
    planning,
    officialEvents,
    readinessEvents,
    taskEvents: readinessEvents,
    summary: {
      officialCount: officialEvents.length,
      readinessCount: readinessEvents.length,
      taskCount: readinessEvents.length,
      totalStudyMinutes: Object.values(loadByDay).reduce(
        (sum, value) => sum + value,
        0
      ),
      loadByDay,
    },
  };
}

export async function exportIcs(query = {}) {
  const userId = requireUserId(query);
  const timezone = await getUserTimezone(userId, query.timezone || query.tz);

  const [official, readiness] = await Promise.all([
    getOfficialCalendar({ ...query, timezone }),
    getReadinessCalendar({ ...query, timezone }),
  ]);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Readiness Coach//Deadline Recovery AI//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-TIMEZONE:${timezone}`,
  ];

  for (const deadline of official.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:deadline-${deadline._id}@readiness-coach`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(deadline.dueDate)}`,
      `SUMMARY:${String(
        `${deadline.courseCode ? `${deadline.courseCode} ` : ""}${
          deadline.title
        }`
      ).replace(/\n/g, " ")}`,
      `DESCRIPTION:${String(
        deadline.description || "Official deadline"
      ).replace(/\n/g, "\\n")}`,
      "END:VEVENT"
    );
  }

  for (const task of readiness.events) {
    const start =
      zonedDateTimeToDate(
        task.date || task.scheduledDate,
        task.startTime || "19:00",
        timezone
      ) ||
      applyTimeToDate(task.scheduledDate, task.startTime || "19:00");

    const end = new Date(
      start.getTime() + Number(task.durationMinutes || 25) * 60000
    );

    lines.push(
      "BEGIN:VEVENT",
      `UID:task-${task._id}@readiness-coach`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${String(task.title).replace(/\n/g, " ")}`,
      `DESCRIPTION:${String(clean(task.reason, "AI preparation task")).replace(
        /\n/g,
        "\\n"
      )}`,
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");

  return {
    fileName: `readiness-coach-${userId}.ics`,
    content: lines.join("\r\n"),
  };
}