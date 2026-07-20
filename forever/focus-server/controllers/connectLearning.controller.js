// server/controllers/connectLearning.controller.js
import multer from "multer";
import path from "path";
import fs from "fs";
import * as service from "../services/connectLearning.service.js";

const uploadDir = path.join(process.cwd(), "uploads", "connect-learning", "pdf");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadDir);
  },

  filename(req, file, cb) {
    const safeOriginal = String(file.originalname || "document.pdf")
      .replace(/[^\w.\-]+/g, "_")
      .slice(-120);

    cb(null, `${Date.now()}_${Math.random().toString(16).slice(2)}_${safeOriginal}`);
  },
});

const pdfUpload = multer({
  storage,
  limits: {
    fileSize: Number(process.env.CONNECT_LEARNING_MAX_PDF_MB || 50) * 1024 * 1024,
  },
  fileFilter(req, file, cb) {
    const mime = String(file.mimetype || "").toLowerCase();
    const ext = path.extname(file.originalname || "").toLowerCase();

    if (mime.includes("pdf") || ext === ".pdf") {
      cb(null, true);
      return;
    }

    cb(new Error("Only PDF files are allowed."));
  },
});

export const uploadPdfMiddleware = pdfUpload.single("pdf");

function ok(res, data = {}, status = 200) {
  return res.status(status).json({
    ok: true,
    data,
  });
}

function fail(res, error, status = 500) {
  console.error("[connect-learning controller]", error);

  return res.status(status).json({
    ok: false,
    message: error?.message || "Connect Learning request failed.",
  });
}

function readDeviceId(req) {
  return (
    req.body?.deviceId ||
    req.query?.deviceId ||
    req.params?.deviceId ||
    req.headers["x-device-id"] ||
    ""
  );
}

function readUserId(req) {
  return req.body?.userId || req.query?.userId || req.headers["x-user-id"] || "";
}

function readUserEmail(req) {
  return (
    req.body?.userEmail ||
    req.body?.email ||
    req.query?.userEmail ||
    req.query?.email ||
    req.headers["x-user-email"] ||
    ""
  );
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["true", "1", "yes", "on"].includes(String(value).toLowerCase());
}

export async function createTree(req, res) {
  try {
    const result = await service.createTree({
      ...req.body,
      deviceId: readDeviceId(req),
      userId: readUserId(req),
    });

    return ok(res, result, 201);
  } catch (error) {
    return fail(res, error, 400);
  }
}

export async function getTrees(req, res) {
  try {
    const result = await service.getTrees({
      deviceId: req.params.deviceId || readDeviceId(req),
      userId: readUserId(req),
      limit: req.query.limit,
      category: req.query.category,
      status: req.query.status,
    });

    return ok(res, result);
  } catch (error) {
    return fail(res, error, 400);
  }
}

export async function getTree(req, res) {
  try {
    const result = await service.getFullTree({
      treeId: req.params.treeId,
      deviceId: readDeviceId(req),
      userId: readUserId(req),
    });

    return ok(res, result);
  } catch (error) {
    return fail(res, error, 404);
  }
}

export async function updateTreeStatus(req, res) {
  try {
    const result = await service.updateTreeStatus({
      treeId: req.params.treeId,
      deviceId: readDeviceId(req),
      userId: readUserId(req),
      status: req.body.status,
      progressPercentage: req.body.progressPercentage,
    });

    return ok(res, result);
  } catch (error) {
    return fail(res, error, 400);
  }
}

export async function deleteTree(req, res) {
  try {
    const result = await service.deleteTree({
      treeId: req.params.treeId,
      deviceId: readDeviceId(req),
      userId: readUserId(req),
    });

    return ok(res, result);
  } catch (error) {
    return fail(res, error, 400);
  }
}

export async function createNode(req, res) {
  try {
    const result = await service.createNode({
      ...req.body,
      treeId: req.params.treeId || req.body.treeId,
      deviceId: readDeviceId(req),
      userId: readUserId(req),
    });

    return ok(res, result, 201);
  } catch (error) {
    return fail(res, error, 400);
  }
}

export async function updateNodeStatus(req, res) {
  try {
    const result = await service.updateNodeStatus({
      nodeId: req.params.nodeId,
      treeId: req.body.treeId || req.query.treeId,
      deviceId: readDeviceId(req),
      userId: readUserId(req),
      status: req.body.status,
      resourceStatus: req.body.resourceStatus,
      progressPercentage: req.body.progressPercentage,
    });

    return ok(res, result);
  } catch (error) {
    return fail(res, error, 400);
  }
}

export async function deleteNode(req, res) {
  try {
    const result = await service.deleteNode({
      nodeId: req.params.nodeId,
      treeId: req.body.treeId || req.query.treeId,
      deviceId: readDeviceId(req),
      userId: readUserId(req),
      deleteChildren: boolValue(req.body.deleteChildren || req.query.deleteChildren, false),
    });

    return ok(res, result);
  } catch (error) {
    return fail(res, error, 400);
  }
}

export async function uploadPdfResource(req, res) {
  try {
    if (!req.file) {
      throw new Error("PDF file is required. Use multipart field name: pdf");
    }

    const result = await service.uploadPdfResource({
      deviceId: readDeviceId(req),
      userId: readUserId(req),
      userEmail: readUserEmail(req),
      file: req.file,
      filePath: req.file.path,
      originalName: req.file.originalname,
      studyGoal: req.body.studyGoal || req.body.goal || "",
      async: req.body.async !== undefined ? req.body.async : true,
    });

    return ok(res, result, 202);
  } catch (error) {
    return fail(res, error, 400);
  }
}

export async function getPdfJob(req, res) {
  try {
    const result = await service.getPdfJob({
      jobId: req.params.jobId,
    });

    return ok(res, result);
  } catch (error) {
    return fail(res, error, 404);
  }
}

export async function getNodeResources(req, res) {
  try {
    const result = await service.getNodeResources({
      treeId: req.query.treeId || req.body?.treeId,
      nodeId: req.params.nodeId,
      deviceId: readDeviceId(req),
      userId: readUserId(req),
      autoGenerate: boolValue(req.query.autoGenerate, false),
    });

    return ok(res, result);
  } catch (error) {
    return fail(res, error, 400);
  }
}

export async function generateNodeResources(req, res) {
  try {
    const result = await service.generateNodeResources({
      treeId: req.body.treeId || req.query.treeId,
      nodeId: req.params.nodeId,
      deviceId: readDeviceId(req),
      userId: readUserId(req),
      force: boolValue(req.body.force || req.query.force, false),
      includeExternal: req.body.includeExternal,
      includeVideos: req.body.includeVideos,
      includeWeb: req.body.includeWeb,
      includeVisual: req.body.includeVisual,
    });

    return ok(res, result);
  } catch (error) {
    return fail(res, error, 400);
  }
}

export async function generateTreeResources(req, res) {
  try {
    const result = await service.generateTreeResources({
      treeId: req.params.treeId,
      deviceId: readDeviceId(req),
      userId: readUserId(req),
      limit: req.body.limit || req.query.limit,
    });

    return ok(res, result);
  } catch (error) {
    return fail(res, error, 400);
  }
}

export async function saveManualResource(req, res) {
  try {
    const result = await service.addManualResource({
      ...req.body,
      deviceId: readDeviceId(req),
      userId: readUserId(req),
      sourceType: req.body.sourceType || "manual",
    });

    return ok(res, result, 201);
  } catch (error) {
    return fail(res, error, 400);
  }
}

export async function saveWebpageResource(req, res) {
  try {
    const result = await service.saveWebpageResource({
      ...req.body,
      deviceId: readDeviceId(req),
      userId: readUserId(req),
    });

    return ok(res, result, 201);
  } catch (error) {
    return fail(res, error, 400);
  }
}

export async function updateResource(req, res) {
  try {
    const result = await service.updateResource({
      resourceId: req.params.resourceId,
      treeId: req.body.treeId || req.query.treeId,
      nodeId: req.body.nodeId || req.query.nodeId,
      deviceId: readDeviceId(req),
      userId: readUserId(req),
      patch: req.body,
    });

    return ok(res, result);
  } catch (error) {
    return fail(res, error, 400);
  }
}

export async function deleteResource(req, res) {
  try {
    const result = await service.deleteResource({
      resourceId: req.params.resourceId,
      treeId: req.body.treeId || req.query.treeId,
      nodeId: req.body.nodeId || req.query.nodeId,
      deviceId: readDeviceId(req),
      userId: readUserId(req),
    });

    return ok(res, result);
  } catch (error) {
    return fail(res, error, 400);
  }
}

export async function connectResource(req, res) {
  try {
    const result = await service.connectResource({
      resourceId: req.params.resourceId,
      treeId: req.body.treeId,
      nodeId: req.body.nodeId,
      deviceId: readDeviceId(req),
      userId: readUserId(req),
    });

    return ok(res, result);
  } catch (error) {
    return fail(res, error, 400);
  }
}

export async function moveResource(req, res) {
  try {
    const result = await service.moveResource({
      resourceId: req.params.resourceId,
      targetTreeId: req.body.targetTreeId || req.body.treeId,
      targetNodeId: req.body.targetNodeId || req.body.nodeId,
      deviceId: readDeviceId(req),
      userId: readUserId(req),
    });

    return ok(res, result);
  } catch (error) {
    return fail(res, error, 400);
  }
}

export async function updateResourceProgress(req, res) {
  try {
    const result = await service.updateResourceProgress({
      resourceId: req.params.resourceId,
      progress: req.body.progress,
      completed: req.body.completed,
      deviceId: readDeviceId(req),
      userId: readUserId(req),
    });

    return ok(res, result);
  } catch (error) {
    return fail(res, error, 400);
  }
}

export async function agentCommand(req, res) {
  try {
    const result = await service.agentCommand({
      ...req.body,
      deviceId: readDeviceId(req),
      userId: readUserId(req),
    });

    return ok(res, result);
  } catch (error) {
    return fail(res, error, 400);
  }
}

export async function search(req, res) {
  try {
    const result = await service.search({
      deviceId: readDeviceId(req),
      userId: readUserId(req),
      q: req.query.q || req.query.query || "",
      treeId: req.query.treeId || "",
      limit: req.query.limit || 20,
    });

    return ok(res, result);
  } catch (error) {
    return fail(res, error, 400);
  }
}

export async function recommendations(req, res) {
  try {
    const result = await service.recommendations({
      deviceId: req.params.deviceId || readDeviceId(req),
      userId: readUserId(req),
      treeId: req.query.treeId || "",
      limit: req.query.limit || 10,
    });

    return ok(res, result);
  } catch (error) {
    return fail(res, error, 400);
  }
}