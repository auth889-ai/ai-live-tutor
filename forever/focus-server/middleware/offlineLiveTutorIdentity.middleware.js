// server/middleware/offlineLiveTutorIdentity.middleware.js
//
// Offline Live Tutor identity + privacy middleware.
//
// Protects:
// - Gemma Resource Live Tutor start
// - pause / resume / control
// - interrupt / repair
// - replay / saved board sessions
//
// Privacy rule:
// - If offlineUserId/ownerKey exists, Live Tutor uses ownerKey = offline:<offlineUserId>.
// - Same browser/device users stay isolated.
// - Device fallback is allowed only when no offline identity exists.

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

function safeIdentityText(value = "") {
  return clean(value)
    .replace(/[^a-zA-Z0-9._:@-]/g, "-")
    .slice(0, 160);
}

function normalizeOfflineUserId(value = "") {
  const raw = safeIdentityText(value);
  if (!raw) return "";
  if (raw.startsWith("offline:")) return raw.slice("offline:".length);
  return raw;
}

function getAuthUserId(req) {
  return firstNonEmpty(
    req.user?.id,
    req.user?._id,
    req.user?.sub,
    req.user?.email
  );
}

function getBodyUserId(req) {
  return firstNonEmpty(
    req.body?.userId,
    req.query?.userId,
    getHeader(req, "x-user-id")
  );
}

function getOwnerKey(req) {
  return firstNonEmpty(
    req.body?.ownerKey,
    req.query?.ownerKey,
    getHeader(req, "x-owner-key")
  );
}

function getOfflineUserId(req) {
  return normalizeOfflineUserId(
    firstNonEmpty(
      req.body?.offlineUserId,
      req.query?.offlineUserId,

      getHeader(req, "x-gemma-offline-user-id"),
      getHeader(req, "x-offline-user-id"),
      getHeader(req, "x-offline-userid"),
      getHeader(req, "x-local-user-id"),
      getHeader(req, "x-local-userid")
    )
  );
}

function getDeviceId(req) {
  return safeIdentityText(
    firstNonEmpty(
      req.body?.deviceId,
      req.query?.deviceId,

      getHeader(req, "x-device-id"),
      getHeader(req, "x-deviceid"),
      getHeader(req, "x-client-id"),
      getHeader(req, "x-installation-id")
    )
  );
}

function getSessionId(req) {
  return firstNonEmpty(
    req.params?.sessionId,
    req.body?.sessionId,
    req.body?.boardId,
    req.query?.sessionId,
    req.query?.boardId
  );
}

function getResourceId(req) {
  return firstNonEmpty(
    req.params?.resourceId,
    req.body?.resourceId,
    req.query?.resourceId
  );
}

function isGuestUser(userId = "") {
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

function isUnsafeOfflineUserId(offlineUserId = "") {
  const value = normalize(offlineUserId);

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
    "user",
    "student",
    "offline-user-",
    "offline-device-",
  ]);

  if (blocked.has(value)) return true;
  if (value.length < 6) return true;

  return false;
}

function isWriteRequest(req) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(
    clean(req.method).toUpperCase()
  );
}

function isHealthOrPublicRead(req) {
  const path = clean(req.path || req.originalUrl || "");
  return path.endsWith("/health") || path.includes("/health?") || path === "/health";
}

function sendPrivacyError(res, message, status = 403, code = "privacy_error") {
  return res.status(status).json({
    ok: false,
    code,
    message,
  });
}

/**
 * Strict identity builder.
 *
 * Priority:
 * 1. Real auth user
 * 2. offlineUserId from explicit headers/body/query
 * 3. ownerKey
 * 4. safe device fallback
 */
function buildIdentity(req) {
  const authUserId = safeIdentityText(getAuthUserId(req));
  const bodyUserId = safeIdentityText(getBodyUserId(req));
  const explicitOfflineUserId = getOfflineUserId(req);
  const explicitOwnerKey = safeIdentityText(getOwnerKey(req));
  const deviceId = getDeviceId(req);

  const hasAuthUser = Boolean(authUserId && !isGuestUser(authUserId));
  const hasOfflineUser = Boolean(
    explicitOfflineUserId && !isUnsafeOfflineUserId(explicitOfflineUserId)
  );
  const hasSafeDevice = Boolean(deviceId && !isUnsafeDeviceId(deviceId));

  if (hasAuthUser) {
    return {
      userId: authUserId,
      rawUserId: authUserId,
      offlineUserId: "",
      deviceId,
      ownerType: "user",
      ownerKey: `user:${authUserId}`,
      hasRealUser: true,
      hasOfflineUser: false,
      hasSafeDevice,
      offlineGuest: false,
      strictOfflineUser: false,
      strongOwner: true,
    };
  }

  if (hasOfflineUser) {
    return {
      userId: `offline:${explicitOfflineUserId}`,
      rawUserId: explicitOfflineUserId,
      offlineUserId: explicitOfflineUserId,
      deviceId,
      ownerType: "offline",
      ownerKey: explicitOwnerKey || `offline:${explicitOfflineUserId}`,
      hasRealUser: false,
      hasOfflineUser: true,
      hasSafeDevice,
      offlineGuest: true,
      strictOfflineUser: true,
      strongOwner: true,
    };
  }

  if (explicitOwnerKey) {
    const offlineFromOwnerKey = explicitOwnerKey.startsWith("offline:")
      ? normalizeOfflineUserId(explicitOwnerKey)
      : "";

    return {
      userId: offlineFromOwnerKey
        ? `offline:${offlineFromOwnerKey}`
        : bodyUserId && !isGuestUser(bodyUserId)
          ? bodyUserId
          : "guest",
      rawUserId: offlineFromOwnerKey || bodyUserId || "guest",
      offlineUserId: offlineFromOwnerKey,
      deviceId,
      ownerType: offlineFromOwnerKey ? "offline" : "ownerKey",
      ownerKey: explicitOwnerKey,
      hasRealUser: false,
      hasOfflineUser: Boolean(offlineFromOwnerKey),
      hasSafeDevice,
      offlineGuest: true,
      strictOfflineUser: Boolean(offlineFromOwnerKey),
      strongOwner: true,
    };
  }

  return {
    userId: bodyUserId && !isGuestUser(bodyUserId) ? bodyUserId : "guest",
    rawUserId: bodyUserId || "guest",
    offlineUserId: "",
    deviceId,
    ownerType: "device",
    ownerKey: hasSafeDevice ? `device:${deviceId}` : "",
    hasRealUser: Boolean(bodyUserId && !isGuestUser(bodyUserId)),
    hasOfflineUser: false,
    hasSafeDevice,
    offlineGuest: true,
    strictOfflineUser: false,
    strongOwner: false,
  };
}

export function offlineLiveTutorIdentity(req, res, next) {
  const identity = buildIdentity(req);

  req.liveTutorIdentity = {
    ...identity,
    resourceId: getResourceId(req),
    sessionId: getSessionId(req),
    requestId: firstNonEmpty(
      getHeader(req, "x-request-id"),
      `${Date.now()}-${Math.random().toString(16).slice(2)}`
    ),
  };

  req.body = req.body || {};
  req.query = req.query || {};

  req.body.userId = identity.userId;
  req.query.userId = identity.userId;

  if (identity.rawUserId) {
    req.body.rawUserId = identity.rawUserId;
    req.query.rawUserId = identity.rawUserId;
  }

  if (identity.deviceId) {
    req.body.deviceId = identity.deviceId;
    req.query.deviceId = identity.deviceId;
  }

  if (identity.offlineUserId) {
    req.body.offlineUserId = identity.offlineUserId;
    req.query.offlineUserId = identity.offlineUserId;
  }

  if (identity.ownerKey) {
    req.body.ownerKey = identity.ownerKey;
    req.query.ownerKey = identity.ownerKey;
  }

  req.body.ownerType = identity.ownerType;
  req.query.ownerType = identity.ownerType;

  return next();
}

export function requireOfflineLiveTutorIdentity(req, res, next) {
  if (isHealthOrPublicRead(req)) return next();

  const identity = req.liveTutorIdentity || {};
  const ok =
    Boolean(identity.hasRealUser) ||
    Boolean(identity.hasOfflineUser) ||
    Boolean(identity.hasSafeDevice) ||
    Boolean(identity.ownerKey);

  if (!ok) {
    return sendPrivacyError(
      res,
      "Privacy guard: send logged-in user, x-gemma-offline-user-id/x-offline-user-id, x-owner-key, or a unique x-device-id. Shared values like web/guest/test are blocked.",
      400,
      "missing_live_tutor_owner"
    );
  }

  if (
    !identity.hasRealUser &&
    !identity.hasOfflineUser &&
    !identity.ownerKey &&
    !identity.hasSafeDevice
  ) {
    return sendPrivacyError(
      res,
      "Privacy guard: cannot use Live Tutor without a private owner identity.",
      400,
      "unsafe_live_tutor_owner"
    );
  }

  return next();
}

export function requireLiveTutorWriteIdentity(req, res, next) {
  if (!isWriteRequest(req)) return next();

  const identity = req.liveTutorIdentity || {};
  const ok =
    Boolean(identity.hasRealUser) ||
    Boolean(identity.hasOfflineUser) ||
    Boolean(identity.ownerKey) ||
    Boolean(identity.hasSafeDevice);

  if (!ok) {
    return sendPrivacyError(
      res,
      "Privacy guard: cannot write Live Tutor session without logged-in user, offlineUserId, ownerKey, or unique deviceId.",
      400,
      "missing_live_tutor_write_owner"
    );
  }

  return next();
}

export function getLiveTutorIdentityDebug(req) {
  const identity = req.liveTutorIdentity || {};

  return {
    userId: identity.userId || "",
    rawUserId: identity.rawUserId || "",
    offlineUserId: identity.offlineUserId || "",
    deviceId: identity.deviceId || "",
    ownerType: identity.ownerType || "",
    ownerKey: identity.ownerKey || "",
    hasRealUser: Boolean(identity.hasRealUser),
    hasOfflineUser: Boolean(identity.hasOfflineUser),
    hasSafeDevice: Boolean(identity.hasSafeDevice),
    strictOfflineUser: Boolean(identity.strictOfflineUser),
    strongOwner: Boolean(identity.strongOwner),
    offlineGuest: Boolean(identity.offlineGuest),
    resourceId: identity.resourceId || "",
    sessionId: identity.sessionId || "",
    requestId: identity.requestId || "",
  };
}

export default {
  offlineLiveTutorIdentity,
  requireOfflineLiveTutorIdentity,
  requireLiveTutorWriteIdentity,
  getLiveTutorIdentityDebug,
};