// server/controllers/gemmaResource.controller.js

import mongoose from "mongoose";

import {
  getGemmaResourceHealth,
  getGemmaResourceOverview,
} from "../services/gemmaResource/gemmaResource.service.js";

import {
  createAndRunSaveResourceGraph,
} from "../services/gemmaResource/graphs/saveResource.graph.js";

import GemmaResource from "../models/GemmaResource.js";
import GemmaResourceChunk from "../models/GemmaResourceChunk.js";
import GemmaResourceJob from "../models/GemmaResourceJob.js";

import {
  deleteGemmaResourceCache,
  getGemmaResourceCacheStats,
} from "../services/gemmaResource/localCache.service.js";

function clean(value = "") {
  return String(value || "").trim();
}

function boolQuery(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["true", "1", "yes", "y", "on"].includes(String(value).toLowerCase());
}

function toInt(value, fallback = 30, min = 1, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function isObjectId(value = "") {
  return mongoose.Types.ObjectId.isValid(String(value || ""));
}

function isUnsafeSharedDeviceId(value = "") {
  const id = clean(value).toLowerCase();

  return (
    !id ||
    id === "web" ||
    id === "guest" ||
    id === "anonymous" ||
    id === "test" ||
    id === "default" ||
    id === "local" ||
    id === "device" ||
    id === "browser" ||
    id === "local-device" ||
    id === "local_device" ||
    id === "default-device" ||
    id === "unknown" ||
    id.length < 12
  );
}

function sendOk(res, data, status = 200) {
  return res.status(status).json({
    ok: true,
    data,
  });
}

function sendError(res, error, status = 500) {
  console.error("[gemmaResource.controller]", {
    name: error?.name || "Error",
    message: error?.message || "Gemma Resource request failed.",
    code: error?.code || "",
    statusCode: error?.statusCode || status,
  });

  return res.status(error?.statusCode || status).json({
    ok: false,
    code: error?.code || undefined,
    message: error?.message || "Gemma Resource request failed.",
    error:
      process.env.NODE_ENV === "production"
        ? undefined
        : {
            name: error?.name || "Error",
            stack: error?.stack || "",
          },
  });
}

function makeError(message, statusCode = 400, code = "") {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function getHeader(req, name) {
  const key = String(name || "").toLowerCase();

  return clean(
    req.headers?.[name] ||
      req.headers?.[key] ||
      req.headers?.[name.toUpperCase()] ||
      ""
  );
}

function normalizeOfflineUserId(value = "") {
  const raw = clean(value);
  if (!raw) return "";
  if (raw.startsWith("offline:")) return raw.slice("offline:".length);
  return raw;
}

/**
 * Explicit request identity wins:
 * query/body/header > req.gemmaOwner middleware fallback.
 */
function getOwner(req) {
  const routeOwner = req.gemmaOwner || {};

  const headerOfflineUserId = clean(
    getHeader(req, "x-gemma-offline-user-id") ||
      getHeader(req, "x-offline-user-id") ||
      getHeader(req, "x-local-user-id")
  );

  const bodyOfflineUserId = clean(
    req.body?.offlineUserId ||
      req.query?.offlineUserId ||
      req.body?.offlineProfileId ||
      req.query?.offlineProfileId
  );

  const offlineUserId = normalizeOfflineUserId(
    bodyOfflineUserId || headerOfflineUserId || routeOwner.offlineUserId
  );

  const explicitOwnerKey = clean(
    req.body?.ownerKey ||
      req.query?.ownerKey ||
      getHeader(req, "x-owner-key") ||
      routeOwner.ownerKey
  );

  const rawUserId = clean(
    req.body?.userId ||
      req.query?.userId ||
      getHeader(req, "x-user-id") ||
      req.user?._id ||
      req.user?.id ||
      req.auth?.userId ||
      routeOwner.userId ||
      ""
  );

  const deviceId = clean(
    getHeader(req, "x-device-id") ||
      req.body?.deviceId ||
      req.query?.deviceId ||
      req.params?.deviceId ||
      routeOwner.deviceId
  );

  const safeDeviceId = isUnsafeSharedDeviceId(deviceId) ? "" : deviceId;

  if (offlineUserId) {
    return {
      mode: "offline",
      userId: `offline:${offlineUserId}`,
      rawUserId: rawUserId || offlineUserId,
      offlineUserId,
      ownerKey: explicitOwnerKey || `offline:${offlineUserId}`,
      deviceId: safeDeviceId,
    };
  }

  if (rawUserId) {
    const normalizedRaw = rawUserId.startsWith("offline-user-")
      ? `offline:${rawUserId}`
      : rawUserId;

    return {
      mode: routeOwner.mode || "user",
      userId: normalizedRaw,
      rawUserId,
      offlineUserId: rawUserId.startsWith("offline-user-") ? rawUserId : "",
      ownerKey:
        explicitOwnerKey ||
        (rawUserId.startsWith("offline-user-")
          ? `offline:${rawUserId}`
          : `user:${rawUserId}`),
      deviceId: safeDeviceId,
    };
  }

  if (safeDeviceId) {
    return {
      mode: routeOwner.mode || "device",
      userId: "",
      rawUserId: "",
      offlineUserId: "",
      ownerKey: explicitOwnerKey || `device:${safeDeviceId}`,
      deviceId: safeDeviceId,
    };
  }

  return {
    mode: "none",
    userId: "",
    rawUserId: "",
    offlineUserId: "",
    ownerKey: explicitOwnerKey,
    deviceId: "",
  };
}

function requireOwner(req) {
  const owner = getOwner(req);

  if (!owner.userId && !owner.offlineUserId && !owner.deviceId && !owner.ownerKey) {
    throw makeError(
      "Privacy protection: owner missing. Use login, offline profile, or a unique x-device-id.",
      401,
      "missing_gemma_owner"
    );
  }

  return owner;
}

/**
 * CRITICAL PRIVACY FIX:
 * If ownerKey/offlineUserId/userId/rawUserId exists, NEVER match by deviceId.
 * Device fallback is allowed only when no stronger owner exists.
 */
function ownerConditions(owner = {}) {
  const conditions = [];

  const ownerKey = clean(owner.ownerKey);
  const offlineUserId = normalizeOfflineUserId(owner.offlineUserId);
  const userId = clean(owner.userId);
  const rawUserId = clean(owner.rawUserId);
  const deviceId = clean(owner.deviceId);

  const hasStrongOwner =
    Boolean(ownerKey) ||
    Boolean(offlineUserId) ||
    Boolean(userId) ||
    Boolean(rawUserId);

  if (ownerKey) {
    conditions.push({ ownerKey });
  }

  if (offlineUserId) {
    conditions.push({ offlineUserId });
    conditions.push({ userId: offlineUserId });
    conditions.push({ userId: `offline:${offlineUserId}` });
    conditions.push({ ownerKey: `offline:${offlineUserId}` });
  }

  if (userId) {
    conditions.push({ userId });

    if (userId.startsWith("offline:")) {
      const raw = normalizeOfflineUserId(userId);
      conditions.push({ userId: raw });
      conditions.push({ offlineUserId: raw });
      conditions.push({ ownerKey: `offline:${raw}` });
    }

    if (userId.startsWith("offline-user-")) {
      conditions.push({ userId: `offline:${userId}` });
      conditions.push({ offlineUserId: userId });
      conditions.push({ ownerKey: `offline:${userId}` });
    }
  }

  if (rawUserId) {
    conditions.push({ userId: rawUserId });

    if (rawUserId.startsWith("offline-user-")) {
      conditions.push({ userId: `offline:${rawUserId}` });
      conditions.push({ offlineUserId: rawUserId });
      conditions.push({ ownerKey: `offline:${rawUserId}` });
    }
  }

  if (!hasStrongOwner && deviceId && !isUnsafeSharedDeviceId(deviceId)) {
    conditions.push({ deviceId });
    conditions.push({ ownerKey: `device:${deviceId}` });
  }

  const seen = new Set();

  return conditions.filter((condition) => {
    const key = JSON.stringify(condition);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ownerQuery(owner = {}) {
  const conditions = ownerConditions(owner);

  if (!conditions.length) return { _id: null };
  if (conditions.length === 1) return conditions[0];

  return { $or: conditions };
}

function withOwnerQuery(base = {}, owner = {}) {
  const ownerPart = ownerQuery(owner);

  if (ownerPart.$or) {
    return {
      ...base,
      $and: [...(base.$and || []), { $or: ownerPart.$or }],
    };
  }

  return {
    ...base,
    ...ownerPart,
  };
}

function publicResource(resource) {
  if (!resource) return null;

  if (typeof resource.toClient === "function") {
    const client = resource.toClient();

    return {
      ...client,
      ownerKey: resource.ownerKey || client.ownerKey,
      offlineUserId: resource.offlineUserId || client.offlineUserId,
      userId: resource.userId || client.userId,
      deviceId: resource.deviceId || client.deviceId,
    };
  }

  return {
    id: String(resource._id || resource.id || ""),
    deviceId: resource.deviceId,
    userId: resource.userId,
    offlineUserId: resource.offlineUserId,
    ownerKey: resource.ownerKey,
    title: resource.title,
    sourceType: resource.sourceType,
    sourceUrl: resource.sourceUrl,
    domain: resource.domain,
    originalFileName: resource.originalFileName,
    mimeType: resource.mimeType,
    studyGoal: resource.studyGoal,
    status: resource.status,
    offlineReady: resource.offlineReady,
    progress: resource.progress,
    summary: resource.summary,
    deepExplanation: resource.deepExplanation,
    sections: resource.sections,
    keyPoints: resource.keyPoints,
    concepts: resource.concepts,
    tags: resource.tags,
    quickRevision: resource.quickRevision,
    roadmap: resource.roadmap,
    practiceQuestions: resource.practiceQuestions,
    rawTextPreview: resource.rawTextPreview,
    rawTextChars: resource.rawTextChars,
    chunkCount: resource.chunkCount,
    sectionCount: resource.sectionCount,
    pageCount: resource.pageCount,
    durationSeconds: resource.durationSeconds,
    estimatedStudyMinutes: resource.estimatedStudyMinutes,
    error: resource.error,
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
    lastOpenedAt: resource.lastOpenedAt,
    metadata: resource.metadata,
  };
}

function publicJob(job) {
  if (!job) return null;

  if (typeof job.toClient === "function") {
    return job.toClient();
  }

  return {
    id: String(job._id || job.id || ""),
    jobId: job.jobId,
    deviceId: job.deviceId,
    userId: job.userId,
    offlineUserId: job.offlineUserId,
    ownerKey: job.ownerKey,
    resourceId: job.resourceId ? String(job.resourceId) : "",
    sourceType: job.sourceType,
    title: job.title,
    status: job.status,
    stage: job.stage,
    message: job.message,
    progress: job.progress,
    input: job.input,
    output: job.output,
    error: job.error,
    logs: job.logs,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    failedAt: job.failedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function normalizeSaveInput(req) {
  const body = req.body || {};
  const owner = requireOwner(req);

  const deviceId = clean(owner.deviceId);
  const offlineUserId = clean(owner.offlineUserId);
  const ownerKey = clean(owner.ownerKey);
  const userId = offlineUserId ? `offline:${offlineUserId}` : clean(owner.userId);

  const url = clean(body.url || body.sourceUrl || "");
  const text = clean(body.text || body.content || body.notes || body.pastedText || "");
  const title = clean(body.title || "");
  const sourceType = clean(body.sourceType || "");
  const studyGoal = clean(body.studyGoal || body.goal || "");

  const tags = Array.isArray(body.tags)
    ? body.tags
    : clean(body.tags)
      ? clean(body.tags)
          .split(",")
          .map((item) => clean(item))
          .filter(Boolean)
      : [];

  return {
    deviceId,
    userId,
    offlineUserId,
    ownerKey,
    ownerMode: owner.mode,
    url,
    sourceUrl: url,
    text,
    title,
    sourceType,
    studyGoal,
    tags,
  };
}

async function repairOwnedChildren(resource, owner) {
  if (!resource?._id) return;

  const set = {};

  if (owner.ownerKey) set.ownerKey = owner.ownerKey;
  if (owner.offlineUserId) set.offlineUserId = owner.offlineUserId;
  if (owner.userId) set.userId = owner.userId;
  if (owner.deviceId) set.deviceId = owner.deviceId;

  if (!Object.keys(set).length) return;

  const missingOwnerQuery = {
    resourceId: resource._id,
    $or: [
      { userId: { $exists: false } },
      { userId: "" },
      { userId: null },
      { offlineUserId: { $exists: false } },
      { offlineUserId: "" },
      { offlineUserId: null },
      { ownerKey: { $exists: false } },
      { ownerKey: "" },
      { ownerKey: null },
      { deviceId: { $exists: false } },
      { deviceId: "" },
      { deviceId: null },
    ],
  };

  await Promise.all([
    GemmaResourceChunk.updateMany(missingOwnerQuery, { $set: set }).catch(() => null),
    GemmaResourceJob.updateMany(missingOwnerQuery, { $set: set }).catch(() => null),
  ]);
}

function getPublicChunkProjection(includeChunkText = false) {
  if (includeChunkText) return GemmaResourceChunk.publicFields();

  return {
    ...GemmaResourceChunk.publicFields(),
    text: 0,
  };
}

export async function health(req, res) {
  try {
    const data = await getGemmaResourceHealth();
    return sendOk(res, data);
  } catch (error) {
    return sendError(res, error);
  }
}

export async function overview(req, res) {
  try {
    const data = await getGemmaResourceOverview();
    return sendOk(res, data);
  } catch (error) {
    return sendError(res, error);
  }
}

export async function saveResource(req, res) {
  try {
    const input = normalizeSaveInput(req);

    if (!input.url && !input.text && !req.file) {
      return sendError(
        res,
        new Error("Provide a URL, pasted text/code/notes, or upload a file."),
        400
      );
    }

    const result = await createAndRunSaveResourceGraph({
      input,
      file: req.file || null,
      runInBackground: true,
    });

    return sendOk(res, result, 202);
  } catch (error) {
    return sendError(res, error, error.statusCode || 400);
  }
}

export async function uploadResource(req, res) {
  return saveResource(req, res);
}

export async function getJob(req, res) {
  try {
    const owner = requireOwner(req);
    const jobId = clean(req.params.jobId);

    if (!jobId) {
      return sendError(res, new Error("jobId is required."), 400);
    }

    const job = await GemmaResourceJob.findOne(withOwnerQuery({ jobId }, owner));

    if (!job) {
      const exists = await GemmaResourceJob.exists({ jobId });

      return sendError(
        res,
        makeError(
          exists
            ? "Forbidden: this job belongs to another user/profile/device."
            : "Job not found.",
          exists ? 403 : 404,
          exists ? "job_forbidden" : "job_not_found"
        ),
        exists ? 403 : 404
      );
    }

    return sendOk(res, publicJob(job));
  } catch (error) {
    return sendError(res, error, error.statusCode || 404);
  }
}

export async function listResources(req, res) {
  try {
    const owner = requireOwner(req);
    const q = clean(req.query.q || req.query.search || "");
    const sourceType = clean(req.query.sourceType || req.query.type || "");
    const status = clean(req.query.status || "");
    const offlineOnly = boolQuery(req.query.offlineOnly, false);
    const limit = toInt(req.query.limit, 30, 1, 100);
    const page = toInt(req.query.page, 1, 1, 100000);

    const query = withOwnerQuery(
      {
        status: { $ne: "archived" },
      },
      owner
    );

    if (sourceType && sourceType !== "all") query.sourceType = sourceType;
    if (status && status !== "all") query.status = status;
    if (offlineOnly) query.offlineReady = true;

    if (q) {
      query.$text = { $search: q };
    }

    const skip = (page - 1) * limit;
    const findQuery = GemmaResource.find(query).select(GemmaResource.publicFields());

    if (q) {
      findQuery.sort({ score: { $meta: "textScore" } });
    } else {
      findQuery.sort({ updatedAt: -1 });
    }

    const [items, total] = await Promise.all([
      findQuery.skip(skip).limit(limit),
      GemmaResource.countDocuments(query),
    ]);

    return sendOk(res, {
      resources: items.map(publicResource),
      page,
      limit,
      total,
      hasMore: skip + items.length < total,
    });
  } catch (error) {
    return sendError(res, error, error.statusCode || 400);
  }
}

export async function getResource(req, res) {
  try {
    const owner = requireOwner(req);
    const resourceId = clean(req.params.resourceId);
    const includeChunkText = boolQuery(req.query.includeChunkText, false);
    const chunkLimit = toInt(req.query.chunkLimit, 80, 1, 300);

    if (!isObjectId(resourceId)) {
      return sendError(res, new Error("Invalid resourceId."), 400);
    }

    const query = withOwnerQuery(
      {
        _id: resourceId,
        status: { $ne: "archived" },
      },
      owner
    );

    const resource = await GemmaResource.findOne(query).select(
      GemmaResource.publicFields()
    );

    if (!resource) {
      const exists = await GemmaResource.exists({ _id: resourceId });

      return sendError(
        res,
        makeError(
          exists
            ? "Forbidden: this resource belongs to another user/profile/device."
            : "Resource not found.",
          exists ? 403 : 404,
          exists ? "resource_forbidden" : "resource_not_found"
        ),
        exists ? 403 : 404
      );
    }

    resource.lastOpenedAt = new Date();

    if (!resource.ownerKey && owner.ownerKey) resource.ownerKey = owner.ownerKey;
    if (!resource.offlineUserId && owner.offlineUserId) {
      resource.offlineUserId = owner.offlineUserId;
    }

    if (owner.userId && resource.userId !== owner.userId) {
      const legacyMatches =
        resource.userId === owner.offlineUserId ||
        resource.userId === owner.rawUserId ||
        resource.userId === `offline:${owner.offlineUserId}`;

      if (legacyMatches) resource.userId = owner.userId;
    }

    await resource.save();
    await repairOwnedChildren(resource, owner);

    const chunks = await GemmaResourceChunk.find({ resourceId: resource._id })
      .select(getPublicChunkProjection(includeChunkText))
      .sort({ index: 1 })
      .limit(chunkLimit);

    const latestJob = await GemmaResourceJob.findOne(
      withOwnerQuery({ resourceId: resource._id }, owner)
    ).sort({ updatedAt: -1 });

    let cacheStats = null;

    if (boolQuery(req.query.includeCacheStats, false)) {
      cacheStats = await getGemmaResourceCacheStats(resource._id).catch(() => null);
    }

    return sendOk(res, {
      resource: publicResource(resource),
      chunks: chunks.map((chunk) =>
        typeof chunk.toClient === "function"
          ? chunk.toClient({ includeText: includeChunkText })
          : chunk
      ),
      latestJob: publicJob(latestJob),
      cacheStats,
    });
  } catch (error) {
    return sendError(res, error, error.statusCode || 400);
  }
}

export async function deleteResource(req, res) {
  try {
    const owner = requireOwner(req);
    const resourceId = clean(req.params.resourceId);

    if (!isObjectId(resourceId)) {
      return sendError(res, new Error("Invalid resourceId."), 400);
    }

    const resource = await GemmaResource.findOne(
      withOwnerQuery({ _id: resourceId }, owner)
    );

    if (!resource) {
      const exists = await GemmaResource.exists({ _id: resourceId });

      return sendError(
        res,
        makeError(
          exists
            ? "Forbidden: this resource belongs to another user/profile/device."
            : "Resource not found.",
          exists ? 403 : 404,
          exists ? "resource_forbidden" : "resource_not_found"
        ),
        exists ? 403 : 404
      );
    }

    await Promise.all([
      GemmaResourceChunk.deleteMany({ resourceId: resource._id }),
      GemmaResourceJob.updateMany(
        withOwnerQuery({ resourceId: resource._id }, owner),
        {
          $set: {
            status: "failed",
            message: "Resource was deleted.",
            error: "Resource was deleted.",
            completedAt: new Date(),
          },
        }
      ),
      deleteGemmaResourceCache(resource._id).catch(() => null),
    ]);

    await resource.deleteOne();

    return sendOk(res, {
      deleted: true,
      resourceId,
    });
  } catch (error) {
    return sendError(res, error, error.statusCode || 400);
  }
}

export async function notImplemented(req, res) {
  return res.status(501).json({
    ok: false,
    message:
      "This Gemma Resource & Tutor endpoint is not implemented yet. Complete the next implementation step first.",
  });
}