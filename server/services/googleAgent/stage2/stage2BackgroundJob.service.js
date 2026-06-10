"use strict";

const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");

const persistence = require("./stage2SessionPersistence");
const { buildSourceContext } = require("../sourceContext/sourceContextPipeline");
const { teachNodeWithAdkPipeline } = require("./stage2LessonOrchestrator");
const googleTtsVoiceService = require("../googleTtsVoice.service");

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const QUEUE_NAME = "lumina_lesson_generation";
const CONCURRENCY = Number(process.env.LESSON_WORKER_CONCURRENCY || 3);

let _connection = null;
let _queue = null;
let _worker = null;
let _redisOk = false;

// SSE: sessionId → Set of { res, req } objects
const _sseClients = new Map();

function getRedisConnection() {
  if (_connection) return _connection;
  _connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });
  _connection.on("connect", () => {
    _redisOk = true;
    console.log("[BackgroundJob] Redis connected:", REDIS_URL);
  });
  _connection.on("error", (err) => {
    _redisOk = false;
    console.error("[BackgroundJob] Redis error:", err.message);
  });
  return _connection;
}

function getQueue() {
  if (_queue) return _queue;
  const conn = getRedisConnection();
  _queue = new Queue(QUEUE_NAME, { connection: conn });
  return _queue;
}

// ── SSE helpers ─────────────────────────────────────────────────────────────

function sseRegister(sessionId, res) {
  if (!_sseClients.has(sessionId)) _sseClients.set(sessionId, new Set());
  _sseClients.get(sessionId).add(res);
}

function sseUnregister(sessionId, res) {
  const set = _sseClients.get(sessionId);
  if (set) {
    set.delete(res);
    if (set.size === 0) _sseClients.delete(sessionId);
  }
}

function sseEmit(sessionId, eventName, data) {
  const set = _sseClients.get(sessionId);
  if (!set || set.size === 0) return;
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch (_) {
      set.delete(res);
    }
  }
}

// ── Job processing ────────────────────────────────────────────────────────────

async function processLessonJob(job) {
  const {
    sessionId,
    ownerKey,
    resourceId,
    treeId,
    nodeId,
    nodeTitle,
    selectedNode,
    body,
  } = job.data;

  console.log(`[BackgroundJob] Starting session ${sessionId} node=${nodeId}`);

  try {
    await persistence.updateSessionStatus(sessionId, "running", {
      "metadata.workerStartedAt": new Date().toISOString(),
    });
    sseEmit(sessionId, "status", { status: "running", sessionId });

    // PASS 1 — Build source context
    let enrichedBody = body || {};
    if (resourceId && treeId && nodeId) {
      try {
        const sourceCtx = await buildSourceContext({
          ownerKey,
          resourceId,
          treeId,
          nodeId,
        });
        enrichedBody = { ...enrichedBody, ...sourceCtx, _sourceContextInjected: true };
        sseEmit(sessionId, "status", { status: "source_ready", sessionId });
        await persistence.updateSessionStatus(sessionId, "running", {
          "metadata.sourceReady": true,
          "metadata.evidenceCount": (sourceCtx.selectedEvidence || []).length,
        });
      } catch (ctxErr) {
        console.warn(`[BackgroundJob] sourceContext failed for ${sessionId}:`, ctxErr.message);
      }
    }

    // PASS 2 — Run Python pipeline
    sseEmit(sessionId, "status", { status: "generating", sessionId });

    const result = await teachNodeWithAdkPipeline(enrichedBody, {
      studentLevel: enrichedBody.studentLevel || "beginner",
      lessonMode: enrichedBody.lessonMode || "masterclass",
      timeoutMs: Number(process.env.STAGE2_TOTAL_TIMEOUT_MS || 840000),
    });

    const boardScreens = result.boardScreens || result.premiumBoardScreens || [];
    const boardCommands = result.boardCommands || result.commands || [];

    if (!boardScreens.length && !boardCommands.length) {
      throw new Error("Pipeline returned 0 screens and 0 commands — empty result");
    }

    sseEmit(sessionId, "status", {
      status: "pipeline_done",
      sessionId,
      screens: boardScreens.length,
      commands: boardCommands.length,
    });

    // PASS 3 — TTS
    let voiceAudio = { ok: false, ttsUsed: false, enabled: false };
    try {
      voiceAudio = await googleTtsVoiceService.synthesizeLessonVoice({
        sessionId,
        selectedNode: selectedNode || {},
        owner: { ownerKey, offlineUserId: ownerKey, deviceId: "worker" },
        voiceScript: result.voiceScript || [],
        subtitles: result.subtitles || [],
        maxVoiceLines: Number(process.env.GOOGLE_TTS_MAX_LINES || 60),
        requireRealTts: false,
        body: {},
      });
    } catch (ttsErr) {
      console.warn(`[BackgroundJob] TTS failed for ${sessionId}:`, ttsErr.message);
    }

    // PASS 4 — Save result
    await persistence.saveSessionResult(sessionId, ownerKey, {
      ...result,
      voiceAudio,
      metadata: {
        ...(result.metadata || {}),
        fallbackUsed: false,
        ttsUsed: voiceAudio.ttsUsed,
      },
    });

    sseEmit(sessionId, "lesson_ready", {
      sessionId,
      screens: boardScreens.length,
      commands: boardCommands.length,
      voiceLines: (result.voiceScript || []).length,
      ttsUsed: voiceAudio.ttsUsed,
    });

    console.log(
      `[BackgroundJob] DONE session=${sessionId} screens=${boardScreens.length} commands=${boardCommands.length}`
    );
  } catch (err) {
    console.error(`[BackgroundJob] FAILED session=${sessionId}:`, err.message);
    await persistence.updateSessionStatus(sessionId, "failed", {
      "metadata.errorMessage": err.message,
      "metadata.failedAt": new Date().toISOString(),
    }).catch(() => {});
    sseEmit(sessionId, "failed", { sessionId, error: err.message });
    throw err;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

async function enqueueLesson(params = {}) {
  const { sessionId, ownerKey, resourceId, treeId, nodeId } = params;
  const queue = getQueue();

  const jobId = `lesson_${sessionId}`;
  await queue.add(
    "teach_node",
    { ...params },
    {
      jobId,
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 50,
    }
  );

  console.log(`[BackgroundJob] Enqueued lesson job ${jobId} for node=${nodeId}`);
  return { jobId, queued: true };
}

function startWorker() {
  if (_worker) return _worker;

  const conn = getRedisConnection();
  conn.connect().catch((err) => {
    console.error("[BackgroundJob] Redis connect error:", err.message);
  });

  _worker = new Worker(QUEUE_NAME, processLessonJob, {
    connection: getRedisConnection(),
    concurrency: CONCURRENCY,
  });

  _worker.on("completed", (job) => {
    console.log(`[Worker] Job ${job.id} completed`);
  });
  _worker.on("failed", (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err.message);
  });
  _worker.on("error", (err) => {
    console.error("[Worker] Worker error:", err.message);
  });

  console.log(`[BackgroundJob] Worker started, concurrency=${CONCURRENCY}`);
  return _worker;
}

async function getJobStatus(sessionId) {
  const queue = getQueue();
  const jobId = `lesson_${sessionId}`;
  const job = await queue.getJob(jobId);
  if (!job) return { found: false, jobId };
  const state = await job.getState();
  return { found: true, jobId, state, progress: job.progress };
}

function isRedisOk() {
  return _redisOk;
}

module.exports = {
  enqueueLesson,
  startWorker,
  getJobStatus,
  sseRegister,
  sseUnregister,
  sseEmit,
  isRedisOk,
};
