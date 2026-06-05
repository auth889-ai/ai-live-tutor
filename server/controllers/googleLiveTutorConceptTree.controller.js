"use strict";

/**
 * server/controllers/googleLiveTutorConceptTree.controller.js
 * =============================================================================
 * Fixed Concept Tree Controller.
 *
 * Works with:
 *   server/services/googleAgent/stage1ConceptTree.service.js
 *
 * Endpoints:
 *   GET  /api/google-agent/live-tutor/concept-tree/health
 *   POST /api/google-agent/live-tutor/resources/:resourceId/concept-tree
 *   GET  /api/google-agent/live-tutor/concept-trees/:treeId
 *   POST /api/google-agent/live-tutor/resources/:resourceId/explain-node
 *   POST /api/google-agent/live-tutor/boards/:boardId/save
 *   GET  /api/google-agent/live-tutor/boards/:boardId
 *
 * No fake fallback.
 * =============================================================================
 */

const stage1ConceptTreeService = require("../services/googleAgent/stage1ConceptTree.service");

function safeString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function pickHeader(req, names, fallback = "") {
  for (const name of names) {
    const value = req.headers[name.toLowerCase()];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return fallback;
}

function getRequestContext(req) {
  const offlineUserId = safeString(
    pickHeader(req, ["x-offline-user-id", "x-user-id"], "") ||
      req.body?.offlineUserId ||
      req.query?.offlineUserId,
    "demo_user"
  );

  const deviceId = safeString(
    pickHeader(req, ["x-device-id"], "") ||
      req.body?.deviceId ||
      req.query?.deviceId,
    "demo_device"
  );

  const ownerKey = safeString(
    pickHeader(req, ["x-owner-key"], "") ||
      req.body?.ownerKey ||
      req.query?.ownerKey ||
      offlineUserId,
    offlineUserId
  );

  return {
    ownerKey,
    offlineUserId,
    deviceId,
  };
}

function getStatusCodeFromResult(result) {
  if (!result || result.ok === true) return 200;
  const code = Number(result.statusCode || result.status || 500);
  if (!Number.isFinite(code)) return 500;
  return Math.max(400, Math.min(599, code));
}

function sendControllerError(res, error, extra = {}) {
  const statusCode = Number(error?.statusCode || error?.status || 500);
  const safeStatus = Math.max(400, Math.min(599, Number.isFinite(statusCode) ? statusCode : 500));

  return res.status(safeStatus).json({
    ok: false,
    statusCode: safeStatus,
    error: error?.message || "Unexpected server error",
    stack: process.env.NODE_ENV === "development" ? error?.stack : undefined,
    ...extra,
    metadata: {
      ...(extra.metadata || {}),
      fallbackUsed: false,
      controller: "googleLiveTutorConceptTree.controller",
    },
  });
}

async function health(req, res) {
  try {
    const result = await stage1ConceptTreeService.health();
    return res.status(result.ok ? 200 : 503).json(result);
  } catch (error) {
    return sendControllerError(res, error, {
      metadata: {
        endpoint: "health",
      },
    });
  }
}

async function buildConceptTree(req, res) {
  try {
    const context = getRequestContext(req);
    const resourceId = safeString(req.params.resourceId || req.body?.resourceId);

    if (!resourceId) {
      return res.status(400).json({
        ok: false,
        statusCode: 400,
        error: "resourceId is required.",
        metadata: {
          fallbackUsed: false,
          endpoint: "buildConceptTree",
        },
      });
    }

    if (typeof stage1ConceptTreeService.buildConceptTree !== "function") {
      return res.status(500).json({
        ok: false,
        statusCode: 500,
        error: "stage1ConceptTreeService.buildConceptTree is not exported.",
        metadata: {
          fallbackUsed: false,
          endpoint: "buildConceptTree",
        },
      });
    }

    const result = await stage1ConceptTreeService.buildConceptTree({
      ownerKey: context.ownerKey,
      resourceId,
      body: req.body || {},
      context,
    });

    return res.status(getStatusCodeFromResult(result)).json(result);
  } catch (error) {
    return sendControllerError(res, error, {
      metadata: {
        endpoint: "buildConceptTree",
      },
    });
  }
}

async function getConceptTree(req, res) {
  try {
    const context = getRequestContext(req);
    const treeId = safeString(req.params.treeId || req.query.treeId);

    if (!treeId) {
      return res.status(400).json({
        ok: false,
        statusCode: 400,
        error: "treeId is required.",
        metadata: {
          fallbackUsed: false,
          endpoint: "getConceptTree",
        },
      });
    }

    const result = await stage1ConceptTreeService.getConceptTree({
      ownerKey: context.ownerKey,
      treeId,
    });

    return res.status(getStatusCodeFromResult(result)).json(result);
  } catch (error) {
    return sendControllerError(res, error, {
      metadata: {
        endpoint: "getConceptTree",
      },
    });
  }
}

async function explainNode(req, res) {
  try {
    const context = getRequestContext(req);
    const resourceId = safeString(req.params.resourceId || req.body?.resourceId);

    if (!resourceId) {
      return res.status(400).json({
        ok: false,
        statusCode: 400,
        error: "resourceId is required.",
        metadata: {
          fallbackUsed: false,
          endpoint: "explainNode",
        },
      });
    }

    if (!req.body?.treeId) {
      return res.status(400).json({
        ok: false,
        statusCode: 400,
        error: "treeId is required in request body.",
        metadata: {
          fallbackUsed: false,
          endpoint: "explainNode",
        },
      });
    }

    if (!req.body?.nodeId) {
      return res.status(400).json({
        ok: false,
        statusCode: 400,
        error: "nodeId is required in request body.",
        metadata: {
          fallbackUsed: false,
          endpoint: "explainNode",
        },
      });
    }

    const result = await stage1ConceptTreeService.explainNode({
      ownerKey: context.ownerKey,
      resourceId,
      body: req.body || {},
      context,
    });

    return res.status(getStatusCodeFromResult(result)).json(result);
  } catch (error) {
    return sendControllerError(res, error, {
      metadata: {
        endpoint: "explainNode",
      },
    });
  }
}

async function saveBoard(req, res) {
  try {
    const context = getRequestContext(req);
    const boardId = safeString(req.params.boardId || req.body?.boardId);

    if (!boardId) {
      return res.status(400).json({
        ok: false,
        statusCode: 400,
        error: "boardId is required.",
        metadata: {
          fallbackUsed: false,
          endpoint: "saveBoard",
        },
      });
    }

    const result = await stage1ConceptTreeService.saveBoard({
      ownerKey: context.ownerKey,
      boardId,
      body: req.body || {},
      context,
    });

    return res.status(getStatusCodeFromResult(result)).json(result);
  } catch (error) {
    return sendControllerError(res, error, {
      metadata: {
        endpoint: "saveBoard",
      },
    });
  }
}

async function getBoard(req, res) {
  try {
    const context = getRequestContext(req);
    const boardId = safeString(req.params.boardId || req.query.boardId);

    if (!boardId) {
      return res.status(400).json({
        ok: false,
        statusCode: 400,
        error: "boardId is required.",
        metadata: {
          fallbackUsed: false,
          endpoint: "getBoard",
        },
      });
    }

    const result = await stage1ConceptTreeService.getBoard({
      ownerKey: context.ownerKey,
      boardId,
    });

    return res.status(getStatusCodeFromResult(result)).json(result);
  } catch (error) {
    return sendControllerError(res, error, {
      metadata: {
        endpoint: "getBoard",
      },
    });
  }
}

module.exports = {
  health,
  buildConceptTree,
  getConceptTree,
  explainNode,
  saveBoard,
  getBoard,
};