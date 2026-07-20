import ReadinessDeadline from "../../models/ReadinessDeadline.js";

import {
  normalizeTimezone,
  zonedDateTimeToDate,
  startOfDayInTimezone,
  endOfDayInTimezone,
} from "./readinessTimezone.util.js";

import {
  clean,
  makeError,
  requireObjectId,
  requireUserId,
} from "./readinessDate.util.js";

const ACTIVE_STATUSES = ["active", "pending", "in_progress", "missed"];

const ALLOWED_TYPES = [
  "assignment",
  "quiz",
  "exam",
  "project",
  "lab",
  "presentation",
  "reading",
  "other",
];

const ALLOWED_STATUSES = [
  "active",
  "pending",
  "in_progress",
  "missed",
  "completed",
  "archived",
  "cancelled",
];

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  const n = toNumber(value, min);
  return Math.max(min, Math.min(max, n));
}

function normalizeType(value = "assignment") {
  const type = clean(value, "assignment").toLowerCase();
  return ALLOWED_TYPES.includes(type) ? type : "other";
}

function normalizeStatus(value = "active") {
  const status = clean(value, "active").toLowerCase();
  return ALLOWED_STATUSES.includes(status) ? status : "active";
}

function normalizeTime(value = "23:59") {
  const raw = clean(value, "23:59");

  const amPmMatch = raw.match(/^(\d{1,2})(?::|\.?)(\d{2})?\s*(am|pm)$/i);
  if (amPmMatch) {
    let hour = Number(amPmMatch[1]);
    const minute = Number(amPmMatch[2] || 0);
    const ampm = amPmMatch[3].toLowerCase();

    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;

    return `${String(clamp(hour, 0, 23)).padStart(2, "0")}:${String(
      clamp(minute, 0, 59)
    ).padStart(2, "0")}`;
  }

  const match = raw.match(/^(\d{1,2})[:.](\d{2})/);
  if (!match) return "23:59";

  const hour = clamp(match[1], 0, 23);
  const minute = clamp(match[2], 0, 59);

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeTopics(value = []) {
  if (Array.isArray(value)) {
    return value.map((item) => clean(item)).filter(Boolean).slice(0, 30);
  }

  return clean(value)
    .split(/[,;\n|]/)
    .map((item) => clean(item))
    .filter(Boolean)
    .slice(0, 30);
}

function parseDueDate(value, dueTime = "23:59", timezone = "Asia/Dhaka") {
  if (!value) {
    throw makeError("dueDate is required.", 400, "due_date_required");
  }

  const timezoneSafe = normalizeTimezone(timezone || "Asia/Dhaka");
  const timeSafe = normalizeTime(dueTime);

  if (value instanceof Date) {
    const dateOnly = value.toISOString().slice(0, 10);
    const zoned = zonedDateTimeToDate(dateOnly, timeSafe, timezoneSafe);
    if (zoned && !Number.isNaN(zoned.getTime())) return zoned;
  }

  const rawText = String(value || "").trim();

  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(rawText)) {
    const zoned = zonedDateTimeToDate(
      rawText.slice(0, 10),
      timeSafe,
      timezoneSafe
    );
    if (zoned && !Number.isNaN(zoned.getTime())) return zoned;
  }

  const raw = new Date(value);
  if (Number.isNaN(raw.getTime())) {
    throw makeError("Invalid dueDate. Use YYYY-MM-DD.", 400, "invalid_due_date");
  }

  return raw;
}

function getRiskLevel({ dueDate, difficulty, readinessScore, status }) {
  if (["completed", "archived", "cancelled"].includes(status)) return "Low";

  const now = new Date();
  const due = new Date(dueDate);
  const diffMs = due.getTime() - now.getTime();
  const daysLeft = Math.ceil(diffMs / 86400000);

  if (daysLeft < 0) return "Critical";
  if (daysLeft <= 1) return "Critical";
  if (daysLeft <= 3) {
    return difficulty >= 4 || readinessScore < 45 ? "Critical" : "High";
  }
  if (daysLeft <= 7) {
    return difficulty >= 4 || readinessScore < 55 ? "High" : "Medium";
  }
  if (difficulty >= 5 || readinessScore < 45) return "High";

  return "Medium";
}

function getNextAction(deadline) {
  const type = deadline.type || "assignment";

  if (deadline.status === "completed") return "Completed.";
  if (deadline.status === "archived") return "Archived.";
  if (deadline.status === "cancelled") return "Cancelled.";

  const actionMap = {
    assignment:
      "Break the assignment into outline, work, check, and submit blocks.",
    quiz: "Review topics and create short practice blocks before quiz day.",
    exam: "Start concept revision, practice, and mock blocks early.",
    project: "Plan implementation, testing, and final submission checkpoints.",
    lab: "Practice the lab steps and prepare required output.",
    presentation: "Prepare slides, rehearse, and check final delivery.",
    reading: "Split reading into small daily sections.",
    other: "Generate a preparation plan from this deadline.",
  };

  return actionMap[type] || actionMap.other;
}

function normalizeDeadlinePayload(payload = {}, existing = null) {
  const timezone = normalizeTimezone(
    payload.timezone ?? existing?.timezone ?? "Asia/Dhaka"
  );

  const dueTime = normalizeTime(payload.dueTime ?? existing?.dueTime ?? "23:59");

  const dueDate = parseDueDate(
    payload.dueDate ?? existing?.dueDate,
    dueTime,
    timezone
  );

  const type = normalizeType(payload.type ?? existing?.type ?? "assignment");
  const status = normalizeStatus(payload.status ?? existing?.status ?? "active");

  const readinessScore = clamp(
    payload.readinessScore ?? existing?.readinessScore ?? 0,
    0,
    100
  );

  const difficulty = clamp(
    payload.difficulty ?? existing?.difficulty ?? 3,
    1,
    5
  );

  const patch = {
    source: clean(payload.source ?? existing?.source ?? "manual", "manual"),

    university: clean(payload.university ?? existing?.university ?? ""),
    department: clean(payload.department ?? existing?.department ?? ""),
    courseCode: clean(payload.courseCode ?? existing?.courseCode ?? ""),
    courseTitle: clean(payload.courseTitle ?? existing?.courseTitle ?? ""),
    section: clean(payload.section ?? existing?.section ?? ""),
    instructor: clean(payload.instructor ?? existing?.instructor ?? ""),

    title: clean(payload.title ?? existing?.title ?? "", "Untitled deadline"),
    type,
    status,

    dueDate,
    dueTime,
    timezone,

    topics:
      payload.topics !== undefined
        ? normalizeTopics(payload.topics)
        : normalizeTopics(existing?.topics || []),

    difficulty,
    estimatedHours: clamp(
      payload.estimatedHours ?? existing?.estimatedHours ?? 3,
      0.25,
      200
    ),
    weightPercent: clamp(
      payload.weightPercent ?? existing?.weightPercent ?? 0,
      0,
      100
    ),

    readinessScore,

    description: clean(payload.description ?? existing?.description ?? ""),
    materialsText: clean(payload.materialsText ?? existing?.materialsText ?? ""),
    url: clean(payload.url ?? existing?.url ?? ""),

    nextAction: "",
    riskLevel: "Medium",
  };

  patch.riskLevel = getRiskLevel({
    dueDate: patch.dueDate,
    difficulty: patch.difficulty,
    readinessScore: patch.readinessScore,
    status: patch.status,
  });

  patch.nextAction = getNextAction(patch);

  return patch;
}

export async function createDeadline(payload = {}) {
  const userId = requireUserId(payload);
  const patch = normalizeDeadlinePayload(payload);

  const deadline = await ReadinessDeadline.create({
    userId,
    ...patch,
  });

  return {
    deadline,
    message:
      "Calendar 1 deadline saved. AI was not called. Click Generate 30 Days to create Calendar 2.",
  };
}

export async function listDeadlines(query = {}) {
  const userId = requireUserId(query);

  const timezone = normalizeTimezone(query.timezone || query.tz || "Asia/Dhaka");
  const filter = { userId };

  if (query.status) {
    filter.status = normalizeStatus(query.status);
  } else if (query.includeArchived !== true && query.includeArchived !== "true") {
    filter.status = { $in: ACTIVE_STATUSES };
  }

  if (query.type) {
    filter.type = normalizeType(query.type);
  }

  if (query.courseCode) {
    filter.courseCode = new RegExp(clean(query.courseCode), "i");
  }

  if (query.source) {
    filter.source = clean(query.source);
  }

  if (query.from || query.to) {
    filter.dueDate = {};
    if (query.from) {
      filter.dueDate.$gte = startOfDayInTimezone(query.from, timezone);
    }
    if (query.to) {
      filter.dueDate.$lte = endOfDayInTimezone(query.to, timezone);
    }
  } else if (query.includePast !== true && query.includePast !== "true") {
    filter.dueDate = {
      $gte: startOfDayInTimezone(new Date(), timezone),
    };
  }

  const limit = clamp(query.limit || 200, 1, 500);

  const deadlines = await ReadinessDeadline.find(filter)
    .sort({ dueDate: 1, riskLevel: -1, createdAt: -1 })
    .limit(limit);

  return {
    deadlines,
    count: deadlines.length,
  };
}

export async function updateDeadline(deadlineId, payload = {}) {
  const userId = requireUserId(payload);
  const _id = requireObjectId(deadlineId, "deadlineId");

  const deadline = await ReadinessDeadline.findOne({ _id, userId });

  if (!deadline) {
    throw makeError("Deadline not found.", 404, "deadline_not_found");
  }

  const patch = normalizeDeadlinePayload(payload, deadline);

  Object.assign(deadline, patch);
  await deadline.save();

  return {
    deadline,
    message:
      "Calendar 1 deadline updated. AI was not called. Click Generate 30 Days to rebuild Calendar 2.",
  };
}

export async function deleteDeadline(deadlineId, payload = {}) {
  const userId = requireUserId(payload);
  const _id = requireObjectId(deadlineId, "deadlineId");

  const deadline = await ReadinessDeadline.findOneAndDelete({ _id, userId });

  if (!deadline) {
    throw makeError("Deadline not found.", 404, "deadline_not_found");
  }

  return {
    deleted: true,
    deadlineId,
    message:
      "Calendar 1 deadline deleted. AI was not called. Click Generate 30 Days to rebuild Calendar 2 if needed.",
  };
}

export async function upsertDeadlineFromSource(payload = {}) {
  const userId = requireUserId(payload);
  const patch = normalizeDeadlinePayload(payload);

  const source = clean(patch.source, "manual");
  const courseCode = clean(patch.courseCode);
  const title = clean(patch.title);

  const timezone = normalizeTimezone(patch.timezone || "Asia/Dhaka");
  const from = startOfDayInTimezone(patch.dueDate, timezone);
  const to = endOfDayInTimezone(patch.dueDate, timezone);

  const existing = await ReadinessDeadline.findOne({
    userId,
    source,
    courseCode,
    title,
    dueDate: { $gte: from, $lte: to },
  });

  if (existing) {
    Object.assign(existing, patch);
    await existing.save();

    return {
      created: false,
      updated: true,
      deadline: existing,
      message: "Calendar 1 deadline updated from source. AI was not called.",
    };
  }

  const deadline = await ReadinessDeadline.create({
    userId,
    ...patch,
  });

  return {
    created: true,
    updated: false,
    deadline,
    message: "Calendar 1 deadline created from source. AI was not called.",
  };
}