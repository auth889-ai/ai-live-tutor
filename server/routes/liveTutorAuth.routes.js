"use strict";

/**
 * server/routes/liveTutorAuth.routes.js
 * =============================================================================
 * Real backend authentication routes + middleware for AI Live Tutor.
 *
 * Adds:
 *   POST /api/google-agent/live-tutor/auth/register
 *   POST /api/google-agent/live-tutor/auth/login
 *   GET  /api/google-agent/live-tutor/auth/me
 *   POST /api/google-agent/live-tutor/auth/logout
 *
 * Also exports:
 *   optionalLiveTutorAuthContext
 *   requireLiveTutorAuth
 *
 * Important:
 * - This uses signed token with HMAC SHA256, JWT-style, no extra dependency.
 * - Existing routes can keep working in dev mode if no token is supplied.
 * - If token exists, backend overrides ownerKey/offlineUserId/deviceId from token.
 * - Set LIVE_TUTOR_AUTH_REQUIRED=true to force token for all protected routes.
 * =============================================================================
 */

const crypto = require("crypto");
const express = require("express");
const mongoose = require("mongoose");

const LiveTutorUser = require("../models/LiveTutorUser");

const router = express.Router();

function safeString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function envBool(name, fallback = false) {
  const raw = process.env[name];

  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }

  return ["1", "true", "yes", "y", "on"].includes(
    String(raw).trim().toLowerCase()
  );
}

async function ensureMongoConnected() {
  if (mongoose.connection.readyState === 1) return;

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

  if (!uri) {
    throw new Error("MONGODB_URI or MONGO_URI missing.");
  }

  await mongoose.connect(uri, {
    dbName: process.env.MONGODB_DATABASE || undefined,
    serverSelectionTimeoutMS: 30000,
  });
}

function base64UrlEncode(value) {
  const raw = Buffer.isBuffer(value) ? value : Buffer.from(String(value));

  return raw
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(value) {
  const s = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);

  return Buffer.from(padded, "base64").toString("utf8");
}

function getAuthSecret() {
  const secret =
    process.env.LIVE_TUTOR_AUTH_SECRET ||
    process.env.JWT_SECRET ||
    process.env.SESSION_SECRET ||
    "";

  if (secret && secret.length >= 24) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "LIVE_TUTOR_AUTH_SECRET or JWT_SECRET must be set to at least 24 characters in production."
    );
  }

  return "dev_live_tutor_auth_secret_change_me_please_32_chars";
}

function signPayload(payload) {
  const header = {
    alg: "HS256",
    typ: "LTJWT",
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac("sha256", getAuthSecret())
    .update(data)
    .digest();

  return `${data}.${base64UrlEncode(signature)}`;
}

function timingSafeEqualString(a, b) {
  const aBuf = Buffer.from(String(a || ""));
  const bBuf = Buffer.from(String(b || ""));

  if (aBuf.length !== bBuf.length) return false;

  return crypto.timingSafeEqual(aBuf, bBuf);
}

function verifySignedToken(token) {
  const parts = String(token || "").split(".");

  if (parts.length !== 3) {
    throw new Error("Invalid auth token format.");
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const data = `${encodedHeader}.${encodedPayload}`;

  const expectedSignature = base64UrlEncode(
    crypto.createHmac("sha256", getAuthSecret()).update(data).digest()
  );

  if (!timingSafeEqualString(signature, expectedSignature)) {
    throw new Error("Invalid auth token signature.");
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload));

  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid auth token payload.");
  }

  if (payload.exp && Date.now() > Number(payload.exp) * 1000) {
    throw new Error("Auth token expired.");
  }

  return payload;
}

function makeDeviceId({ ownerKey, deviceId }) {
  return safeString(deviceId, `${ownerKey}_device`);
}

function makeAuthToken(user, { deviceId }) {
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = Number(process.env.LIVE_TUTOR_AUTH_TTL_SECONDS || 60 * 60 * 24 * 14);

  const payload = {
    sub: String(user._id),
    ownerKey: user.ownerKey,
    offlineUserId: user.ownerKey,
    username: user.username,
    displayName: user.displayName,
    deviceId: makeDeviceId({ ownerKey: user.ownerKey, deviceId }),
    tokenVersion: user.tokenVersion || 1,
    iat: now,
    exp: now + ttlSeconds,
    iss: "ai-live-tutor-rebuild",
    aud: "ai-live-tutor-client",
  };

  return signPayload(payload);
}

function extractBearerToken(req) {
  const header = safeString(req.headers.authorization || req.headers.Authorization);

  if (!header) return "";

  const match = header.match(/^Bearer\s+(.+)$/i);

  return match ? match[1].trim() : "";
}

function sendAuthError(res, statusCode, message, extra = {}) {
  return res.status(statusCode).json({
    ok: false,
    statusCode,
    error: message,
    ...extra,
    metadata: {
      ...(extra.metadata || {}),
      fallbackUsed: false,
      usedSmartFallback: false,
      auth: true,
    },
  });
}

function applyAuthContextToRequest(req, authContext) {
  req.liveTutorAuth = authContext;

  /**
   * Existing controllers already read these headers/body fields.
   * We override them here so backend token becomes the real source of ownerKey.
   */
  req.headers["x-owner-key"] = authContext.ownerKey;
  req.headers["x-offline-user-id"] = authContext.offlineUserId || authContext.ownerKey;
  req.headers["x-device-id"] = authContext.deviceId || `${authContext.ownerKey}_device`;

  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    req.body.ownerKey = authContext.ownerKey;
    req.body.offlineUserId = authContext.offlineUserId || authContext.ownerKey;
    req.body.deviceId = authContext.deviceId || `${authContext.ownerKey}_device`;
  }
}

async function authenticateFromToken(req) {
  const token = extractBearerToken(req);

  if (!token) return null;

  const payload = verifySignedToken(token);

  await ensureMongoConnected();

  const user = await LiveTutorUser.findById(payload.sub)
    .select("+passwordHash +passwordSalt +passwordIterations")
    .exec();

  if (!user) {
    throw new Error("User not found for auth token.");
  }

  if (user.status !== "active") {
    throw new Error("User account is disabled.");
  }

  if (Number(user.tokenVersion || 1) !== Number(payload.tokenVersion || 1)) {
    throw new Error("Auth token was revoked. Please login again.");
  }

  return {
    authenticated: true,
    userId: String(user._id),
    ownerKey: user.ownerKey,
    offlineUserId: user.ownerKey,
    username: user.username,
    displayName: user.displayName,
    deviceId: makeDeviceId({
      ownerKey: user.ownerKey,
      deviceId: payload.deviceId || user.lastDeviceId,
    }),
    tokenVersion: user.tokenVersion || 1,
    mode: "bearer-token",
  };
}

async function optionalLiveTutorAuthContext(req, res, next) {
  try {
    const authContext = await authenticateFromToken(req);

    if (authContext) {
      applyAuthContextToRequest(req, authContext);
      return next();
    }

    if (envBool("LIVE_TUTOR_AUTH_REQUIRED", false)) {
      return sendAuthError(res, 401, "Authentication required. Please login.");
    }

    /**
     * Backward compatible dev mode:
     * Keeps your existing curl tests working with x-owner-key: jana_test.
     * For production set LIVE_TUTOR_AUTH_REQUIRED=true.
     */
    req.liveTutorAuth = {
      authenticated: false,
      mode: "legacy-owner-key-dev-mode",
      ownerKey:
        safeString(req.headers["x-owner-key"]) ||
        safeString(req.body?.ownerKey) ||
        safeString(req.query?.ownerKey) ||
        safeString(req.headers["x-offline-user-id"]) ||
        "demo_user",
    };

    return next();
  } catch (error) {
    return sendAuthError(res, 401, error.message || "Invalid authentication token.");
  }
}

async function requireLiveTutorAuth(req, res, next) {
  try {
    const authContext = await authenticateFromToken(req);

    if (!authContext) {
      return sendAuthError(res, 401, "Authentication required. Please login.");
    }

    applyAuthContextToRequest(req, authContext);

    return next();
  } catch (error) {
    return sendAuthError(res, 401, error.message || "Invalid authentication token.");
  }
}

function safeUserResponse(user, token, deviceId) {
  const safeUser =
    typeof user.toSafeAuthJSON === "function"
      ? user.toSafeAuthJSON()
      : {
          userId: String(user._id),
          ownerKey: user.ownerKey,
          offlineUserId: user.ownerKey,
          username: user.username,
          displayName: user.displayName,
          deviceId,
          tokenVersion: user.tokenVersion || 1,
        };

  return {
    ok: true,
    token,
    user: {
      ...safeUser,
      deviceId: deviceId || safeUser.deviceId || `${safeUser.ownerKey}_device`,
    },
    auth: {
      tokenType: "Bearer",
      headerName: "Authorization",
      ownerKeySource: "server-token",
      frontendMustNotChooseOwnerKey: true,
    },
    metadata: {
      fallbackUsed: false,
      usedSmartFallback: false,
      realBackendAuth: true,
    },
  };
}

/**
 * POST /api/google-agent/live-tutor/auth/register
 */
router.post("/register", async (req, res) => {
  try {
    await ensureMongoConnected();

    const name = safeString(req.body?.name || req.body?.displayName || req.body?.username);
    const password = safeString(req.body?.password);
    const requestedOwnerKey = safeString(req.body?.ownerKey);
    const deviceId = safeString(req.body?.deviceId, `${requestedOwnerKey || "user"}_device`);
    const userAgent = safeString(req.headers["user-agent"]);

    const user = await LiveTutorUser.createWithPassword({
      name,
      password,
      ownerKey: requestedOwnerKey,
      deviceId,
      userAgent,
    });

    const token = makeAuthToken(user, {
      deviceId: makeDeviceId({ ownerKey: user.ownerKey, deviceId }),
    });

    return res.status(201).json(
      safeUserResponse(user, token, makeDeviceId({ ownerKey: user.ownerKey, deviceId }))
    );
  } catch (error) {
    return sendAuthError(res, error.statusCode || 400, error.message || "Register failed.");
  }
});

/**
 * POST /api/google-agent/live-tutor/auth/login
 */
router.post("/login", async (req, res) => {
  try {
    await ensureMongoConnected();

    const nameOrOwnerKey = safeString(
      req.body?.name || req.body?.username || req.body?.ownerKey
    );
    const password = safeString(req.body?.password);
    const deviceIdInput = safeString(req.body?.deviceId);
    const userAgent = safeString(req.headers["user-agent"]);

    if (!nameOrOwnerKey) {
      return sendAuthError(res, 400, "Name or ownerKey is required.");
    }

    if (!password) {
      return sendAuthError(res, 400, "Password is required.");
    }

    const username = LiveTutorUser.normalizeName(nameOrOwnerKey);

    const user = await LiveTutorUser.findOne({
      $or: [{ username }, { ownerKey: nameOrOwnerKey }],
    }).select("+passwordHash +passwordSalt +passwordIterations");

    if (!user) {
      return sendAuthError(res, 401, "Invalid name/ownerKey or password.");
    }

    if (user.status !== "active") {
      return sendAuthError(res, 403, "User account is disabled.");
    }

    if (!user.verifyPassword(password)) {
      return sendAuthError(res, 401, "Invalid name/ownerKey or password.");
    }

    const deviceId = makeDeviceId({
      ownerKey: user.ownerKey,
      deviceId: deviceIdInput,
    });

    await user.recordLogin({
      deviceId,
      userAgent,
    });

    const token = makeAuthToken(user, { deviceId });

    return res.json(safeUserResponse(user, token, deviceId));
  } catch (error) {
    return sendAuthError(res, error.statusCode || 500, error.message || "Login failed.");
  }
});

/**
 * GET /api/google-agent/live-tutor/auth/me
 */
router.get("/me", requireLiveTutorAuth, async (req, res) => {
  try {
    await ensureMongoConnected();

    const user = await LiveTutorUser.findById(req.liveTutorAuth.userId).lean();

    if (!user) {
      return sendAuthError(res, 404, "User not found.");
    }

    return res.json({
      ok: true,
      user: {
        userId: String(user._id),
        ownerKey: user.ownerKey,
        offlineUserId: user.ownerKey,
        username: user.username,
        displayName: user.displayName,
        deviceId: req.liveTutorAuth.deviceId,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastLoginAt: user.lastLoginAt,
      },
      metadata: {
        fallbackUsed: false,
        usedSmartFallback: false,
        realBackendAuth: true,
      },
    });
  } catch (error) {
    return sendAuthError(res, 500, error.message || "Could not load auth user.");
  }
});

/**
 * POST /api/google-agent/live-tutor/auth/logout
 *
 * Revokes current and old tokens by incrementing tokenVersion.
 */
router.post("/logout", requireLiveTutorAuth, async (req, res) => {
  try {
    await ensureMongoConnected();

    await LiveTutorUser.updateOne(
      { _id: req.liveTutorAuth.userId },
      { $inc: { tokenVersion: 1 } }
    );

    return res.json({
      ok: true,
      loggedOut: true,
      metadata: {
        fallbackUsed: false,
        usedSmartFallback: false,
        tokenRevoked: true,
      },
    });
  } catch (error) {
    return sendAuthError(res, 500, error.message || "Logout failed.");
  }
});

module.exports = {
  router,
  optionalLiveTutorAuthContext,
  requireLiveTutorAuth,
  verifySignedToken,
};