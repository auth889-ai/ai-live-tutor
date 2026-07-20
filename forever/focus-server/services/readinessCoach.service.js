import crypto from "crypto";
import { google } from "googleapis";

import ReadinessDeadline from "../models/ReadinessDeadline.js";
import ReadinessTask from "../models/ReadinessTask.js";
import ReadinessCheckin from "../models/ReadinessCheckin.js";
import ReadinessSmsReminder from "../models/ReadinessSmsReminder.js";
import ReadinessGoogleToken from "../models/ReadinessGoogleToken.js";
import ReadinessUserPreference from "../models/ReadinessUserPreference.js";
import ReadinessVoiceConversation from "../models/ReadinessVoiceConversation.js";
import ReadinessResource from "../models/ReadinessResource.js";

import {
  addDays,
  addMinutes,
  applyTimeToDate,
  clean,
  dateOnly,
  daysBetween,
  endOfDay,
  requireUserId,
  ymd,
} from "./readiness/readinessDate.util.js";

import {
  normalizeTimezone,
  countryFromTimezone,
} from "./readiness/readinessTimezone.util.js";

import { callReadinessGemma } from "./readiness/readinessAi.service.js";

import {
  createDeadline,
  listDeadlines,
  updateDeadline,
  deleteDeadline,
} from "./readiness/readinessDeadline.service.js";

import {
  generateReadinessPlan,
  createReadinessTask,
  updateReadinessTask,
  deleteReadinessTask,
  getPlanningPreferences,
  updatePlanningPreferences,
} from "./readiness/readinessPlanner.service.js";

import {
  regenerateRecoveryPlan,
  checkinTask as baseCheckinTask,
} from "./readiness/readinessRecovery.service.js";

import {
  getToday,
  getOfficialCalendar,
  getReadinessCalendar,
  getTwoCalendar,
  exportIcs,
} from "./readiness/readinessCalendar.service.js";

import { getDashboard } from "./readiness/readinessDashboard.service.js";
import {
  getHeavyWeeks,
  smoothHeavyWeeks,
} from "./readiness/readinessHeavyWeek.service.js";

import {
  buildVoiceMemoryContext,
  updateVoiceMemoryAfterTurn,
} from "./readiness/readinessVoiceMemory.service.js";

import {
  normalizeNotificationIntelligence,
  runNotificationIntelligenceScheduler,
} from "./readiness/readinessNotificationIntelligence.service.js";

import { recalculateDeadlineReadiness } from "./readiness/readinessScore.service.js";

const DEFAULT_TIMEZONE = process.env.READINESS_DEFAULT_TIMEZONE || "Asia/Dhaka";

function normalizeSmsReply(text = "") {
  const value = clean(text).toLowerCase();

  if (["done", "d", "yes", "y", "complete", "completed"].includes(value)) {
    return "done";
  }

  if (["half", "half done", "partial", "half_done"].includes(value)) {
    return "half_done";
  }

  if (["help", "h", "confused", "stuck"].includes(value)) {
    return "confused";
  }

  if (["skip", "s"].includes(value)) {
    return "skip";
  }

  if (["not", "not started", "no", "n", "missed"].includes(value)) {
    return "not_started";
  }

  return "";
}

function normalizePlanningPatch(planning = {}) {
  const defaultSlots = ["09:00", "12:00", "15:00", "18:00", "20:00"];

  const rawSlots =
    Array.isArray(planning.timeSlots) && planning.timeSlots.length
      ? planning.timeSlots
      : defaultSlots;

  const timeSlots = [...new Set(rawSlots)]
    .map((slot) => String(slot || "").trim())
    .filter((slot) => /^([01]\d|2[0-3]):[0-5]\d$/.test(slot))
    .sort();

  return {
    timeSlots: timeSlots.length ? timeSlots : defaultSlots,
    maxDailyStudyMinutes: Number(planning.maxDailyStudyMinutes || 150),
    softDailyWorkloadMinutes: Number(planning.softDailyWorkloadMinutes || 120),
    planningWindowDays: Number(planning.planningWindowDays || 30),
    recentOverdueDays: Number(planning.recentOverdueDays || 7),
  };
}

function defaultPreferencePayload(userId) {
  return {
    userId,
    timezone: DEFAULT_TIMEZONE,
    country: countryFromTimezone(DEFAULT_TIMEZONE),
    locale: "en-BD",
    smsEnabled: false,
    phone: "",
    voiceEnabled: true,
    googleCalendarSyncEnabled: false,
    googleCalendarId: "primary",
    dailyCheckin: {
      enabled: true,
      time: "19:00",
      reminderWindowMinutes: 120,
    },
    heavyWeek: {
      enabled: true,
      lookaheadDays: 10,
      thresholdCount: 3,
      thresholdWorkHours: 8,
    },
    coaching: {
      tone: "balanced",
      language: "mixed",
      maxDailyStudyMinutes: 150,
      preferredStudyStart: "19:00",
      preferredStudyEnd: "23:00",
    },
    planning: {
      timeSlots: ["09:00", "12:00", "15:00", "18:00", "20:00"],
      maxDailyStudyMinutes: 150,
      softDailyWorkloadMinutes: 120,
      planningWindowDays: 30,
      recentOverdueDays: 7,
    },
    notificationIntelligence: normalizeNotificationIntelligence({}),
  };
}

/**
 * Safe preference creator.
 *
 * This avoids:
 * 1. Updating the path 'timezone' would create a conflict at 'timezone'
 * 2. E11000 duplicate key error on userId
 *
 * We do NOT use findOneAndUpdate({ upsert:true }) for preference anymore.
 */
async function getOrCreateReadinessPreference(userId) {
  let preference = await ReadinessUserPreference.findOne({ userId });

  if (preference) return preference;

  try {
    preference = await ReadinessUserPreference.create(defaultPreferencePayload(userId));
    return preference;
  } catch (error) {
    if (error?.code === 11000) {
      preference = await ReadinessUserPreference.findOne({ userId });
      if (preference) return preference;
    }

    throw error;
  }
}

function riskRank(deadline) {
  const riskScore =
    deadline.riskLevel === "Critical"
      ? 100
      : deadline.riskLevel === "High"
        ? 80
        : deadline.riskLevel === "Medium"
          ? 50
          : 25;

  const urgency = Math.max(0, 30 - daysBetween(new Date(), deadline.dueDate) * 3);
  const difficulty = Number(deadline.difficulty || 3) * 5;
  const unreadiness = 100 - Number(deadline.readinessScore || 0);
  const examBoost = ["exam", "quiz"].includes(deadline.type) ? 18 : 0;
  const weightBoost = Number(deadline.weightPercent || 0) / 2;

  return riskScore + urgency + difficulty + unreadiness + examBoost + weightBoost;
}

function buildDeadlineEvent(deadline, timezone = DEFAULT_TIMEZONE) {
  const start = new Date(deadline.dueDate);
  const end = addMinutes(start, 60);
  const privateId = `readiness-deadline-${deadline._id}`;
  const tz = normalizeTimezone(deadline.timezone || timezone || DEFAULT_TIMEZONE);

  return {
    summary: `${deadline.courseCode || deadline.courseTitle || "Course"}: ${deadline.title}`,
    description: [
      "Readiness Coach official deadline",
      `Type: ${deadline.type}`,
      `Timezone: ${tz}`,
      `Readiness: ${deadline.readinessScore || 0}%`,
      `Risk: ${deadline.riskLevel || "High"}`,
      deadline.nextAction ? `Next action: ${deadline.nextAction}` : "",
      deadline.url ? `Link: ${deadline.url}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    start: {
      dateTime: start.toISOString(),
      timeZone: tz,
    },
    end: {
      dateTime: end.toISOString(),
      timeZone: tz,
    },
    extendedProperties: {
      private: {
        readinessId: privateId,
        readinessKind: "deadline",
        deadlineId: String(deadline._id),
      },
    },
  };
}

function buildTaskEvent(task, timezone = DEFAULT_TIMEZONE) {
  const start = applyTimeToDate(task.scheduledDate, task.startTime || "19:00");
  const end = addMinutes(start, Number(task.durationMinutes || 25));
  const privateId = `readiness-task-${task._id}`;
  const tz = normalizeTimezone(task.timezone || timezone || DEFAULT_TIMEZONE);

  return {
    summary: `${task.courseCode || "Study"}: ${task.title}`,
    description: [
      "Readiness Coach AI preparation task",
      `Timezone: ${tz}`,
      task.deadlineTitle ? `Deadline: ${task.deadlineTitle}` : "",
      task.topic ? `Topic: ${task.topic}` : "",
      `Duration: ${task.durationMinutes || 25} min`,
      task.reason ? `Reason: ${task.reason}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    start: {
      dateTime: start.toISOString(),
      timeZone: tz,
    },
    end: {
      dateTime: end.toISOString(),
      timeZone: tz,
    },
    extendedProperties: {
      private: {
        readinessId: privateId,
        readinessKind: "task",
        taskId: String(task._id),
        deadlineId: String(task.deadlineId),
      },
    },
  };
}

async function getGoogleCalendarClient(userId) {
  const token = await ReadinessGoogleToken.findOne({ userId });

  if (!token?.accessToken && !token?.refreshToken) {
    throw new Error("Google is not connected. Connect Google Classroom/Calendar first.");
  }

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  client.setCredentials({
    access_token: token.accessToken || undefined,
    refresh_token: token.refreshToken || undefined,
    expiry_date: token.expiryDate || undefined,
    token_type: token.tokenType || "Bearer",
    scope: token.scope || undefined,
  });

  client.on("tokens", async (tokens) => {
    const update = {};

    if (tokens.access_token) update.accessToken = tokens.access_token;
    if (tokens.refresh_token) update.refreshToken = tokens.refresh_token;
    if (tokens.expiry_date) update.expiryDate = tokens.expiry_date;
    if (tokens.scope) update.scope = tokens.scope;
    if (tokens.token_type) update.tokenType = tokens.token_type;

    if (Object.keys(update).length) {
      await ReadinessGoogleToken.updateOne({ userId }, { $set: update });
    }
  });

  return google.calendar({ version: "v3", auth: client });
}

async function findExistingCalendarEvent({ calendar, calendarId, readinessId }) {
  const response = await calendar.events.list({
    calendarId,
    privateExtendedProperty: `readinessId=${readinessId}`,
    maxResults: 10,
    singleEvents: true,
  });

  return response.data.items?.[0] || null;
}

async function listCalendarConflicts({ calendar, calendarId, startIso, endIso, ignoreEventId }) {
  const response = await calendar.events.list({
    calendarId,
    timeMin: startIso,
    timeMax: endIso,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 10,
  });

  return (response.data.items || []).filter((event) => {
    if (ignoreEventId && event.id === ignoreEventId) return false;

    const privateProps = event.extendedProperties?.private || {};
    if (privateProps.readinessId) return false;

    return event.status !== "cancelled";
  });
}

async function generateConfusedHelpPack({ userId, task, deadline }) {
  const topic = clean(
    task.topic || deadline?.weakTopics?.[0] || deadline?.topics?.[0],
    task.title
  );

  const existingResources = await ReadinessResource.find({
    $or: [
      { userId, topic },
      { public: true, topic },
      { courseCode: task.courseCode || "", topic },
    ],
  })
    .sort({ vouchCount: -1, createdAt: -1 })
    .limit(6);

  const fallback = {
    title: `${topic} Help Pack`,
    weakTopic: topic,
    items: [
      {
        type: "explanation",
        title: "5-minute base explanation",
        action: `Read the smallest explanation for ${topic}.`,
      },
      {
        type: "visual",
        title: "Visual note",
        action: "Draw one diagram/call-stack/concept map.",
      },
      {
        type: "example",
        title: "3 dry-run examples",
        action: "Trace three tiny examples by hand.",
      },
      {
        type: "practice",
        title: "5 beginner problems",
        action: "Solve only easy problems first.",
      },
      {
        type: "teacher_template",
        title: "Teacher question template",
        action: `Ask: “I understand the definition, but I get stuck applying ${topic}. Can you show one example?”`,
      },
    ],
    voiceText: `${topic} কঠিন লাগা normal. আগে একদম ছোট example দেখো, তারপর শুধু ২টা easy practice করো।`,
    resources: existingResources.map((resource) => ({
      title: resource.title,
      type: resource.type,
      url: resource.url,
      trustLevel: resource.trustLevel,
      vouchCount: resource.vouchCount,
    })),
  };

  return callReadinessGemma(
    `Return JSON only:
{
  "title": "help pack title",
  "weakTopic": "topic",
  "items": [
    {"type":"explanation|visual|example|practice|teacher_template","title":"short title","action":"specific action"}
  ],
  "voiceText": "short supportive spoken line",
  "resources": [{"title":"resource title","type":"video|article|note|problem|template|other","url":"","trustLevel":"Low|Medium|High","vouchCount":0}]
}

Student selected CONFUSED.

Context:
${JSON.stringify({
  task: {
    title: task.title,
    topic: task.topic,
    durationMinutes: task.durationMinutes,
  },
  deadline: deadline
    ? {
        title: deadline.title,
        dueDate: deadline.dueDate,
        courseCode: deadline.courseCode,
        topics: deadline.topics,
        materialsText: deadline.materialsText?.slice(0, 4000),
      }
    : null,
  existingResources: fallback.resources,
})}

Rules:
- No guilt.
- Must include visual, examples, beginner practice, teacher question template.
- Use existing resources if available.
- If no URL, keep action-based resource.`,
    fallback,
    {
      system:
        "You are a Readiness Coach. Build a concrete Help Pack for a confused student.",
      temperature: 0.18,
    }
  );
}

async function checkinTask(taskId, payload = {}) {
  const result = await baseCheckinTask(taskId, payload);

  const task = await ReadinessTask.findById(taskId);
  const answer = clean(payload.answer);

  if (!task?.deadlineId) return result;

  const deadline = await recalculateDeadlineReadiness(task.deadlineId);

  if (answer === "confused") {
    const helpPack = await generateConfusedHelpPack({
      userId: task.userId,
      task,
      deadline,
    });

    await ReadinessCheckin.findOneAndUpdate(
      { taskId: task._id },
      {
        $set: {
          helpPack,
          voiceText:
            helpPack.voiceText ||
            "Confused হওয়া normal. আগে শুধু একটা easy example দেখো, তারপর ছোট practice করো।",
        },
      },
      { sort: { createdAt: -1 }, new: true }
    );

    return {
      ...result,
      helpPack,
    };
  }

  return result;
}

async function scheduleSms(payload = {}) {
  const userId = requireUserId(payload);
  const phone = clean(payload.phone);

  if (!phone) {
    throw new Error("phone is required.");
  }

  const reminder = await ReadinessSmsReminder.create({
    userId,
    phone,
    taskId: payload.taskId || null,
    deadlineId: payload.deadlineId || null,
    kind: clean(payload.kind, "manual"),
    message: clean(payload.message, "Readiness Coach reminder."),
    sendAt: payload.sendAt ? new Date(payload.sendAt) : new Date(),
    status: "pending",
    provider: "twilio",
    metadata: payload.metadata || {},
  });

  return { reminder };
}

async function handleSmsReply(payload = {}) {
  const phone = clean(payload.From || payload.from || payload.phone);
  const body = clean(payload.Body || payload.body);
  const normalized = normalizeSmsReply(body);

  if (!phone) {
    return { matched: false, message: "phone/from is required." };
  }

  const reminder = await ReadinessSmsReminder.findOne({
    phone,
    status: { $in: ["sent", "pending"] },
  }).sort({ sentAt: -1, createdAt: -1 });

  if (!reminder) {
    return { matched: false, message: "No reminder matched." };
  }

  reminder.reply.raw = body;
  reminder.reply.normalized = normalized;
  reminder.reply.receivedAt = new Date();

  let checkin = null;

  try {
    if (reminder.taskId && normalized) {
      checkin = await checkinTask(reminder.taskId, {
        userId: reminder.userId,
        answer: normalized,
        blockedReason: normalized === "confused" ? "topic_confusing" : "",
        note: `SMS reply: ${body}`,
        source: "sms",
      });
    }

    reminder.reply.processed = true;
  } catch (error) {
    reminder.reply.processError = error?.message || "SMS reply process failed.";
  }

  await reminder.save();

  return {
    matched: true,
    reminder,
    checkin,
    message: normalized ? "SMS reply processed." : "SMS reply saved, but command not recognized.",
  };
}

async function getReadinessPreferences(query = {}) {
  const userId = requireUserId(query);
  const preference = await getOrCreateReadinessPreference(userId);

  return {
    preference,
    timezone: preference.timezone,
    country: preference.country,
  };
}

async function upsertReadinessPreferences(payload = {}) {
  const userId = requireUserId(payload);
  const preference = await getOrCreateReadinessPreference(userId);

  const patch = {};

  if (payload.timezone !== undefined || payload.country !== undefined) {
    const timezone = normalizeTimezone(
      payload.timezone || payload.country || DEFAULT_TIMEZONE
    );

    patch.timezone = timezone;
    patch.country = countryFromTimezone(timezone);
  }

  if (payload.locale !== undefined) {
    patch.locale = clean(payload.locale, "en-BD");
  }

  if (payload.phone !== undefined) {
    patch.phone = clean(payload.phone);
  }

  if (payload.smsEnabled !== undefined) {
    patch.smsEnabled = Boolean(payload.smsEnabled);
  }

  if (payload.voiceEnabled !== undefined) {
    patch.voiceEnabled = Boolean(payload.voiceEnabled);
  }

  if (payload.googleCalendarSyncEnabled !== undefined) {
    patch.googleCalendarSyncEnabled = Boolean(payload.googleCalendarSyncEnabled);
  }

  if (payload.googleCalendarId !== undefined) {
    patch.googleCalendarId = clean(payload.googleCalendarId, "primary");
  }

  if (payload.dailyCheckin) {
    patch.dailyCheckin = {
      enabled: payload.dailyCheckin.enabled !== false,
      time: clean(payload.dailyCheckin.time, "19:00"),
      reminderWindowMinutes: Number(payload.dailyCheckin.reminderWindowMinutes || 120),
    };
  }

  if (payload.heavyWeek) {
    patch.heavyWeek = {
      enabled: payload.heavyWeek.enabled !== false,
      lookaheadDays: Number(payload.heavyWeek.lookaheadDays || 10),
      thresholdCount: Number(payload.heavyWeek.thresholdCount || 3),
      thresholdWorkHours: Number(payload.heavyWeek.thresholdWorkHours || 8),
    };
  }

  if (payload.coaching) {
    patch.coaching = {
      tone: clean(payload.coaching.tone, "balanced"),
      language: clean(payload.coaching.language, "mixed"),
      maxDailyStudyMinutes: Number(payload.coaching.maxDailyStudyMinutes || 150),
      preferredStudyStart: clean(payload.coaching.preferredStudyStart, "19:00"),
      preferredStudyEnd: clean(payload.coaching.preferredStudyEnd, "23:00"),
    };
  }

  if (payload.planning) {
    patch.planning = normalizePlanningPatch(payload.planning);
  }

  if (payload.notificationIntelligence) {
    patch.notificationIntelligence = normalizeNotificationIntelligence(
      payload.notificationIntelligence
    );
  }

  Object.assign(preference, patch);
  await preference.save();

  return {
    preference,
    timezone: preference.timezone,
    country: preference.country,
    message: `Timezone saved: ${preference.timezone}`,
  };
}

async function generateDailyReadinessReminders(payload = {}) {
  const userId = requireUserId(payload);
  const { preference } = await getReadinessPreferences({ userId });

  if (!preference.smsEnabled || !preference.phone) {
    return {
      created: 0,
      reminders: [],
      message: "SMS disabled or phone missing.",
    };
  }

  const targetDate = dateOnly(payload.date || new Date());
  const start = dateOnly(targetDate);
  const end = endOfDay(targetDate);

  const tasks = await ReadinessTask.find({
    userId,
    status: "planned",
    scheduledDate: { $gte: start, $lte: end },
    "reminder.enabled": { $ne: false },
  })
    .populate("deadlineId")
    .sort({ priority: -1, durationMinutes: 1, startTime: 1 });

  const reminders = [];

  for (const task of tasks) {
    const deadline =
      task.deadlineId && typeof task.deadlineId === "object" ? task.deadlineId : null;

    const existing = await ReadinessSmsReminder.findOne({
      userId,
      taskId: task._id,
      kind: "daily_checkin",
      sendAt: { $gte: start, $lte: end },
      status: { $in: ["pending", "sent"] },
    });

    if (existing) {
      reminders.push(existing);
      continue;
    }

    const daysLeft = deadline ? daysBetween(new Date(), deadline.dueDate) : null;

    const message = [
      `${task.courseCode || "Study"}: Today ${task.durationMinutes || 25}-min ${
        task.topic || task.title
      }.`,
      deadline ? `${deadline.title} in ${daysLeft} day(s).` : "",
      "Reply DONE / HALF / HELP / SKIP.",
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 320);

    const sendAt = applyTimeToDate(targetDate, preference.dailyCheckin?.time || "19:00");

    const reminder = await ReadinessSmsReminder.create({
      userId,
      phone: preference.phone,
      taskId: task._id,
      deadlineId: deadline?._id || task.deadlineId,
      kind: "daily_checkin",
      message,
      sendAt,
      status: "pending",
      provider: "twilio",
      metadata: {
        date: ymd(targetDate),
        generatedBy: "daily_reminder_engine",
        timezone: preference.timezone,
      },
    });

    task.reminder.smsSentForDate = ymd(targetDate);
    task.reminder.lastReminderAt = new Date();
    await task.save();

    reminders.push(reminder);
  }

  return {
    created: reminders.length,
    reminders,
    message: `Generated ${reminders.length} daily readiness reminder(s).`,
  };
}

async function generateHeavyWeekReminders(payload = {}) {
  const userId = requireUserId(payload);
  const { preference } = await getReadinessPreferences({ userId });

  if (!preference.smsEnabled || !preference.phone) {
    return {
      created: 0,
      reminders: [],
      message: "SMS disabled or phone missing.",
    };
  }

  const heavy = await getHeavyWeeks({ userId });
  const heavyWeeks = heavy.weeks.filter((week) => week.isHeavy);

  if (!heavyWeeks.length) {
    return {
      created: 0,
      reminders: [],
      message: "No heavy week detected.",
    };
  }

  const reminders = [];

  for (const week of heavyWeeks.slice(0, 2)) {
    const firstDeadline = week.deadlines?.[0];

    const existing = await ReadinessSmsReminder.findOne({
      userId,
      kind: "heavy_week",
      "metadata.weekKey": week.key,
      status: { $in: ["pending", "sent"] },
    });

    if (existing) {
      reminders.push(existing);
      continue;
    }

    const message = `Heavy week detected: ${week.count} deadlines. Start early today: ${
      firstDeadline?.courseCode || firstDeadline?.courseTitle || "Course"
    } - ${firstDeadline?.title || "first risky deadline"}. Reply HELP if stuck.`;

    const reminder = await ReadinessSmsReminder.create({
      userId,
      phone: preference.phone,
      deadlineId: firstDeadline?._id || null,
      kind: "heavy_week",
      message: message.slice(0, 320),
      sendAt: payload.sendAt ? new Date(payload.sendAt) : new Date(Date.now() + 2 * 60 * 1000),
      status: "pending",
      provider: "twilio",
      metadata: {
        weekKey: week.key,
        from: week.from,
        to: week.to,
        generatedBy: "heavy_week_engine",
        timezone: preference.timezone,
      },
    });

    reminders.push(reminder);
  }

  return {
    created: reminders.length,
    reminders,
    heavyWeeks,
    message: `Generated ${reminders.length} heavy-week reminder(s).`,
  };
}

async function runReadinessReminderSchedulerOnce(payload = {}) {
  const now = new Date();

  let preferences = [];

  if (payload.userId) {
    const { preference } = await getReadinessPreferences({ userId: payload.userId });
    preferences = [preference];
  } else {
    preferences = await ReadinessUserPreference.find({
      smsEnabled: true,
      phone: { $ne: "" },
    }).limit(Number(payload.limit || 100));
  }

  const results = [];

  for (const preference of preferences) {
    const userId = preference.userId;

    const daily = await generateDailyReadinessReminders({
      userId,
      date: payload.date || now,
    });

    const heavy = await generateHeavyWeekReminders({ userId });

    let smart = {
      skipped: true,
      reason: "Smart AI notification is disabled by default.",
    };

    if (process.env.READINESS_SMS_WORKER_ENABLE_INTELLIGENCE === "true") {
      smart = await runNotificationIntelligenceScheduler({
        userId,
        force: Boolean(payload.force),
        limit: 1,
      });
    }

    results.push({ userId, daily, heavy, smart });
  }

  return {
    usersChecked: preferences.length,
    results,
  };
}

async function syncReadinessToGoogleCalendar(payload = {}) {
  const userId = requireUserId(payload);
  const calendar = await getGoogleCalendarClient(userId);

  const { preference } = await getReadinessPreferences({ userId });
  const timezone = normalizeTimezone(
    payload.timezone || preference.timezone || DEFAULT_TIMEZONE
  );

  const calendarId = clean(payload.calendarId || preference.googleCalendarId, "primary");

  const from = dateOnly(payload.from || new Date());
  const to = payload.to ? endOfDay(payload.to) : addDays(from, 45);

  const deadlines = await ReadinessDeadline.find({
    userId,
    dueDate: { $gte: from, $lte: to },
  }).sort({ dueDate: 1 });

  const tasks = await ReadinessTask.find({
    userId,
    scheduledDate: { $gte: from, $lte: to },
  }).sort({ scheduledDate: 1, startTime: 1 });

  const deadlineResults = [];
  const taskResults = [];

  for (const deadline of deadlines) {
    try {
      const readinessId = `readiness-deadline-${deadline._id}`;

      if (deadline.status !== "active") {
        const eventId =
          deadline.googleCalendar?.officialEventId ||
          (await findExistingCalendarEvent({ calendar, calendarId, readinessId }))?.id;

        if (eventId) {
          await calendar.events.delete({ calendarId, eventId });
        }

        deadline.googleCalendar.officialEventId = "";
        deadline.googleCalendar.syncStatus = "not_synced";
        deadline.googleCalendar.lastSyncedAt = new Date();
        await deadline.save();

        deadlineResults.push({ ok: true, action: "deleted", deadlineId: deadline._id });
        continue;
      }

      const body = buildDeadlineEvent(deadline, timezone);
      const existing =
        deadline.googleCalendar?.officialEventId
          ? { id: deadline.googleCalendar.officialEventId }
          : await findExistingCalendarEvent({ calendar, calendarId, readinessId });

      const conflicts = await listCalendarConflicts({
        calendar,
        calendarId,
        startIso: body.start.dateTime,
        endIso: body.end.dateTime,
        ignoreEventId: existing?.id,
      });

      let event;

      if (existing?.id) {
        event = await calendar.events.update({
          calendarId,
          eventId: existing.id,
          requestBody: body,
        });
      } else {
        event = await calendar.events.insert({
          calendarId,
          requestBody: body,
        });
      }

      deadline.googleCalendar.officialEventId = event.data.id;
      deadline.googleCalendar.lastSyncedAt = new Date();
      deadline.googleCalendar.syncStatus = conflicts.length ? "partial" : "synced";
      deadline.googleCalendar.syncError = conflicts.length
        ? `Conflict detected with ${conflicts.length} existing calendar event(s).`
        : "";

      await deadline.save();

      deadlineResults.push({
        ok: true,
        action: existing?.id ? "updated" : "created",
        deadlineId: deadline._id,
        eventId: event.data.id,
        timezone,
        conflicts: conflicts.map((item) => ({
          id: item.id,
          summary: item.summary,
          start: item.start,
          end: item.end,
        })),
      });
    } catch (error) {
      deadline.googleCalendar.syncStatus = "failed";
      deadline.googleCalendar.syncError = error?.message || "Calendar deadline sync failed.";
      await deadline.save();

      deadlineResults.push({
        ok: false,
        deadlineId: deadline._id,
        error: deadline.googleCalendar.syncError,
      });
    }
  }

  for (const task of tasks) {
    try {
      const readinessId = `readiness-task-${task._id}`;

      if (["cancelled", "skipped", "done"].includes(task.status)) {
        const eventId =
          task.googleCalendar?.googleEventId ||
          (await findExistingCalendarEvent({ calendar, calendarId, readinessId }))?.id;

        if (eventId) {
          await calendar.events.delete({ calendarId, eventId });
        }

        task.googleCalendar.googleEventId = "";
        task.googleCalendar.syncStatus = "not_synced";
        task.googleCalendar.lastSyncedAt = new Date();
        await task.save();

        taskResults.push({ ok: true, action: "deleted", taskId: task._id });
        continue;
      }

      const body = buildTaskEvent(task, timezone);
      const existing =
        task.googleCalendar?.googleEventId
          ? { id: task.googleCalendar.googleEventId }
          : await findExistingCalendarEvent({ calendar, calendarId, readinessId });

      const conflicts = await listCalendarConflicts({
        calendar,
        calendarId,
        startIso: body.start.dateTime,
        endIso: body.end.dateTime,
        ignoreEventId: existing?.id,
      });

      let event;

      if (existing?.id) {
        event = await calendar.events.update({
          calendarId,
          eventId: existing.id,
          requestBody: body,
        });
      } else {
        event = await calendar.events.insert({
          calendarId,
          requestBody: body,
        });
      }

      task.googleCalendar.googleEventId = event.data.id;
      task.googleCalendar.lastSyncedAt = new Date();
      task.googleCalendar.syncStatus = conflicts.length ? "failed" : "synced";
      task.googleCalendar.syncError = conflicts.length
        ? `Conflict detected with ${conflicts.length} existing calendar event(s).`
        : "";

      await task.save();

      taskResults.push({
        ok: true,
        action: existing?.id ? "updated" : "created",
        taskId: task._id,
        eventId: event.data.id,
        timezone,
        conflicts: conflicts.map((item) => ({
          id: item.id,
          summary: item.summary,
          start: item.start,
          end: item.end,
        })),
      });
    } catch (error) {
      task.googleCalendar.syncStatus = "failed";
      task.googleCalendar.syncError = error?.message || "Calendar task sync failed.";
      await task.save();

      taskResults.push({
        ok: false,
        taskId: task._id,
        error: task.googleCalendar.syncError,
      });
    }
  }

  await ReadinessGoogleToken.updateOne(
    { userId },
    {
      $set: {
        lastCalendarSyncedAt: new Date(),
        "calendar.enabled": true,
        "calendar.calendarId": calendarId,
        "calendar.lastSyncError": "",
        "calendar.timezone": timezone,
      },
    }
  );

  return {
    calendarId,
    timezone,
    deadlineResults,
    taskResults,
    syncedDeadlines: deadlineResults.filter((r) => r.ok).length,
    syncedTasks: taskResults.filter((r) => r.ok).length,
  };
}

function inferVoiceIntent(text = "") {
  const value = clean(text).toLowerCase();

  if (/\b(done|complete|completed|finished|করেছি|শেষ)\b/i.test(value)) return "checkin_done";
  if (/\b(half|partial|অর্ধেক|কিছুটা)\b/i.test(value)) return "checkin_half_done";
  if (/\b(not started|missed|করিনি|skip|no time)\b/i.test(value)) return "checkin_not_started";
  if (/\b(confused|stuck|help|বুঝি না|সমস্যা|কঠিন)\b/i.test(value)) return "checkin_confused";
  if (/\b(plan|today|next|কি করব|what should)\b/i.test(value)) return "ask_plan";
  if (/\b(motivate|motivation|stress|চাপ|ভয়)\b/i.test(value)) return "ask_motivation";

  return "other";
}

function answerFromVoiceIntent(intent) {
  if (intent === "checkin_done") return "done";
  if (intent === "checkin_half_done") return "half_done";
  if (intent === "checkin_not_started") return "not_started";
  if (intent === "checkin_confused") return "confused";
  return "";
}

async function getVoiceConversation(query = {}) {
  const userId = requireUserId(query);
  const sessionId = clean(query.sessionId);

  const filter = { userId };
  if (sessionId) filter.sessionId = sessionId;

  const conversation = await ReadinessVoiceConversation.findOne(filter).sort({
    lastActivityAt: -1,
  });

  const memoryContext = await buildVoiceMemoryContext(userId);

  return {
    conversation,
    memory: memoryContext.memory,
    memoryContext: memoryContext.compact,
  };
}

async function voiceCoachTurn(payload = {}) {
  const userId = requireUserId(payload);
  const sessionId = clean(payload.sessionId, crypto.randomUUID());
  const text = clean(payload.text);

  if (!text) throw new Error("text is required.");

  const { preference } = await getReadinessPreferences({ userId });
  const memoryContext = await buildVoiceMemoryContext(userId);

  let conversation = await ReadinessVoiceConversation.findOne({ userId, sessionId });

  if (!conversation) {
    conversation = await ReadinessVoiceConversation.create({
      userId,
      sessionId,
      taskId: payload.taskId || null,
      deadlineId: payload.deadlineId || null,
      status: "active",
      turns: [],
    });
  }

  const intent = inferVoiceIntent(text);
  const answer = answerFromVoiceIntent(intent);

  let targetTask = null;

  if (payload.taskId) {
    targetTask = await ReadinessTask.findOne({ _id: payload.taskId, userId });
  }

  if (!targetTask && conversation.taskId) {
    targetTask = await ReadinessTask.findOne({ _id: conversation.taskId, userId });
  }

  if (!targetTask && memoryContext.compact.todayTask?.id) {
    targetTask = await ReadinessTask.findOne({
      _id: memoryContext.compact.todayTask.id,
      userId,
    });
  }

  if (!targetTask) {
    targetTask = await ReadinessTask.findOne({
      userId,
      status: "planned",
      scheduledDate: { $gte: dateOnly(new Date()), $lte: endOfDay(new Date()) },
    }).sort({ priority: -1, startTime: 1 });
  }

  let checkin = null;

  if (targetTask && answer) {
    checkin = await checkinTask(targetTask._id, {
      userId,
      answer,
      blockedReason: answer === "confused" ? "topic_confusing" : "",
      note: `Voice: ${text}`,
      source: "voice",
    });

    targetTask = await ReadinessTask.findById(targetTask._id);
  }

  const deadline = targetTask?.deadlineId
    ? await ReadinessDeadline.findById(targetTask.deadlineId)
    : payload.deadlineId
      ? await ReadinessDeadline.findOne({ _id: payload.deadlineId, userId })
      : memoryContext.compact.urgentDeadline?.id
        ? await ReadinessDeadline.findOne({
            _id: memoryContext.compact.urgentDeadline.id,
            userId,
          })
        : null;

  const adaptiveContext = memoryContext.compact;

  const ai = await callReadinessGemma(
    `Return JSON only:
{
  "assistantText": "short spoken Bangla-English response, no guilt, memory-aware",
  "nextAction": "one concrete next action",
  "shouldSpeak": true,
  "emotionLabel": "neutral|stressed|overwhelmed|confused|tired|motivated|avoidant",
  "toneUsed": "gentle|balanced|direct|strict|reassuring"
}

User said: ${text}
Intent: ${intent}

Long voice memory:
${JSON.stringify(adaptiveContext)}

Current task:
${JSON.stringify(
  targetTask
    ? {
        title: targetTask.title,
        topic: targetTask.topic,
        durationMinutes: targetTask.durationMinutes,
        status: targetTask.status,
        courseCode: targetTask.courseCode,
      }
    : null
)}

Deadline:
${JSON.stringify(
  deadline
    ? {
        title: deadline.title,
        dueDate: deadline.dueDate,
        readinessScore: deadline.readinessScore,
        riskLevel: deadline.riskLevel,
        weakTopics: deadline.weakTopics,
      }
    : null
)}

Check-in result:
${JSON.stringify(
  checkin
    ? {
        aiText: checkin.aiText,
        readinessAfter: checkin.deadline?.readinessScore,
      }
    : null
)}

Rules:
- Use adaptive tone from memory.
- If repeated struggle exists, mention one tiny recovery action.
- If emotional state is stressed/overwhelmed, be reassuring and reduce scope.
- If repeated skip exists, be direct but not shaming.
- Keep it short enough for voice.`,
    {
      assistantText:
        checkin?.aiText ||
        "ঠিক আছে। আজ সব করতে হবে না—শুধু next small step শুরু করি। ১৫ মিনিট focus করলেই pressure কমবে।",
      nextAction: targetTask?.title || "Start the next small task.",
      shouldSpeak: true,
      emotionLabel: adaptiveContext.emotionalState?.current || "neutral",
      toneUsed: adaptiveContext.adaptiveTone?.current || "balanced",
    },
    {
      system:
        "You are a memory-aware Readiness Coach voice assistant. Speak short Bangla-English. No guilt. Adapt tone using long-term memory.",
      temperature: 0.25,
    }
  );

  const updatedMemory = await updateVoiceMemoryAfterTurn({
    userId,
    sessionId,
    text,
    intent,
    task: targetTask,
    deadline,
    assistantText: ai.assistantText,
    checkin,
    preference,
  });

  conversation.turns.push({
    role: "user",
    text,
    intent,
    taskId: targetTask?._id || null,
    deadlineId: deadline?._id || null,
    metadata: {
      emotionBefore: adaptiveContext.emotionalState,
      adaptiveToneBefore: adaptiveContext.adaptiveTone,
    },
  });

  conversation.turns.push({
    role: "assistant",
    text: ai.assistantText,
    intent: "",
    taskId: targetTask?._id || null,
    deadlineId: deadline?._id || null,
    metadata: {
      ...ai,
      memoryAfter: {
        emotion: updatedMemory.emotionalState,
        adaptiveTone: updatedMemory.adaptiveTone,
        struggleProfile: updatedMemory.struggleProfile,
        weakTopics: updatedMemory.weakTopics?.slice(0, 6),
      },
    },
  });

  const maxTurns = Number(process.env.READINESS_VOICE_MAX_TURNS || 80);

  if (conversation.turns.length > maxTurns) {
    conversation.turns = conversation.turns.slice(conversation.turns.length - maxTurns);
  }

  conversation.taskId = targetTask?._id || conversation.taskId || null;
  conversation.deadlineId = deadline?._id || conversation.deadlineId || null;
  conversation.lastUserText = text;
  conversation.lastAssistantText = ai.assistantText;
  conversation.lastIntent = intent;
  conversation.lastActivityAt = new Date();

  await conversation.save();

  return {
    sessionId,
    intent,
    assistantText: ai.assistantText,
    nextAction: ai.nextAction,
    shouldSpeak: ai.shouldSpeak !== false,
    emotion: updatedMemory.emotionalState,
    adaptiveTone: updatedMemory.adaptiveTone,
    longMemory: {
      summary: updatedMemory.longSummary,
      struggleProfile: updatedMemory.struggleProfile,
      weakTopics: updatedMemory.weakTopics?.slice(0, 8),
    },
    checkin,
    conversation,
  };
}

async function rebalanceAcrossDeadlines(payload = {}) {
  const userId = requireUserId(payload);
  const batchId = crypto.randomUUID();

  const { preference } = await getReadinessPreferences({ userId });
  const dailyBudgetMinutes = Number(preference?.coaching?.maxDailyStudyMinutes || 150);
  const preferredStudyStart = preference?.coaching?.preferredStudyStart || "19:00";

  const deadlines = await ReadinessDeadline.find({
    userId,
    status: "active",
    dueDate: { $gte: dateOnly(new Date()) },
  }).sort({ dueDate: 1 });

  for (const deadline of deadlines) {
    await recalculateDeadlineReadiness(deadline._id);
  }

  const freshDeadlines = await ReadinessDeadline.find({
    userId,
    status: "active",
    dueDate: { $gte: dateOnly(new Date()) },
  });

  const ranked = freshDeadlines.sort((a, b) => riskRank(b) - riskRank(a));
  const changed = [];

  const plannedTasks = await ReadinessTask.find({
    userId,
    status: "planned",
    scheduledDate: { $gte: dateOnly(new Date()) },
  });

  const loadByDay = new Map();

  for (const task of plannedTasks) {
    const key = ymd(task.scheduledDate);
    loadByDay.set(key, (loadByDay.get(key) || 0) + Number(task.durationMinutes || 25));
  }

  for (const deadline of ranked.slice(0, 6)) {
    const tasks = await ReadinessTask.find({
      userId,
      deadlineId: deadline._id,
      status: "planned",
      scheduledDate: { $gte: dateOnly(new Date()) },
    }).sort({ scheduledDate: 1, priority: -1 });

    const boost =
      deadline.riskLevel === "Critical"
        ? 30
        : deadline.riskLevel === "High"
          ? 22
          : deadline.riskLevel === "Medium"
            ? 12
            : 5;

    for (const task of tasks.slice(0, 4)) {
      const originalDate = task.scheduledDate;
      const originalDuration = Number(task.durationMinutes || 25);

      const duration =
        deadline.riskLevel === "Critical"
          ? Math.max(15, Math.min(35, originalDuration))
          : originalDuration;

      let candidateDate = task.scheduledDate;

      for (let back = 1; back <= 7; back += 1) {
        const earlier = addDays(task.scheduledDate, -back);

        if (!earlier || earlier < dateOnly(new Date())) continue;

        const key = ymd(earlier);
        const load = loadByDay.get(key) || 0;

        if (load + duration <= dailyBudgetMinutes) {
          candidateDate = earlier;
          break;
        }
      }

      task.scheduledDate = candidateDate;
      task.startTime = task.startTime || preferredStudyStart;
      task.durationMinutes = duration;
      task.priority = Math.min(100, Number(task.priority || 60) + boost);
      task.mode = deadline.riskLevel === "Critical" ? "minimum" : task.mode;
      task.autoReplanned = true;
      task.replanBatchId = batchId;
      task.reason = `${task.reason || ""} Rebalanced with workload capacity ${dailyBudgetMinutes}min/day because ${deadline.title} is ${deadline.riskLevel} risk.`.trim();

      await task.save();

      if (ymd(originalDate) !== ymd(candidateDate)) {
        loadByDay.set(
          ymd(originalDate),
          Math.max(0, (loadByDay.get(ymd(originalDate)) || 0) - originalDuration)
        );

        loadByDay.set(
          ymd(candidateDate),
          (loadByDay.get(ymd(candidateDate)) || 0) + duration
        );
      }

      changed.push({
        taskId: task._id,
        title: task.title,
        deadlineId: deadline._id,
        deadlineTitle: deadline.title,
        from: originalDate,
        to: task.scheduledDate,
        priority: task.priority,
        durationMinutes: task.durationMinutes,
      });
    }
  }

  const heavySmooth = await smoothHeavyWeeks(userId);

  return {
    batchId,
    changedCount: changed.length,
    changed,
    heavySmooth,
    loadByDay: Object.fromEntries(loadByDay.entries()),
    message: `Rebalanced ${changed.length} task(s) across active deadlines.`,
  };
}

export {
  createDeadline,
  listDeadlines,
  updateDeadline,
  deleteDeadline,
  generateReadinessPlan,
  createReadinessTask,
  updateReadinessTask,
  deleteReadinessTask,
  getPlanningPreferences,
  updatePlanningPreferences,
  regenerateRecoveryPlan,
  checkinTask,
  getToday,
  getOfficialCalendar,
  getReadinessCalendar,
  getTwoCalendar,
  exportIcs,
  getDashboard,
  getHeavyWeeks,
  scheduleSms,
  handleSmsReply,
  getReadinessPreferences,
  upsertReadinessPreferences,
  generateDailyReadinessReminders,
  generateHeavyWeekReminders,
  runReadinessReminderSchedulerOnce,
  syncReadinessToGoogleCalendar,
  voiceCoachTurn,
  getVoiceConversation,
  rebalanceAcrossDeadlines,
};