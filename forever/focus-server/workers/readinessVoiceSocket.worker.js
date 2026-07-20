import ReadinessTask from "../models/ReadinessTask.js";
import {
  emitStudyEvent,
  getConnectedClients,
} from "../config/realtime.js";

/**
 * Readiness Voice WebSocket Worker
 * ------------------------------------------------------------
 * IMPORTANT FINAL FIX:
 * - Worker must NOT call getNextVoiceAccountabilityTask().
 * - getNextVoiceAccountabilityTask() has active-lock rules for manual/normal flow.
 * - Worker already found due tasks from DB, so it should emit the due task directly.
 *
 * This fixes:
 * FindDueTasks count=1
 * -> NextTask lockedByActiveTask=true
 * -> emitted=0
 */

const FEATURE = "ReadinessVoiceSocketWorker";

const DONE_STATUSES = ["done", "completed", "cancelled", "skipped"];

let timer = null;
let workerRunning = false;

const inFlightUsers = new Set();
const recentlyEmitted = new Map();

function clean(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function isTrue(value) {
  return value === true || value === "true" || value === "1" || value === 1;
}

function nowIso() {
  return new Date().toISOString();
}

function logStart(label, extra = "") {
  const startedAt = Date.now();
  console.log(`[${FEATURE}] ${label} start${extra ? ` ${extra}` : ""}`);
  return startedAt;
}

function logEnd(label, startedAt, extra = "") {
  const ms = Date.now() - startedAt;
  console.log(`[${FEATURE}] ${label} done in ${ms}ms${extra ? ` ${extra}` : ""}`);
  return ms;
}

function logWarn(label, error) {
  console.warn(`[${FEATURE}] ${label}:`, error?.message || error);
}

function pruneEmitMemory(ttlMs = 120_000) {
  const now = Date.now();

  for (const [key, storedAt] of recentlyEmitted.entries()) {
    if (now - storedAt > ttlMs) {
      recentlyEmitted.delete(key);
    }
  }
}

function canEmitOnce(key, ttlMs = 120_000) {
  pruneEmitMemory(ttlMs);

  if (recentlyEmitted.has(key)) {
    return false;
  }

  recentlyEmitted.set(key, Date.now());
  return true;
}

function taskIdOf(task = {}) {
  return clean(task._id || task.id || task.taskId);
}

function userIdOf(task = {}) {
  return clean(task.userId);
}

function taskTitle(task = {}) {
  return clean(task.title || task.topic || task.deadlineTitle || "this task");
}

function taskCourse(task = {}) {
  return clean(task.courseCode || task.courseTitle || "");
}

function taskDuration(task = {}) {
  const minutes = Number(task.durationMinutes || task.minutes || 25);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 25;
}

function makeDueQuestion(task = {}) {
  /**
   * This is only the due check-in line.
   * The rich dynamic reply still comes from Gemma when the user answers.
   * We keep this short so TTS sounds natural and immediate.
   */
  const title = taskTitle(task);
  const course = taskCourse(task);
  const minutes = taskDuration(task);

  const lastMood = clean(task?.voice?.lastMood);
  const lastIntent = clean(task?.voice?.lastIntent);

  if (lastIntent === "stressed" || lastMood === "stressed" || lastMood === "sad") {
    return `I am back for ${course ? `${course}, ` : ""}${title}. No pressure. Can we make it tiny and just open the material for one minute?`;
  }

  if (lastIntent === "stuck" || lastMood === "confused") {
    return `I am back for ${course ? `${course}, ` : ""}${title}. What exact part is blocking you right now: the slide, the question, or the first step?`;
  }

  if (lastIntent === "tired" || lastMood === "tired") {
    return `I am back for ${course ? `${course}, ` : ""}${title}. Energy can be low, so let us start small. Can you do just five minutes now?`;
  }

  return `I am back for ${course ? `${course}, ` : ""}${title}. Can you start a small ${Math.min(minutes, 25)} minute work block now?`;
}

async function findDueTasks() {
  const startedAt = logStart("FindDueTasks");

  const now = new Date();

  const dueTasks = await ReadinessTask.find({
    calendarType: "preparation",
    status: { $nin: DONE_STATUSES },
    "voice.enabled": { $ne: false },
    "voice.nextCheckAt": { $lte: now },
  })
    .sort({
      "voice.nextCheckAt": 1,
      scheduledDate: 1,
      startTime: 1,
      priority: -1,
      createdAt: 1,
    })
    .limit(Number(process.env.READINESS_VOICE_SOCKET_WORKER_MAX_TASKS || 100))
    .lean();

  logEnd("FindDueTasks", startedAt, `count=${dueTasks.length}`);

  return dueTasks;
}

function groupDueTasksByUser(dueTasks = []) {
  const map = new Map();

  for (const task of dueTasks) {
    const userId = userIdOf(task);
    if (!userId) continue;

    if (!map.has(userId)) {
      map.set(userId, []);
    }

    map.get(userId).push(task);
  }

  return map;
}

function getConnectedCount(userId) {
  try {
    const connected = getConnectedClients({ userId });
    return Array.isArray(connected) ? connected.length : 0;
  } catch (error) {
    logWarn("getConnectedClients failed", error);
    return 0;
  }
}

async function markTaskEmitted({ task, question }) {
  const taskId = taskIdOf(task);
  const userId = userIdOf(task);

  if (!taskId || !userId) return task;

  const updated = await ReadinessTask.findOneAndUpdate(
    {
      _id: taskId,
      userId,
      status: { $nin: DONE_STATUSES },
    },
    {
      $set: {
        "voice.enabled": task.voice?.enabled !== false,
        "voice.lastAskedAt": new Date(),
        "voice.lastAiQuestion": question,
        "voice.lastAiText": question,
      },
      /**
       * Critical:
       * If we do not unset nextCheckAt after emitting,
       * worker will emit same task every 10 seconds.
       */
      $unset: {
        "voice.nextCheckAt": "",
      },
    },
    { new: true }
  ).lean();

  return updated || task;
}

async function emitDueTaskForUser(userId, userTasks = []) {
  if (!userId) {
    return {
      emitted: false,
      reason: "missing_user_id",
    };
  }

  if (inFlightUsers.has(userId)) {
    console.log(`[${FEATURE}] skip user=${userId} reason=user_already_in_flight`);

    return {
      emitted: false,
      reason: "user_already_in_flight",
      userId,
    };
  }

  const connectedCount = getConnectedCount(userId);

  if (connectedCount <= 0) {
    console.log(
      `[${FEATURE}] skip user=${userId} reason=no_connected_browser connected=0`
    );

    return {
      emitted: false,
      reason: "no_connected_browser",
      userId,
    };
  }

  const task = userTasks[0];

  if (!task) {
    return {
      emitted: false,
      reason: "no_due_task_for_user",
      userId,
    };
  }

  const taskId = taskIdOf(task);
  const nextCheckAt = clean(task?.voice?.nextCheckAt);

  if (!taskId) {
    return {
      emitted: false,
      reason: "missing_task_id",
      userId,
    };
  }

  const emitKey = `${userId}:${taskId}:${nextCheckAt || "due"}`;

  if (!canEmitOnce(emitKey)) {
    console.log(
      `[${FEATURE}] skip user=${userId} task=${taskId} reason=duplicate_emit_guard`
    );

    return {
      emitted: false,
      reason: "duplicate_emit_guard",
      userId,
      taskId,
    };
  }

  inFlightUsers.add(userId);

  const startedAt = logStart("EmitDueTaskForUser", `user=${userId} task=${taskId}`);

  try {
    const question = makeDueQuestion(task);
    const updatedTask = await markTaskEmitted({ task, question });

    const taskDate = updatedTask?.scheduledDate || task?.scheduledDate || new Date();
    const dateKey = new Date(taskDate).toISOString().slice(0, 10);
    const sessionId = `accountability-${taskId}-${dateKey}`;

    const payload = {
      ok: true,
      eventName: "readiness:voice-due",
      source: "readiness_voice_socket_worker",
      userId,
      taskId,
      task: updatedTask,
      aiQuestion: question,
      speakText: question,
      sessionId,
      nextCheckAt: null,
      at: nowIso(),
      debug: {
        directDueEmit: true,
        connectedCount,
        previousNextCheckAt: nextCheckAt || null,
      },
    };

    emitStudyEvent({ userId }, "readiness:voice-due", payload);

    logEnd(
      "EmitDueTaskForUser",
      startedAt,
      `user=${userId} task=${taskId} emitted=true connected=${connectedCount}`
    );

    console.log(
      `[${FEATURE}] emitted readiness:voice-due user=${userId} task=${taskId}`
    );

    return {
      emitted: true,
      userId,
      taskId,
    };
  } catch (error) {
    logWarn("EmitDueTaskForUser failed", error);

    return {
      emitted: false,
      reason: error?.message || "emit_failed",
      userId,
      taskId,
    };
  } finally {
    inFlightUsers.delete(userId);
  }
}

async function runOnce() {
  if (workerRunning) {
    console.log(`[${FEATURE}] skip run reason=worker_already_running`);
    return;
  }

  workerRunning = true;

  const startedAt = logStart("RunOnce");

  try {
    const dueTasks = await findDueTasks();

    if (!dueTasks.length) {
      logEnd("RunOnce", startedAt, "due=0");
      return;
    }

    const byUser = groupDueTasksByUser(dueTasks);
    const userIds = Array.from(byUser.keys());

    let emittedCount = 0;

    for (const userId of userIds) {
      const result = await emitDueTaskForUser(userId, byUser.get(userId) || []);

      if (result?.emitted) {
        emittedCount += 1;
      }
    }

    logEnd(
      "RunOnce",
      startedAt,
      `due=${dueTasks.length} users=${userIds.length} emitted=${emittedCount}`
    );
  } catch (error) {
    logWarn("RunOnce failed", error);
    logEnd("RunOnce", startedAt, "failed=true");
  } finally {
    workerRunning = false;
  }
}

export function startReadinessVoiceSocketWorker() {
  if (timer) {
    console.log(`[${FEATURE}] already running`);
    return timer;
  }

  if (isTrue(process.env.READINESS_VOICE_SOCKET_WORKER_DISABLED)) {
    console.log(`[${FEATURE}] disabled`);
    return null;
  }

  const pollMs = Math.max(
    3000,
    Number(process.env.READINESS_VOICE_SOCKET_WORKER_MS || 10000)
  );

  timer = setInterval(() => {
    runOnce().catch((error) => {
      logWarn("scheduled run failed", error);
    });
  }, pollMs);

  console.log(`[${FEATURE}] started poll=${pollMs}ms`);

  runOnce().catch((error) => {
    logWarn("first run failed", error);
  });

  return timer;
}

export function stopReadinessVoiceSocketWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  workerRunning = false;
  inFlightUsers.clear();

  console.log(`[${FEATURE}] stopped`);
}

export default {
  startReadinessVoiceSocketWorker,
  stopReadinessVoiceSocketWorker,
};