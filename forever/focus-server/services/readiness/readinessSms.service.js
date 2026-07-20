import ReadinessSmsReminder from "../../models/ReadinessSmsReminder.js";

import { clean, makeError, requireUserId } from "./readinessDate.util.js";

function normalizeReply(value = "") {
  const text = clean(value).toLowerCase();

  if (!text) return "";

  if (["done", "finish", "finished", "complete", "completed", "yes"].includes(text)) {
    return "done";
  }

  if (["help", "stuck", "confused", "problem", "issue"].includes(text)) {
    return "help";
  }

  if (["skip", "skipped", "miss", "missed", "not started", "no"].includes(text)) {
    return "skip";
  }

  if (["half", "half done", "partial", "some"].includes(text)) {
    return "half_done";
  }

  if (text.includes("done") || text.includes("শেষ") || text.includes("করেছি")) {
    return "done";
  }

  if (
    text.includes("help") ||
    text.includes("confused") ||
    text.includes("stuck") ||
    text.includes("বুঝি") ||
    text.includes("আটকে")
  ) {
    return "help";
  }

  if (
    text.includes("skip") ||
    text.includes("miss") ||
    text.includes("শুরু করিনি") ||
    text.includes("করিনি")
  ) {
    return "skip";
  }

  return "";
}

function safeDate(value, fallback = new Date()) {
  if (!value) return fallback;

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) return fallback;

  return date;
}

function normalizeKind(value = "") {
  const kind = clean(value, "recovery");

  const allowed = new Set([
    "daily_checkin",
    "heavy_week",
    "deadline_warning",
    "recovery",
    "missed_task",
    "confused_help",
    "manual",
    "test",
  ]);

  if (allowed.has(kind)) {
    // If your schema does not allow "test", store it as manual.
    return kind === "test" ? "manual" : kind;
  }

  return "recovery";
}

export async function scheduleSms(payload = {}) {
  const userId = requireUserId(payload);
  const phone = clean(payload.phone);

  if (!phone) {
    throw makeError("phone is required.", 400, "phone_required");
  }

  const message = clean(payload.message, "Readiness Coach reminder.");

  const reminder = await ReadinessSmsReminder.create({
    userId,
    phone,
    taskId: payload.taskId || null,
    deadlineId: payload.deadlineId || null,
    kind: normalizeKind(payload.kind),
    message,
    sendAt: safeDate(payload.sendAt, new Date()),
    status: "pending",
    provider: clean(payload.provider, "twilio"),
    metadata: {
      source: clean(payload.source, "readiness"),
      reason: clean(payload.reason),
      ...(payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {}),
    },
  });

  return {
    reminder,
    message: "SMS reminder scheduled.",
  };
}

export async function listPendingSms(payload = {}) {
  const userId = requireUserId(payload);

  const reminders = await ReadinessSmsReminder.find({
    userId,
    status: "pending",
  }).sort({ sendAt: 1 });

  return { reminders };
}

export async function cancelSms(reminderId, payload = {}) {
  requireUserId(payload);

  const reminder = await ReadinessSmsReminder.findById(reminderId);

  if (!reminder) {
    throw makeError("SMS reminder not found.", 404, "sms_not_found");
  }

  reminder.status = "cancelled";
  reminder.error = "";
  await reminder.save();

  return {
    reminder,
    cancelled: true,
  };
}

export async function handleSmsReply(payload = {}) {
  const phone = clean(payload.From || payload.from || payload.phone);
  const rawBody = clean(payload.Body || payload.body || payload.message);
  const normalized = normalizeReply(rawBody);

  if (!phone) {
    throw makeError("SMS reply phone is required.", 400, "sms_phone_required");
  }

  const reminder = await ReadinessSmsReminder.findOne({
    phone,
  }).sort({ createdAt: -1 });

  if (!reminder) {
    return {
      matched: false,
      message: "No reminder matched.",
    };
  }

  reminder.reply = {
    raw: rawBody,
    normalized,
    receivedAt: new Date(),
    processed: false,
    processError: "",
  };

  await reminder.save();

  if (reminder.taskId && ["done", "help", "skip", "half_done"].includes(normalized)) {
    try {
      const { checkinTask } = await import("./readinessRecovery.service.js");

      const answer =
        normalized === "help"
          ? "confused"
          : normalized === "skip"
            ? "skip"
            : normalized === "half_done"
              ? "half_done"
              : "done";

      const result = await checkinTask(reminder.taskId, {
        userId: reminder.userId,
        answer,
        blockedReason: normalized === "help" ? "topic_confusing" : "",
        note: `SMS reply check-in: ${rawBody}`,
        source: "sms",
      });

      reminder.reply.processed = true;
      reminder.reply.processError = "";
      await reminder.save();

      return {
        matched: true,
        processed: true,
        checkin: result.checkin,
        message: "SMS reply processed.",
      };
    } catch (error) {
      reminder.reply.processed = false;
      reminder.reply.processError = error.message || "SMS reply processing failed.";
      await reminder.save();

      return {
        matched: true,
        processed: false,
        error: error.message,
        message: "SMS reply saved but check-in processing failed.",
      };
    }
  }

  return {
    matched: true,
    processed: false,
    message: "SMS reply saved.",
  };
}

export default {
  scheduleSms,
  listPendingSms,
  cancelSms,
  handleSmsReply,
};