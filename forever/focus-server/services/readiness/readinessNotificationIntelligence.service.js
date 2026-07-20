import ReadinessDeadline from "../../models/ReadinessDeadline.js";
import ReadinessTask from "../../models/ReadinessTask.js";
import ReadinessCheckin from "../../models/ReadinessCheckin.js";
import ReadinessSmsReminder from "../../models/ReadinessSmsReminder.js";
import ReadinessUserPreference from "../../models/ReadinessUserPreference.js";
import ReadinessNotificationEvent from "../../models/ReadinessNotificationEvent.js";
import { callReadinessGemma } from "./readinessAi.service.js";
import { addDays, applyTimeToDate, clean, dateOnly, daysBetween, endOfDay, ymd } from "./readinessDate.util.js";
import { getHeavyWeeks } from "./readinessHeavyWeek.service.js";

function minutesOfDay(time = "00:00") {
  const [h, m] = clean(time, "00:00").split(":").map((part) => Number(part || 0));
  return h * 60 + m;
}

function inQuietHours(now, quietHours = {}) {
  const start = minutesOfDay(quietHours.start || "23:00");
  const end = minutesOfDay(quietHours.end || "08:00");
  const current = now.getHours() * 60 + now.getMinutes();

  if (start === end) return false;
  if (start < end) return current >= start && current <= end;
  return current >= start || current <= end;
}

function nextAllowedSendAt(now, quietHours = {}) {
  if (!inQuietHours(now, quietHours)) return now;

  const end = quietHours.end || "08:00";
  const sendAt = applyTimeToDate(now, end);

  if (sendAt <= now) {
    return applyTimeToDate(addDays(now, 1), end);
  }

  return sendAt;
}

function defaultSmartPreferencePatch() {
  return {
    enabled: true,
    inactiveHours: 30,
    deadlineNearDays: 3,
    repeatedSkipLookbackDays: 7,
    repeatedSkipThreshold: 2,
    maxSmartRemindersPerDay: 3,
    quietHours: {
      start: "23:00",
      end: "08:00",
    },
    channels: {
      sms: true,
      voice: true,
      app: true,
    },
  };
}

export function normalizeNotificationIntelligence(input = {}) {
  const defaults = defaultSmartPreferencePatch();
  const quiet = input.quietHours || {};
  const channels = input.channels || {};

  return {
    enabled: input.enabled !== false,
    inactiveHours: Number(input.inactiveHours || defaults.inactiveHours),
    deadlineNearDays: Number(input.deadlineNearDays || defaults.deadlineNearDays),
    repeatedSkipLookbackDays: Number(input.repeatedSkipLookbackDays || defaults.repeatedSkipLookbackDays),
    repeatedSkipThreshold: Number(input.repeatedSkipThreshold || defaults.repeatedSkipThreshold),
    maxSmartRemindersPerDay: Number(input.maxSmartRemindersPerDay || defaults.maxSmartRemindersPerDay),
    quietHours: {
      start: clean(quiet.start, defaults.quietHours.start),
      end: clean(quiet.end, defaults.quietHours.end),
    },
    channels: {
      sms: channels.sms !== false,
      voice: channels.voice !== false,
      app: channels.app !== false,
    },
  };
}

async function getRecentSmartCount(userId, now) {
  return ReadinessSmsReminder.countDocuments({
    userId,
    kind: { $in: ["deadline_warning", "recovery", "missed_task", "confused_help", "heavy_week"] },
    createdAt: { $gte: dateOnly(now), $lte: endOfDay(now) },
    status: { $in: ["pending", "sent"] },
    "metadata.smart": true,
  });
}

async function alreadyCreatedSimilar({ userId, kind, taskId = null, deadlineId = null, now }) {
  const filter = {
    userId,
    kind,
    createdAt: { $gte: dateOnly(now), $lte: endOfDay(now) },
    status: { $in: ["pending", "sent"] },
    "metadata.smart": true,
  };

  if (taskId) filter.taskId = taskId;
  if (deadlineId) filter.deadlineId = deadlineId;

  return ReadinessSmsReminder.findOne(filter).sort({ createdAt: -1 });
}

async function buildSignals(userId, preference, now) {
  const smart = normalizeNotificationIntelligence(preference.notificationIntelligence || {});
  const sinceInactive = new Date(now.getTime() - smart.inactiveHours * 60 * 60 * 1000);
  const lookback = addDays(dateOnly(now), -smart.repeatedSkipLookbackDays);

  const latestCheckin = await ReadinessCheckin.findOne({ userId }).sort({ createdAt: -1 });

  const todaysTasks = await ReadinessTask.find({
    userId,
    status: "planned",
    scheduledDate: { $gte: dateOnly(now), $lte: endOfDay(now) },
  }).sort({ priority: -1, startTime: 1 });

  const nearDeadlines = await ReadinessDeadline.find({
    userId,
    status: "active",
    dueDate: { $gte: now, $lte: addDays(now, smart.deadlineNearDays) },
  }).sort({ dueDate: 1, readinessScore: 1 });

  const badCheckins = await ReadinessCheckin.find({
    userId,
    createdAt: { $gte: lookback },
    answer: { $in: ["skip", "not_started", "confused"] },
  })
    .populate("taskId")
    .populate("deadlineId")
    .sort({ createdAt: -1 })
    .limit(40);

  const heavy = await getHeavyWeeks({ userId });
  const heavyWeeks = (heavy.weeks || []).filter((week) => week.isHeavy);

  const inactive = !latestCheckin || latestCheckin.createdAt < sinceInactive;
  const repeatedBadCount = badCheckins.length;

  return {
    smart,
    latestCheckin,
    todaysTasks,
    nearDeadlines,
    badCheckins,
    heavyWeeks,
    inactive,
    repeatedBadCount,
  };
}

function chooseEscalation({ inactive, repeatedBadCount, nearDeadline, heavyWeek }) {
  let level = 1;
  if (inactive) level += 1;
  if (repeatedBadCount >= 2) level += 1;
  if (repeatedBadCount >= 4) level += 1;
  if (nearDeadline?.riskLevel === "Critical" || nearDeadline?.readinessScore < 35) level += 1;
  if (heavyWeek) level += 1;
  return Math.max(1, Math.min(5, level));
}

function mapKindToSmsKind(kind) {
  if (kind === "deadline_near") return "deadline_warning";
  if (kind === "inactive_user") return "recovery";
  if (kind === "repeated_skip") return "missed_task";
  if (kind === "heavy_week_spike") return "heavy_week";
  if (kind === "confused_help") return "confused_help";
  return "recovery";
}

async function createSmartMessage({ kind, escalationLevel, task, deadline, signals }) {
  const fallback = (() => {
    if (kind === "deadline_near") {
      return `${deadline?.courseCode || "Course"}: ${deadline?.title || "deadline"} is near. Do one small task today. Reply DONE / HALF / HELP / SKIP.`;
    }

    if (kind === "inactive_user") {
      return `You have been inactive. Start only 15 minutes today to protect your deadline. Reply DONE / HELP / SKIP.`;
    }

    if (kind === "repeated_skip") {
      return `Pattern noticed: tasks are getting skipped. No guilt—do the smallest version now: ${task?.title || "one 15-min task"}. Reply DONE / HELP / SKIP.`;
    }

    if (kind === "heavy_week_spike") {
      return `Heavy week coming. Start early with ${deadline?.courseCode || "one course"}: ${deadline?.title || "first risky deadline"}. Reply HELP if stuck.`;
    }

    return `Readiness check: ${task?.title || "start one small task"}. Reply DONE / HALF / HELP / SKIP.`;
  })();

  const ai = await callReadinessGemma(
    `Return JSON only:
{"message":"SMS under 300 chars, Bangla-English, practical, no guilt"}

Notification kind: ${kind}
Escalation level: ${escalationLevel}/5
Task:
${JSON.stringify(task ? { title: task.title, topic: task.topic, durationMinutes: task.durationMinutes, courseCode: task.courseCode } : null)}
Deadline:
${JSON.stringify(deadline ? { title: deadline.title, courseCode: deadline.courseCode, dueDate: deadline.dueDate, readinessScore: deadline.readinessScore, riskLevel: deadline.riskLevel } : null)}
Signals:
${JSON.stringify({ inactive: signals.inactive, repeatedBadCount: signals.repeatedBadCount, heavyWeeks: signals.heavyWeeks?.length || 0 })}

Rules:
- Do not shame.
- If escalation high, be direct but supportive.
- Always include reply commands: DONE / HALF / HELP / SKIP.`,
    { message: fallback.slice(0, 300) },
    {
      system: "You write smart SMS reminders for a student readiness coach.",
      temperature: 0.22,
    }
  );

  return clean(ai.message, fallback).slice(0, 320);
}

async function createReminder({ userId, phone, kind, task = null, deadline = null, escalationLevel, reason, evidence, preference, now, signals }) {
  const smart = normalizeNotificationIntelligence(preference.notificationIntelligence || {});
  const sendAt = nextAllowedSendAt(now, smart.quietHours);
  const smsKind = mapKindToSmsKind(kind);
  const duplicate = await alreadyCreatedSimilar({
    userId,
    kind: smsKind,
    taskId: task?._id || null,
    deadlineId: deadline?._id || null,
    now,
  });

  if (duplicate) {
    await ReadinessNotificationEvent.create({
      userId,
      phone,
      taskId: task?._id || null,
      deadlineId: deadline?._id || null,
      kind,
      channel: "sms",
      escalationLevel,
      reason,
      decision: "duplicate",
      evidence,
      sendAt: duplicate.sendAt,
    });

    return { created: false, duplicate: true, reminder: duplicate };
  }

  const todaysSmartCount = await getRecentSmartCount(userId, now);
  if (todaysSmartCount >= smart.maxSmartRemindersPerDay) {
    await ReadinessNotificationEvent.create({
      userId,
      phone,
      taskId: task?._id || null,
      deadlineId: deadline?._id || null,
      kind,
      channel: "sms",
      escalationLevel,
      reason,
      decision: "blocked_limit",
      evidence: { ...evidence, todaysSmartCount },
      sendAt: null,
    });

    return { created: false, blocked: true, reason: "daily_limit" };
  }

  const message = await createSmartMessage({ kind, escalationLevel, task, deadline, signals });

  const reminder = await ReadinessSmsReminder.create({
    userId,
    phone,
    taskId: task?._id || null,
    deadlineId: deadline?._id || null,
    kind: smsKind,
    message,
    sendAt,
    status: "pending",
    provider: "twilio",
    metadata: {
      smart: true,
      smartKind: kind,
      escalationLevel,
      reason,
      evidence,
      quietHoursShifted: sendAt.getTime() !== now.getTime(),
      generatedBy: "notification_intelligence",
    },
  });

  await ReadinessNotificationEvent.create({
    userId,
    phone,
    taskId: task?._id || null,
    deadlineId: deadline?._id || null,
    kind,
    channel: "sms",
    escalationLevel,
    reason,
    decision: sendAt.getTime() !== now.getTime() ? "blocked_quiet_hours" : "created",
    message,
    evidence,
    sendAt,
  });

  return { created: true, reminder };
}

export async function runNotificationIntelligenceForUser({ userId, force = false, now = new Date() }) {
  const preference = await ReadinessUserPreference.findOne({ userId });

  if (!preference?.smsEnabled || !preference?.phone) {
    return { userId, created: 0, message: "SMS disabled or phone missing.", decisions: [] };
  }

  const signals = await buildSignals(userId, preference, now);
  const smart = signals.smart;

  if (!smart.enabled && !force) {
    return { userId, created: 0, message: "Notification intelligence disabled.", decisions: [] };
  }

  const decisions = [];
  const primaryTask = signals.todaysTasks?.[0] || null;
  const primaryNearDeadline = signals.nearDeadlines?.[0] || null;
  const primaryHeavyWeek = signals.heavyWeeks?.[0] || null;
  const heavyDeadline = primaryHeavyWeek?.deadlines?.[0] || primaryNearDeadline;

  if (force || signals.inactive) {
    decisions.push(
      await createReminder({
        userId,
        phone: preference.phone,
        kind: "inactive_user",
        task: primaryTask,
        deadline: primaryNearDeadline,
        escalationLevel: chooseEscalation({
          inactive: true,
          repeatedBadCount: signals.repeatedBadCount,
          nearDeadline: primaryNearDeadline,
          heavyWeek: Boolean(primaryHeavyWeek),
        }),
        reason: `No recent check-in for ${smart.inactiveHours}+ hours.`,
        evidence: {
          lastCheckinAt: signals.latestCheckin?.createdAt || null,
          inactiveHours: smart.inactiveHours,
        },
        preference,
        now,
        signals,
      })
    );
  }

  if (force || primaryNearDeadline) {
    if (primaryNearDeadline) {
      decisions.push(
        await createReminder({
          userId,
          phone: preference.phone,
          kind: "deadline_near",
          task: primaryTask,
          deadline: primaryNearDeadline,
          escalationLevel: chooseEscalation({
            inactive: signals.inactive,
            repeatedBadCount: signals.repeatedBadCount,
            nearDeadline: primaryNearDeadline,
            heavyWeek: Boolean(primaryHeavyWeek),
          }),
          reason: `Deadline is within ${smart.deadlineNearDays} day(s).`,
          evidence: {
            dueDate: primaryNearDeadline.dueDate,
            daysLeft: daysBetween(now, primaryNearDeadline.dueDate),
            readinessScore: primaryNearDeadline.readinessScore,
            riskLevel: primaryNearDeadline.riskLevel,
          },
          preference,
          now,
          signals,
        })
      );
    }
  }

  if (force || signals.repeatedBadCount >= smart.repeatedSkipThreshold) {
    if (signals.repeatedBadCount >= smart.repeatedSkipThreshold || force) {
      const latestBad = signals.badCheckins?.[0];
      const task = latestBad?.taskId && typeof latestBad.taskId === "object" ? latestBad.taskId : primaryTask;
      const deadline = latestBad?.deadlineId && typeof latestBad.deadlineId === "object" ? latestBad.deadlineId : primaryNearDeadline;

      decisions.push(
        await createReminder({
          userId,
          phone: preference.phone,
          kind: "repeated_skip",
          task,
          deadline,
          escalationLevel: chooseEscalation({
            inactive: signals.inactive,
            repeatedBadCount: signals.repeatedBadCount,
            nearDeadline: deadline,
            heavyWeek: Boolean(primaryHeavyWeek),
          }),
          reason: `Repeated skip/not-started/confused pattern detected in last ${smart.repeatedSkipLookbackDays} days.`,
          evidence: {
            repeatedBadCount: signals.repeatedBadCount,
            threshold: smart.repeatedSkipThreshold,
            recentAnswers: signals.badCheckins.slice(0, 8).map((item) => item.answer),
          },
          preference,
          now,
          signals,
        })
      );
    }
  }

  if (force || primaryHeavyWeek) {
    if (primaryHeavyWeek) {
      decisions.push(
        await createReminder({
          userId,
          phone: preference.phone,
          kind: "heavy_week_spike",
          task: primaryTask,
          deadline: heavyDeadline,
          escalationLevel: chooseEscalation({
            inactive: signals.inactive,
            repeatedBadCount: signals.repeatedBadCount,
            nearDeadline: heavyDeadline,
            heavyWeek: true,
          }),
          reason: "Heavy week workload spike detected.",
          evidence: {
            weekKey: primaryHeavyWeek.key,
            count: primaryHeavyWeek.count,
            workHours: primaryHeavyWeek.workHours,
          },
          preference,
          now,
          signals,
        })
      );
    }
  }

  const created = decisions.filter((item) => item?.created).length;

  return {
    userId,
    created,
    checkedSignals: {
      inactive: signals.inactive,
      todayTasks: signals.todaysTasks.length,
      nearDeadlines: signals.nearDeadlines.length,
      repeatedBadCount: signals.repeatedBadCount,
      heavyWeeks: signals.heavyWeeks.length,
    },
    decisions,
  };
}

export async function runNotificationIntelligenceScheduler({ userId = "", limit = 100, force = false } = {}) {
  let preferences = [];

  if (userId) {
    const preference = await ReadinessUserPreference.findOne({ userId });
    if (preference) preferences = [preference];
  } else {
    preferences = await ReadinessUserPreference.find({
      smsEnabled: true,
      phone: { $ne: "" },
      "notificationIntelligence.enabled": { $ne: false },
    }).limit(Number(limit || 100));
  }

  const results = [];

  for (const preference of preferences) {
    results.push(
      await runNotificationIntelligenceForUser({
        userId: preference.userId,
        force,
      })
    );
  }

  return {
    usersChecked: preferences.length,
    created: results.reduce((sum, item) => sum + Number(item.created || 0), 0),
    results,
  };
}