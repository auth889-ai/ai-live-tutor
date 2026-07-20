import twilio from "twilio";
import ReadinessSmsReminder from "../../models/ReadinessSmsReminder.js";

let workerTimer = null;
let workerRunning = false;

function boolEnv(name, fallback = false) {
  const value = process.env[name];

  if (value === undefined || value === null || value === "") return fallback;

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function intEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function getTwilioClient() {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return null;
  }

  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

async function sendOneReminder(reminder) {
  const client = getTwilioClient();

  if (!client) {
    reminder.status = "failed";
    reminder.error = "Twilio credentials missing.";
    reminder.failedAt = new Date();
    await reminder.save();

    return {
      ok: false,
      reminderId: reminder._id,
      error: "Twilio credentials missing.",
    };
  }

  const from = process.env.TWILIO_FROM_NUMBER;

  if (!from) {
    reminder.status = "failed";
    reminder.error = "TWILIO_FROM_NUMBER missing.";
    reminder.failedAt = new Date();
    await reminder.save();

    return {
      ok: false,
      reminderId: reminder._id,
      error: "TWILIO_FROM_NUMBER missing.",
    };
  }

  if (!reminder.phone) {
    reminder.status = "failed";
    reminder.error = "Reminder phone missing.";
    reminder.failedAt = new Date();
    await reminder.save();

    return {
      ok: false,
      reminderId: reminder._id,
      error: "Reminder phone missing.",
    };
  }

  try {
    const result = await client.messages.create({
      from,
      to: reminder.phone,
      body: reminder.message || "Readiness Coach reminder.",
    });

    reminder.status = "sent";
    reminder.provider = "twilio";
    reminder.providerMessageId = result.sid;
    reminder.sentAt = new Date();
    reminder.error = "";
    await reminder.save();

    return {
      ok: true,
      reminderId: reminder._id,
      sid: result.sid,
    };
  } catch (error) {
    reminder.status = "failed";
    reminder.error = error.message || "Twilio send failed.";
    reminder.failedAt = new Date();
    await reminder.save();

    return {
      ok: false,
      reminderId: reminder._id,
      error: reminder.error,
    };
  }
}

/**
 * Sends already-created pending SMS only.
 * No AI call.
 * No invalid `sending` status.
 */
export async function runReadinessSmsWorkerOnce(options = {}) {
  const now = new Date();
  const limit = Math.max(1, Math.min(Number(options.limit || 25), 100));

  const pending = await ReadinessSmsReminder.find({
    status: "pending",
    sendAt: { $lte: now },
  })
    .sort({ sendAt: 1, createdAt: 1 })
    .limit(limit);

  const results = [];

  for (const reminder of pending) {
    const result = await sendOneReminder(reminder);
    results.push(result);
  }

  return {
    checkedAt: now,
    processed: pending.length,
    sent: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results,
    message: "SMS worker ran without AI.",
  };
}

export async function runReadinessSmartNotificationOnce(options = {}) {
  const enabled = boolEnv("READINESS_SMS_WORKER_ENABLE_INTELLIGENCE", false);

  if (!enabled) {
    return {
      skipped: true,
      reason: "READINESS_SMS_WORKER_ENABLE_INTELLIGENCE is false.",
      message: "Smart AI notification worker skipped.",
    };
  }

  const { runNotificationIntelligenceScheduler } = await import(
    "../readiness/readinessNotificationIntelligence.service.js"
  );

  return runNotificationIntelligenceScheduler(options);
}

export function startReadinessSmsWorker(options = {}) {
  if (workerTimer) {
    return {
      started: false,
      alreadyRunning: true,
      message: "Readiness SMS worker already running.",
    };
  }

  if (boolEnv("READINESS_SMS_WORKER_DISABLED", false)) {
    console.log("[ReadinessSmsWorker] disabled by READINESS_SMS_WORKER_DISABLED=true");

    return {
      started: false,
      disabled: true,
      message: "Readiness SMS worker disabled.",
    };
  }

  const pollMs = intEnv("READINESS_SMS_WORKER_POLL_MS", 60000);

  workerTimer = setInterval(async () => {
    if (workerRunning) return;

    workerRunning = true;

    try {
      await runReadinessSmsWorkerOnce({
        limit: intEnv("READINESS_SMS_WORKER_BATCH_SIZE", 25),
      });
    } catch (error) {
      console.warn("[ReadinessSmsWorker] run failed:", error.message);
    } finally {
      workerRunning = false;
    }
  }, pollMs);

  console.log(`[ReadinessSmsWorker] started poll=${pollMs}ms no-ai=true`);

  return {
    started: true,
    pollMs,
    noAi: true,
  };
}

export function stopReadinessSmsWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }

  workerRunning = false;

  return {
    stopped: true,
  };
}

export const startReadinessSmsWorkerLoop = startReadinessSmsWorker;
export const stopReadinessSmsWorkerLoop = stopReadinessSmsWorker;
export const startSmsWorker = startReadinessSmsWorker;
export const stopSmsWorker = stopReadinessSmsWorker;