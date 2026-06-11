"use strict";

const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");

const persistence = require("./stage2SessionPersistence");
const { buildSourceContext } = require("../sourceContext/sourceContextPipeline");
const { teachNodeWithAdkPipeline } = require("./stage2LessonOrchestrator");
const googleTtsVoiceService = require("../googleTtsVoice.service");

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const WORKER_CONTRACT_VERSION = "stage2_source_truth_worker_v2";
const QUEUE_NAME = process.env.STAGE2_LESSON_QUEUE_NAME || "lumina_lesson_generation_stage2_v2";
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

function mergeAudioIntoVoiceScript(voiceScript = [], voiceAudio = {}) {
  if (!Array.isArray(voiceScript) || !Array.isArray(voiceAudio.audioClips)) return 0;
  const byLineId = new Map();
  voiceAudio.audioClips.forEach((clip, i) => {
    const url = clip.dataUrl || clip.audioUrl;
    if (!url) return;
    if (clip.lineId) byLineId.set(clip.lineId, url);
    if (clip.voiceId) byLineId.set(clip.voiceId, url);
    byLineId.set(`__index_${i}`, url);
  });
  let merged = 0;
  voiceScript.forEach((line, i) => {
    const id = line?.lineId || line?.voiceId || line?.id;
    const url = byLineId.get(id) || byLineId.get(`__index_${i}`);
    if (url) {
      line.audioUrl = url;
      merged += 1;
    }
  });
  return merged;
}

async function updateJobProgress(job, progress = {}) {
  if (!job || typeof job.updateProgress !== "function") return;
  try {
    await job.updateProgress(progress);
  } catch (err) {
    console.warn(`[BackgroundJob] progress update failed: ${err.message}`);
  }
}

function lessonArtifactCounts(lesson = {}) {
  const boardScreens = lesson.boardScreens || lesson.premiumBoardScreens || [];
  const boardCommands = lesson.boardCommands || lesson.commands || [];
  const voiceScript = lesson.voiceScript || [];
  const subtitles = lesson.subtitles || [];
  return {
    boardScreens: Array.isArray(boardScreens) ? boardScreens.length : 0,
    boardCommands: Array.isArray(boardCommands) ? boardCommands.length : 0,
    voiceScript: Array.isArray(voiceScript) ? voiceScript.length : 0,
    subtitles: Array.isArray(subtitles) ? subtitles.length : 0,
  };
}

function compactSourceTruthProof(sourceCtx = {}) {
  const selectedNode = sourceCtx.selectedNode || {};
  const selectedEvidence = Array.isArray(sourceCtx.selectedEvidence) ? sourceCtx.selectedEvidence : [];
  const sourceRefs = Array.isArray(sourceCtx.sourceRefs) ? sourceCtx.sourceRefs : [];
  const pageImages = Array.isArray(sourceCtx.pageImages) ? sourceCtx.pageImages : [];
  const selectedPageFullText = typeof sourceCtx.selectedPageFullText === "string"
    ? sourceCtx.selectedPageFullText
    : "";
  const fullPdfSummary = sourceCtx.fullPdfSummary || {};
  const fullPdfOutline = sourceCtx.fullPdfOutline || {};

  const selectedNodePages = [
    ...(Array.isArray(selectedNode.pageRefs) ? selectedNode.pageRefs : []),
    ...(Array.isArray(selectedNode.pages) ? selectedNode.pages : []),
    ...(Array.isArray(selectedNode.sourceRefs) ? selectedNode.sourceRefs.map((ref) => ref?.page) : []),
  ]
    .map(Number)
    .filter((page) => Number.isFinite(page) && page > 0)
    .filter((page, index, arr) => arr.indexOf(page) === index)
    .sort((a, b) => a - b);

  const imagePages = pageImages
    .map((image) => Number(image?.page))
    .filter((page) => Number.isFinite(page) && page > 0);
  const imagePageSet = new Set(imagePages);
  const pageImageRefs = pageImages
    .map((image) => ({
      page: Number(image?.page),
      imageUrl: image?.imageUrl || "",
      imagePath: image?.imagePath || image?.path || "",
      mimeType: image?.mimeType || "image/png",
      exists: Boolean(image?.exists),
      hasBase64: Boolean(image?.base64),
    }))
    .filter((image) => Number.isFinite(image.page) && image.page > 0)
    .sort((a, b) => a.page - b.page);

  return {
    sourceContextInjected: true,
    selectedEvidenceCount: selectedEvidence.length,
    sourceRefsCount: sourceRefs.length,
    selectedPageFullTextIncluded: selectedPageFullText.length > 0,
    selectedPageFullTextLength: selectedPageFullText.length,
    pageImagesCount: pageImages.length,
    pageImageRefs,
    selectedNodePages,
    pageImagesCoverSelectedPages: selectedNodePages.length > 0
      ? selectedNodePages.every((page) => imagePageSet.has(page))
      : pageImages.length > 0,
    fullPdfSummaryIncluded: Boolean(Object.keys(fullPdfSummary).length),
    fullPdfOutlineIncluded: Boolean(Object.keys(fullPdfOutline).length),
    fallbackUsed: false,
  };
}

async function assertSavedLessonReady(sessionId, ownerKey) {
  if (typeof persistence.loadSessionWithArtifacts !== "function") {
    throw new Error("Saved lesson verification unavailable: loadSessionWithArtifacts is not configured");
  }

  const saved = await persistence.loadSessionWithArtifacts(sessionId, ownerKey);
  const counts = lessonArtifactCounts(saved || {});
  const defects = [];

  if (!saved) defects.push("session reload returned null");
  if (saved && saved.status !== "completed") defects.push(`session status is ${saved.status || "missing"}, expected completed`);
  if (counts.boardScreens <= 0) defects.push("boardScreens empty");
  if (counts.boardCommands <= 0) defects.push("boardCommands empty");
  if (counts.voiceScript <= 0) defects.push("voiceScript empty");

  if (defects.length) {
    throw new Error(`Saved lesson verification failed: ${defects.join("; ")}`);
  }

  return { saved, counts };
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

  if (job.data?.workerContractVersion !== WORKER_CONTRACT_VERSION) {
    throw new Error(
      `Worker contract mismatch: job=${job.data?.workerContractVersion || "missing"} worker=${WORKER_CONTRACT_VERSION}`
    );
  }

  console.log(`[BackgroundJob] Starting session ${sessionId} node=${nodeId}`);

  try {
    await persistence.updateSessionStatus(sessionId, "running", {
      "metadata.workerStartedAt": new Date().toISOString(),
      "metadata.workerContractVersion": WORKER_CONTRACT_VERSION,
      "metadata.queueName": QUEUE_NAME,
    });
    sseEmit(sessionId, "status", {
      status: "running",
      sessionId,
      queueName: QUEUE_NAME,
      workerContractVersion: WORKER_CONTRACT_VERSION,
    });
    await updateJobProgress(job, {
      status: "running",
      step: "worker_started",
      percent: 5,
      queueName: QUEUE_NAME,
      workerContractVersion: WORKER_CONTRACT_VERSION,
    });

    // PASS 1 — Build source context
    let enrichedBody = body || {};
    let sourceTruthProof = null;
    if (resourceId && treeId && nodeId) {
      try {
        const sourceCtx = await buildSourceContext({
          ownerKey,
          resourceId,
          treeId,
          nodeId,
        });
        sourceTruthProof = compactSourceTruthProof(sourceCtx);
        enrichedBody = { ...enrichedBody, ...sourceCtx, _sourceContextInjected: true };
        sseEmit(sessionId, "status", {
          status: "source_ready",
          sessionId,
          sourceTruth: sourceTruthProof,
        });
        await updateJobProgress(job, {
          status: "source_ready",
          step: "source_context",
          percent: 25,
          queueName: QUEUE_NAME,
          workerContractVersion: WORKER_CONTRACT_VERSION,
          sourceTruth: sourceTruthProof,
          evidenceCount: (sourceCtx.selectedEvidence || []).length,
        });
        await persistence.updateSessionStatus(sessionId, "running", {
          "metadata.sourceReady": true,
          "metadata.evidenceCount": (sourceCtx.selectedEvidence || []).length,
          "metadata.sourceTruth": sourceTruthProof,
        });
      } catch (ctxErr) {
        console.error(`[BackgroundJob] sourceContext failed for ${sessionId}:`, ctxErr.message);
        throw ctxErr;
      }
    }

    // PASS 2 — Run Python pipeline
    sseEmit(sessionId, "status", { status: "generating", sessionId, sourceTruth: sourceTruthProof });
    await updateJobProgress(job, {
      status: "generating",
      step: "adk_pipeline",
      percent: 35,
      queueName: QUEUE_NAME,
      workerContractVersion: WORKER_CONTRACT_VERSION,
      sourceTruth: sourceTruthProof,
    });

    const publishPlayableSegment = async (segmentIndex, segment = {}) => {
      const playable = {
        ...segment,
        segmentIndex,
        boardScreens: segment.boardScreens || segment.premiumBoardScreens || [],
        boardCommands: segment.boardCommands || segment.commands || [],
        voiceScript: segment.voiceScript || [],
        subtitles: segment.subtitles || [],
      };

      sseEmit(sessionId, "status", {
        status: "segment_voice_generating",
        sessionId,
        segmentIndex,
        screens: playable.boardScreens.length,
        commands: playable.boardCommands.length,
      });

      try {
        const voiceAudio = await googleTtsVoiceService.synthesizeLessonVoice({
          sessionId,
          selectedNode: selectedNode || enrichedBody.selectedNode || {},
          owner: { ownerKey, offlineUserId: ownerKey, deviceId: "worker" },
          voiceScript: playable.voiceScript,
          subtitles: playable.subtitles,
          maxVoiceLines: Number(process.env.GOOGLE_TTS_SEGMENT_MAX_LINES || process.env.GOOGLE_TTS_MAX_LINES || 60),
          requireRealTts: false,
          body: {},
        });
        const merged = mergeAudioIntoVoiceScript(playable.voiceScript, voiceAudio);
        playable.voiceAudio = voiceAudio;
        playable.metadata = {
          ...(playable.metadata || {}),
          ttsUsed: Boolean(voiceAudio.ttsUsed),
          audioMergedLines: merged,
          streamingSegment: true,
        };
      } catch (ttsErr) {
        console.warn(`[BackgroundJob] segment ${segmentIndex} TTS failed for ${sessionId}:`, ttsErr.message);
        playable.metadata = {
          ...(playable.metadata || {}),
          ttsUsed: false,
          streamingSegment: true,
          ttsError: ttsErr.message,
        };
      }

      await persistence.saveSessionSegment(sessionId, ownerKey, segmentIndex, playable);
      sseEmit(sessionId, "segment_ready", {
        sessionId,
        segmentIndex,
        segmentUrl: `/api/google-agent/live-tutor/stage2/sessions/${sessionId}/segments/${segmentIndex}`,
        screens: playable.boardScreens.length,
        commands: playable.boardCommands.length,
        voiceLines: playable.voiceScript.length,
        ttsUsed: Boolean(playable.metadata?.ttsUsed),
      });
      await updateJobProgress(job, {
        status: "segment_ready",
        step: "segment_streamed",
        percent: Math.min(85, 45 + segmentIndex * 5),
        queueName: QUEUE_NAME,
        workerContractVersion: WORKER_CONTRACT_VERSION,
        sourceTruth: sourceTruthProof,
        segmentIndex,
        screens: playable.boardScreens.length,
        commands: playable.boardCommands.length,
      });
    };

    const result = await teachNodeWithAdkPipeline(enrichedBody, {
      studentLevel: enrichedBody.studentLevel || "beginner",
      lessonMode: enrichedBody.lessonMode || "masterclass",
      timeoutMs: Number(process.env.STAGE2_TOTAL_TIMEOUT_MS || 840000),
      onSegmentReady: publishPlayableSegment,
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
    await updateJobProgress(job, {
      status: "pipeline_done",
      step: "pipeline_done",
      percent: 85,
      queueName: QUEUE_NAME,
      workerContractVersion: WORKER_CONTRACT_VERSION,
      sourceTruth: sourceTruthProof,
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

    // PASS 3.5 — ★ MERGE audio INTO voice lines (W3.3 — the voice fix).
    // Every line carries its own audioUrl; the frontend plays it directly.
    if (Array.isArray(voiceAudio.audioClips) && voiceAudio.audioClips.length) {
      const merged = mergeAudioIntoVoiceScript(result.voiceScript || [], voiceAudio);
      console.log(`[BackgroundJob] audioUrl merged into ${merged}/${(result.voiceScript || []).length} voice lines`);
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

    const savedProof = await assertSavedLessonReady(sessionId, ownerKey);

    sseEmit(sessionId, "lesson_ready", {
      sessionId,
      screens: savedProof.counts.boardScreens,
      commands: savedProof.counts.boardCommands,
      voiceLines: savedProof.counts.voiceScript,
      ttsUsed: voiceAudio.ttsUsed,
    });
    await updateJobProgress(job, {
      status: "completed",
      step: "lesson_saved",
      percent: 100,
      queueName: QUEUE_NAME,
      workerContractVersion: WORKER_CONTRACT_VERSION,
      sourceTruth: sourceTruthProof,
      ...savedProof.counts,
    });

    console.log(
      `[BackgroundJob] DONE session=${sessionId} screens=${boardScreens.length} commands=${boardCommands.length}`
    );
  } catch (err) {
    console.error(`[BackgroundJob] FAILED session=${sessionId}:`, err.message);
    await persistence.updateSessionStatus(sessionId, "failed", {
      "metadata.errorMessage": err.message,
      "metadata.failedAt": new Date().toISOString(),
      "metadata.workerContractVersion": WORKER_CONTRACT_VERSION,
      "metadata.queueName": QUEUE_NAME,
    }).catch(() => {});
    sseEmit(sessionId, "failed", { sessionId, error: err.message });
    throw err;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

async function enqueueLesson(params = {}) {
  const { sessionId, ownerKey, resourceId, treeId, nodeId } = params;
  if (!sessionId) {
    const err = new Error("sessionId is required to enqueue a lesson job");
    err.statusCode = 400;
    throw err;
  }
  const queue = getQueue();

  const jobName = "teach_node";
  const jobId = `lesson_${sessionId}`;
  const job = await queue.add(
    jobName,
    {
      ...params,
      queueName: QUEUE_NAME,
      workerContractVersion: WORKER_CONTRACT_VERSION,
    },
    {
      jobId,
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 50,
    }
  );

  console.log(`[BackgroundJob] Enqueued lesson job ${jobId} for node=${nodeId} queue=${QUEUE_NAME}`);
  return {
    jobId,
    jobName,
    bullJobId: job?.id || jobId,
    queued: true,
    queueName: QUEUE_NAME,
    workerContractVersion: WORKER_CONTRACT_VERSION,
  };
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

  console.log(`[BackgroundJob] Worker started, queue=${QUEUE_NAME}, contract=${WORKER_CONTRACT_VERSION}, concurrency=${CONCURRENCY}`);
  return _worker;
}

async function getJobStatus(sessionId) {
  const queue = getQueue();
  const jobId = `lesson_${sessionId}`;
  const job = await queue.getJob(jobId);
  if (!job) {
    return {
      found: false,
      jobId,
      queueName: QUEUE_NAME,
      workerContractVersion: WORKER_CONTRACT_VERSION,
    };
  }
  const state = await job.getState();
  return {
    found: true,
    jobId,
    state,
    progress: job.progress,
    queueName: QUEUE_NAME,
    workerContractVersion: WORKER_CONTRACT_VERSION,
  };
}

function isRedisOk() {
  return _redisOk;
}

module.exports = {
  enqueueLesson,
  startWorker,
  getJobStatus,
  QUEUE_NAME,
  WORKER_CONTRACT_VERSION,
  sseRegister,
  sseUnregister,
  sseEmit,
  isRedisOk,
  __test: {
    processLessonJob,
    assertSavedLessonReady,
    lessonArtifactCounts,
    compactSourceTruthProof,
  },
};
