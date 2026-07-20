// server/middleware/gemmaResourcePrivacy.middleware.js
//
// Gemma Resource offline/privacy middleware.
//
// Protects:
// - Offline Library
// - Resource detail
// - Study Pack
// - Flipable Book
// - Ask Gemma
// - Code Tutor
// - Quiz
//
// Privacy rule:
// - If ownerKey/offlineUserId exists, match only strong owner fields.
// - Do NOT match by deviceId when offlineUserId/ownerKey exists.
// - Device fallback is allowed only when no stronger owner exists.
// - This prevents same-browser users from seeing each other's resources.

import mongoose from "mongoose";

import GemmaResource from "../models/GemmaResource.js";
import GemmaResourceBook from "../models/GemmaResourceBook.js";

function clean(value = "") {
  return String(value || "").trim();
}

function normalize(value = "") {
  return clean(value).toLowerCase();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const next = clean(value);
    if (next) return next;
  }
  return "";
}

function boolEnv(name, fallback = false) {
  const value = normalize(process.env[name]);
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function isObjectId(value = "") {
  return mongoose.Types.ObjectId.isValid(String(value || ""));
}

function getHeader(req, name) {
  const raw = String(name || "");
  const lower = raw.toLowerCase();

  return clean(
    req.headers?.[raw] ||
      req.headers?.[lower] ||
      req.headers?.[raw.toUpperCase()] ||
      ""
  );
}

function offlineModeEnabled() {
  return (
    boolEnv("OFFLINE_MODE", false) ||
    boolEnv("GEMMA_RESOURCE_OFFLINE_MODE", false) ||
    boolEnv("GEMMA_RESOURCE_ENABLED", false) ||
    true
  );
}

function normalizeOfflineUserId(value = "") {
  const raw = clean(value);
  if (!raw) return "";
  if (raw.startsWith("offline:")) return raw.slice("offline:".length);
  return raw;
}

function getRealAuthUserId(req) {
  return firstNonEmpty(
    req.user?._id,
    req.user?.id,
    req.user?.email,
    req.user?.sub,
    req.auth?.userId,
    req.auth?.id,
    req.auth?._id,
    req.authUser?._id,
    req.authUser?.id,
    req.session?.user?._id,
    req.session?.user?.id
  );
}

function getOfflineUserId(req) {
  return normalizeOfflineUserId(
    firstNonEmpty(
      req.body?.offlineUserId,
      req.body?.offlineProfileId,
      req.body?.localUserId,

      req.query?.offlineUserId,
      req.query?.offlineProfileId,
      req.query?.localUserId,

      getHeader(req, "x-gemma-offline-user-id"),
      getHeader(req, "x-offline-user-id"),
      getHeader(req, "x-offline-userid"),
      getHeader(req, "x-local-user-id"),
      getHeader(req, "x-local-userid")
    )
  );
}

function getOwnerKey(req) {
  return firstNonEmpty(
    req.body?.ownerKey,
    req.query?.ownerKey,
    getHeader(req, "x-owner-key")
  );
}

function getBodyUserId(req) {
  return firstNonEmpty(
    req.body?.userId,
    req.query?.userId,
    getHeader(req, "x-user-id")
  );
}

function getDeviceId(req) {
  return firstNonEmpty(
    getHeader(req, "x-device-id"),
    getHeader(req, "x-deviceid"),
    getHeader(req, "x-client-id"),
    getHeader(req, "x-installation-id"),
    req.body?.deviceId,
    req.query?.deviceId,
    req.params?.deviceId
  );
}

function getResourceId(req) {
  return firstNonEmpty(
    req.params?.resourceId,
    req.body?.resourceId,
    req.query?.resourceId
  );
}

function getBookId(req) {
  return firstNonEmpty(req.params?.bookId, req.body?.bookId, req.query?.bookId);
}

function isUnsafeDeviceId(deviceId = "") {
  const value = normalize(deviceId);

  if (!value) return true;

  const blocked = new Set([
    "web",
    "guest",
    "anonymous",
    "test",
    "default",
    "local",
    "device",
    "browser",
    "local-device",
    "local_device",
    "default-device",
    "unknown",
  ]);

  if (blocked.has(value)) return true;
  if (value.length < 12) return true;

  return false;
}

function isUnsafeOfflineUserId(userId = "") {
  const value = normalize(userId);

  if (!value) return true;

  const blocked = new Set([
    "web",
    "guest",
    "anonymous",
    "test",
    "default",
    "local",
    "device",
    "browser",
    "local-device",
    "local_device",
    "default-device",
    "unknown",
    "offline-user-",
    "offline-device-",
  ]);

  if (blocked.has(value)) return true;
  if (value.length < 8) return true;

  return false;
}

function isGuestUserId(userId = "") {
  const value = normalize(userId);

  return (
    !value ||
    value === "guest" ||
    value === "anonymous" ||
    value === "web" ||
    value === "test" ||
    value === "default" ||
    value === "local"
  );
}

function isHealthOrPublicRead(req) {
  const path = clean(req.path || req.originalUrl || "");

  return (
    path === "/health" ||
    path.endsWith("/health") ||
    path.includes("/health?") ||
    path === "/overview" ||
    path.endsWith("/overview") ||
    path.includes("/overview?")
  );
}

function sendPrivacyError(res, message, status = 403, code = "privacy_error") {
  return res.status(status).json({
    ok: false,
    code,
    message,
  });
}

/**
 * Owner priority:
 * 1. Explicit offlineUserId from body/query/header
 * 2. Explicit ownerKey from body/query/header
 * 3. Real authenticated user
 * 4. Explicit userId
 * 5. Safe device fallback only when no stronger owner exists
 */
function buildGemmaOwner(req) {
  const explicitOfflineUserId = getOfflineUserId(req);
  const explicitOwnerKey = getOwnerKey(req);
  const realAuthUserId = clean(getRealAuthUserId(req));
  const bodyUserId = clean(getBodyUserId(req));
  const rawDeviceId = clean(getDeviceId(req));
  const safeDeviceId = isUnsafeDeviceId(rawDeviceId) ? "" : rawDeviceId;

  if (offlineModeEnabled() && !isUnsafeOfflineUserId(explicitOfflineUserId)) {
    return {
      mode: "offline_user",
      userId: `offline:${explicitOfflineUserId}`,
      rawUserId: explicitOfflineUserId,
      authUserId: realAuthUserId,
      bodyUserId,
      offlineUserId: explicitOfflineUserId,
      ownerKey: explicitOwnerKey || `offline:${explicitOfflineUserId}`,
      deviceId: safeDeviceId,
      hasRealUser: Boolean(realAuthUserId && !isGuestUserId(realAuthUserId)),
      hasOfflineProfile: true,
      hasSafeDevice: Boolean(safeDeviceId),
      offlineFallback: true,
      strongOwner: true,
    };
  }

  if (explicitOwnerKey) {
    const offlineFromOwnerKey = explicitOwnerKey.startsWith("offline:")
      ? normalizeOfflineUserId(explicitOwnerKey)
      : "";

    return {
      mode: offlineFromOwnerKey ? "offline_user" : "owner_key",
      userId: offlineFromOwnerKey
        ? `offline:${offlineFromOwnerKey}`
        : bodyUserId && !isGuestUserId(bodyUserId)
          ? bodyUserId
          : "",
      rawUserId: offlineFromOwnerKey || bodyUserId,
      authUserId: realAuthUserId,
      bodyUserId,
      offlineUserId: offlineFromOwnerKey,
      ownerKey: explicitOwnerKey,
      deviceId: safeDeviceId,
      hasRealUser: Boolean(realAuthUserId && !isGuestUserId(realAuthUserId)),
      hasOfflineProfile: Boolean(offlineFromOwnerKey),
      hasSafeDevice: Boolean(safeDeviceId),
      offlineFallback: true,
      strongOwner: true,
    };
  }

  if (realAuthUserId && !isGuestUserId(realAuthUserId)) {
    return {
      mode: "user",
      userId: realAuthUserId,
      rawUserId: realAuthUserId,
      authUserId: realAuthUserId,
      bodyUserId,
      offlineUserId: "",
      ownerKey: `user:${realAuthUserId}`,
      deviceId: safeDeviceId,
      hasRealUser: true,
      hasOfflineProfile: false,
      hasSafeDevice: Boolean(safeDeviceId),
      offlineFallback: false,
      strongOwner: true,
    };
  }

  if (bodyUserId && !isGuestUserId(bodyUserId)) {
    const offlineLike = bodyUserId.startsWith("offline-user-");
    const offlineUserId = offlineLike ? bodyUserId : "";

    return {
      mode: offlineLike ? "offline_user" : "user",
      userId: offlineLike ? `offline:${offlineUserId}` : bodyUserId,
      rawUserId: bodyUserId,
      authUserId: "",
      bodyUserId,
      offlineUserId,
      ownerKey: offlineLike ? `offline:${offlineUserId}` : `user:${bodyUserId}`,
      deviceId: safeDeviceId,
      hasRealUser: !offlineLike,
      hasOfflineProfile: offlineLike,
      hasSafeDevice: Boolean(safeDeviceId),
      offlineFallback: offlineLike,
      strongOwner: true,
    };
  }

  if (offlineModeEnabled() && safeDeviceId) {
    return {
      mode: "device",
      userId: "",
      rawUserId: "",
      authUserId: "",
      bodyUserId: "",
      offlineUserId: "",
      ownerKey: `device:${safeDeviceId}`,
      deviceId: safeDeviceId,
      hasRealUser: false,
      hasOfflineProfile: false,
      hasSafeDevice: true,
      offlineFallback: true,
      strongOwner: false,
    };
  }

  return {
    mode: "none",
    userId: "",
    rawUserId: "",
    authUserId: realAuthUserId,
    bodyUserId,
    offlineUserId: "",
    ownerKey: explicitOwnerKey,
    deviceId: "",
    hasRealUser: false,
    hasOfflineProfile: false,
    hasSafeDevice: false,
    offlineFallback: false,
    strongOwner: Boolean(explicitOwnerKey),
  };
}

function ownerConditions(owner = {}) {
  const conditions = [];

  const ownerKey = clean(owner.ownerKey);
  const userId = clean(owner.userId);
  const rawUserId = clean(owner.rawUserId);
  const authUserId = clean(owner.authUserId);
  const bodyUserId = clean(owner.bodyUserId);
  const offlineUserId = normalizeOfflineUserId(owner.offlineUserId);
  const deviceId = clean(owner.deviceId);

  const hasStrongOwner =
    Boolean(ownerKey) ||
    Boolean(offlineUserId) ||
    Boolean(userId) ||
    Boolean(rawUserId) ||
    Boolean(bodyUserId) ||
    Boolean(authUserId);

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

  if (bodyUserId) {
    conditions.push({ userId: bodyUserId });

    if (bodyUserId.startsWith("offline-user-")) {
      conditions.push({ userId: `offline:${bodyUserId}` });
      conditions.push({ offlineUserId: bodyUserId });
      conditions.push({ ownerKey: `offline:${bodyUserId}` });
    }
  }

  if (authUserId && !isGuestUserId(authUserId)) {
    conditions.push({ userId: authUserId });
    conditions.push({ ownerKey: `user:${authUserId}` });
  }

  /**
   * CRITICAL PRIVACY RULE:
   * Do not use deviceId when a strong owner exists.
   * Otherwise Jana and Anastasia on the same browser/device can see each other's data.
   */
  if (!hasStrongOwner && deviceId && !isUnsafeDeviceId(deviceId)) {
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

export function gemmaOwnerQuery(owner = {}) {
  const conditions = ownerConditions(owner);

  if (!conditions.length) return { _id: null };
  if (conditions.length === 1) return conditions[0];

  return { $or: conditions };
}

export function withGemmaOwner(base = {}, owner = {}) {
  const ownerPart = gemmaOwnerQuery(owner);

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

export function syncGemmaOwnerIntoRequest(req) {
  req.body = req.body || {};
  req.query = req.query || {};

  const owner = req.gemmaOwner || {};

  if (owner.userId) {
    req.body.userId = owner.userId;
    req.query.userId = owner.userId;
  }

  if (owner.rawUserId) {
    req.body.rawUserId = owner.rawUserId;
    req.query.rawUserId = owner.rawUserId;
  }

  if (owner.offlineUserId) {
    req.body.offlineUserId = owner.offlineUserId;
    req.query.offlineUserId = owner.offlineUserId;
  }

  if (owner.ownerKey) {
    req.body.ownerKey = owner.ownerKey;
    req.query.ownerKey = owner.ownerKey;
  }

  if (owner.deviceId) {
    req.body.deviceId = owner.deviceId;
    req.query.deviceId = owner.deviceId;

    if (req.params && Object.prototype.hasOwnProperty.call(req.params, "deviceId")) {
      req.params.deviceId = owner.deviceId;
    }
  }
}

export function attachGemmaResourceOwner(req, res, next) {
  if (isHealthOrPublicRead(req)) return next();

  const owner = buildGemmaOwner(req);

  if (!owner.userId && !owner.deviceId && !owner.ownerKey) {
    return sendPrivacyError(
      res,
      "Privacy guard: Gemma Resource requires login, offline profile id, owner key, or unique deviceId.",
      401,
      "missing_gemma_owner"
    );
  }

  if (!owner.userId && !owner.hasSafeDevice && !owner.ownerKey) {
    return sendPrivacyError(
      res,
      "Privacy guard: unique deviceId is required for offline Gemma Resource. Do not use shared values like local-device, guest, web, default.",
      400,
      "unsafe_device_id"
    );
  }

  req.gemmaOwner = {
    ...owner,
    resourceId: getResourceId(req),
    bookId: getBookId(req),
    requestId: firstNonEmpty(
      getHeader(req, "x-request-id"),
      `${Date.now()}-${Math.random().toString(16).slice(2)}`
    ),
  };

  syncGemmaOwnerIntoRequest(req);

  return next();
}

export function requireGemmaResourceOwner(req, res, next) {
  if (isHealthOrPublicRead(req)) return next();

  const owner = req.gemmaOwner || {};

  if (!owner.userId && !owner.deviceId && !owner.ownerKey) {
    return sendPrivacyError(
      res,
      "Privacy guard: missing Gemma Resource owner.",
      401,
      "missing_gemma_owner"
    );
  }

  return next();
}

export function forceGemmaDeviceParamToOwner(req, _res, next) {
  syncGemmaOwnerIntoRequest(req);
  return next();
}

export async function requireOwnedGemmaResource(req, res, next, resourceId) {
  try {
    if (!isObjectId(resourceId)) {
      return sendPrivacyError(
        res,
        "Valid resourceId is required.",
        400,
        "invalid_resource_id"
      );
    }

    const resource = await GemmaResource.findOne(
      withGemmaOwner(
        {
          _id: resourceId,
          status: { $ne: "archived" },
        },
        req.gemmaOwner
      )
    )
      .select("_id deviceId userId offlineUserId ownerKey title sourceType status")
      .lean();

    if (!resource) {
      const exists = await GemmaResource.exists({ _id: resourceId });

      return sendPrivacyError(
        res,
        exists
          ? "Forbidden: this resource belongs to another user/profile/device."
          : "Gemma resource not found.",
        exists ? 403 : 404,
        exists ? "resource_forbidden" : "resource_not_found"
      );
    }

    req.gemmaResource = resource;
    syncGemmaOwnerIntoRequest(req);

    return next();
  } catch (error) {
    return next(error);
  }
}

export async function requireOwnedGemmaBook(req, res, next, bookId) {
  try {
    if (!isObjectId(bookId)) {
      return sendPrivacyError(
        res,
        "Valid bookId is required.",
        400,
        "invalid_book_id"
      );
    }

    const book = await GemmaResourceBook.findOne(
      withGemmaOwner(
        {
          _id: bookId,
          status: { $ne: "archived" },
        },
        req.gemmaOwner
      )
    )
      .select("_id deviceId userId offlineUserId ownerKey title status")
      .lean();

    if (!book) {
      const exists = await GemmaResourceBook.exists({ _id: bookId });

      return sendPrivacyError(
        res,
        exists
          ? "Forbidden: this book belongs to another user/profile/device."
          : "Book not found.",
        exists ? 403 : 404,
        exists ? "book_forbidden" : "book_not_found"
      );
    }

    req.gemmaBook = book;
    syncGemmaOwnerIntoRequest(req);

    return next();
  } catch (error) {
    return next(error);
  }
}

export async function requireOwnedGemmaBodyResource(req, res, next) {
  const resourceId = getResourceId(req);

  if (!resourceId) {
    return sendPrivacyError(
      res,
      "resourceId is required.",
      400,
      "missing_resource_id"
    );
  }

  return requireOwnedGemmaResource(req, res, next, resourceId);
}

export async function requireOwnedGemmaJoinBooks(req, res, next) {
  try {
    const rawIds = Array.isArray(req.body?.bookIds) ? req.body.bookIds : [];
    const ids = rawIds.filter(isObjectId);

    if (ids.length < 2) {
      return sendPrivacyError(
        res,
        "Select at least 2 valid books to join.",
        400,
        "invalid_book_ids"
      );
    }

    const books = await GemmaResourceBook.find(
      withGemmaOwner(
        {
          _id: {
            $in: ids.map((id) => new mongoose.Types.ObjectId(id)),
          },
          status: "ready",
        },
        req.gemmaOwner
      )
    )
      .select("_id")
      .lean();

    if (books.length !== ids.length) {
      return sendPrivacyError(
        res,
        "Forbidden: one or more selected books belong to another user/profile/device.",
        403,
        "join_book_forbidden"
      );
    }

    syncGemmaOwnerIntoRequest(req);
    return next();
  } catch (error) {
    return next(error);
  }
}

export async function handleListOwnedGemmaBooks(req, res) {
  try {
    const resourceId = clean(req.query?.resourceId);
    const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 30)));

    const query = withGemmaOwner(
      {
        status: { $ne: "archived" },
      },
      req.gemmaOwner
    );

    if (isObjectId(resourceId)) {
      query.sourceResourceIds = new mongoose.Types.ObjectId(resourceId);
    }

    const books = await GemmaResourceBook.find(query)
      .sort({ updatedAt: -1 })
      .limit(limit);

    return res.json({
      ok: true,
      data: books.map((book) =>
        typeof book.toClient === "function" ? book.toClient() : book
      ),
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      message: error?.message || "Could not list Gemma books.",
    });
  }
}

export function getGemmaResourcePrivacyDebug(req) {
  const owner = req.gemmaOwner || {};

  return {
    mode: owner.mode || "none",
    userId: owner.userId || "",
    rawUserId: owner.rawUserId || "",
    authUserId: owner.authUserId || "",
    offlineUserId: owner.offlineUserId || "",
    ownerKey: owner.ownerKey || "",
    deviceId: owner.deviceId || "",
    hasUserOwner: Boolean(owner.userId),
    hasDeviceOwner: Boolean(owner.deviceId),
    hasRealUser: Boolean(owner.hasRealUser),
    hasOfflineProfile: Boolean(owner.hasOfflineProfile),
    hasSafeDevice: Boolean(owner.hasSafeDevice),
    strongOwner: Boolean(owner.strongOwner),
    resourceId: owner.resourceId || "",
    bookId: owner.bookId || "",
    requestId: owner.requestId || "",
  };
}

export default {
  attachGemmaResourceOwner,
  requireGemmaResourceOwner,
  forceGemmaDeviceParamToOwner,
  requireOwnedGemmaResource,
  requireOwnedGemmaBook,
  requireOwnedGemmaBodyResource,
  requireOwnedGemmaJoinBooks,
  handleListOwnedGemmaBooks,
  getGemmaResourcePrivacyDebug,
  gemmaOwnerQuery,
  withGemmaOwner,
};