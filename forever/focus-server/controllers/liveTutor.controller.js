import {
  runLiveTutorOrchestrator,
  getLiveTutorBoard,
  listLiveTutorBoards,
  updateLiveTutorBoardBlock,
  saveLiveTutorBoard,
} from "../services/liveTutor/liveTutorOrchestrator.service.js";

import {
  getLiveTutorSession,
  getLiveTutorInteraction,
  getLiveTutorWeakConcepts,
  getLiveTutorHealth,
  deleteLiveTutorSession,
} from "../services/liveTutor/liveTutorGraph.service.js";

import { getLiveTutorRagHealth } from "../services/liveTutor/liveTutorRag.service.js";
import { getLiveTutorVectorStoreHealth } from "../services/liveTutor/liveTutorVectorStore.service.js";
import { getLiveTutorLangGraphWorkflow } from "../services/liveTutor/liveTutorLangGraph.workflow.js";

function sendOk(res, data, status = 200) {
  return res.status(status).json(data);
}

function sendError(res, error, status = 500) {
  const message =
    error?.message ||
    error?.response?.data?.message ||
    "Live Tutor request failed.";

  return res.status(status).json({
    ok: false,
    message,
    error:
      process.env.NODE_ENV === "production"
        ? undefined
        : String(error?.stack || error),
  });
}

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getUserId(req) {
  return (
    req.body?.userId ||
    req.query?.userId ||
    req.user?.id ||
    req.user?._id ||
    req.user?.email ||
    req.headers["x-user-id"] ||
    "guest"
  );
}

function getDeviceId(req) {
  return (
    req.body?.deviceId ||
    req.query?.deviceId ||
    req.headers["x-device-id"] ||
    req.headers["x-client-id"] ||
    "web"
  );
}

function getPayload(req, forcedMode = "") {
  return {
    ...(req.body || {}),

    mode: forcedMode || req.body?.mode || "explain_frame",

    userId: getUserId(req),
    deviceId: getDeviceId(req),

    userAgent: req.body?.userAgent || req.headers["user-agent"] || "",

    requestMeta: {
      ip: req.ip,
      origin: req.headers.origin || "",
      extensionVersion:
        req.body?.extensionVersion ||
        req.headers["x-learnlens-extension"] ||
        "",
      receivedAt: new Date().toISOString(),
    },
  };
}

function summarizePayloadForDebug(payload = {}) {
  return {
    mode: payload.mode,
    platform: payload.platform,
    url: payload.url,
    title: payload.title,
    videoId: payload.videoId,
    timestampSeconds: payload.timestampSeconds,
    hasScreenshot: Boolean(payload.screenshotDataUrl),
    hasMarkedRect: Boolean(payload.selectedRect?.width && payload.selectedRect?.height),
    markedRect: payload.selectedRect || null,
    selectedTextChars: String(payload.selectedText || "").length,
    visibleTextChars: String(payload.visibleText || "").length,
    pageTextChars: String(payload.pageText || "").length,
    transcriptChars: String(
      payload.transcriptContext ||
        payload.transcriptWindow?.full ||
        payload.currentCaption ||
        ""
    ).length,
    markedElementsCount: Array.isArray(payload.markedElements)
      ? payload.markedElements.length
      : 0,
  };
}

export async function health(req, res) {
  try {
    let langGraphOk = false;

    try {
      const workflow = getLiveTutorLangGraphWorkflow();
      langGraphOk = Boolean(workflow);
    } catch {
      langGraphOk = false;
    }

    return sendOk(res, {
      ok: true,
      service: "live-ai-tutor",
      advanced: true,
      mounted: true,
      orchestrator: true,
      boardDocuments: true,

      brain: getLiveTutorHealth(),
      rag: getLiveTutorRagHealth(),
      vectorStore: getLiveTutorVectorStoreHealth(),

      langGraph: {
        ok: langGraphOk,
        stateGraph: true,
        nodes: [
          "capture_normalizer",
          "transcript_alignment",
          "concept_detector",
          "rag_retriever",
          "screen_vision",
          "tutor_strategy",
          "board_plan",
          "simulation_plan",
          "voice_script",
          "tutor_response_generator",
          "memory_save",
        ],
      },

      capabilities: {
        chromeExtensionPayload: true,
        markedScreenRect: true,
        markedRegionCrop: true,
        screenshotVision: true,
        transcriptWindow: true,
        youtubeTimestamp: true,
        selectedText: true,
        pageDomContext: true,
        langGraphWorkflow: true,
        ragRetrieval: true,
        vectorMemory: true,
        boardSaveEditReplay: true,
        dryRunSimulation: true,
        explainBackEvaluation: true,
        voiceRuntimeBrowserSide: true,
        offlineWhisperPiperBackend: false,
      },

      endpoints: {
        health: "/api/live-tutor/health",
        debug: "/api/live-tutor/debug/payload",
        analyze: "/api/live-tutor/analyze",
        explainSelection: "/api/live-tutor/explain-selection",
        whyThisStep: "/api/live-tutor/why-this-step",
        simplify: "/api/live-tutor/simplify",
        dryRun: "/api/live-tutor/dry-run",
        interrupt: "/api/live-tutor/interrupt",
        repairConfusion: "/api/live-tutor/repair-confusion",
        explainBack: "/api/live-tutor/explain-back",
        roadmap: "/api/live-tutor/roadmap",
        quizMe: "/api/live-tutor/quiz-me",
        session: "/api/live-tutor/session",
        weakConcepts: "/api/live-tutor/weak-concepts",
        boards: "/api/live-tutor/boards",
        ragHealth: "/api/live-tutor/rag/health",
        vectorHealth: "/api/live-tutor/vector/health",
      },

      at: new Date().toISOString(),
    });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function ragHealth(req, res) {
  try {
    return sendOk(res, getLiveTutorRagHealth());
  } catch (error) {
    return sendError(res, error);
  }
}

export async function vectorHealth(req, res) {
  try {
    return sendOk(res, getLiveTutorVectorStoreHealth());
  } catch (error) {
    return sendError(res, error);
  }
}

export async function debugPayload(req, res) {
  try {
    const payload = getPayload(req, req.body?.mode || "explain_frame");

    return sendOk(res, {
      ok: true,
      received: summarizePayloadForDebug(payload),
      advice: {
        shouldHaveForMarkedVideo: [
          "screenshotDataUrl",
          "selectedRect",
          "timestampSeconds",
          "transcriptWindow",
          "currentCaption",
          "markedElements",
        ],
        shouldHaveForWebpage: [
          "selectedText or selectedRect",
          "visibleText",
          "pageText",
          "pageStructure",
          "markedElements",
        ],
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function runMode(req, res, mode, extra = {}) {
  try {
    const payload = getPayload(req, mode);

    const result = await runLiveTutorOrchestrator({
      ...payload,
      ...extra,
    });

    return sendOk(res, {
      ...result,
      requestDebug:
        process.env.LIVE_TUTOR_RETURN_REQUEST_DEBUG === "true"
          ? summarizePayloadForDebug(payload)
          : undefined,
    });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function analyzeMoment(req, res) {
  return runMode(req, res, req.body?.mode || "explain_frame");
}

export async function explainSelectionController(req, res) {
  return runMode(req, res, "explain_selection");
}

export async function whyThisStep(req, res) {
  return runMode(req, res, "why_this_step");
}

export async function simplify(req, res) {
  return runMode(req, res, "simplify");
}

export async function dryRun(req, res) {
  return runMode(req, res, "dry_run");
}

export async function interrupt(req, res) {
  return runMode(req, res, "interrupt");
}

export async function repair(req, res) {
  return runMode(req, res, "repair_confusion");
}

export async function explainBack(req, res) {
  return runMode(req, res, "explain_back", {
    userQuestion:
      req.body?.userQuestion ||
      "Evaluate my explain-back. Tell me correct, missing, wrong, and repair my weak part.",
  });
}

export async function roadmap(req, res) {
  return runMode(req, res, "roadmap");
}

export async function quizMe(req, res) {
  return runMode(req, res, "quiz_me");
}

export async function session(req, res) {
  try {
    const query = {
      ...(req.query || {}),
      userId:
        req.query?.userId ||
        req.user?.id ||
        req.user?._id ||
        req.user?.email ||
        req.headers["x-user-id"] ||
        "",
      deviceId:
        req.query?.deviceId ||
        req.headers["x-device-id"] ||
        req.headers["x-client-id"] ||
        "",
    };

    const result = await getLiveTutorSession(query);
    return sendOk(res, result);
  } catch (error) {
    return sendError(res, error);
  }
}

export async function interaction(req, res) {
  try {
    const { id } = req.params;

    if (!id) {
      return sendOk(
        res,
        {
          ok: false,
          message: "Interaction id is required.",
        },
        400
      );
    }

    const result = await getLiveTutorInteraction(id);

    if (!result.ok) {
      return sendOk(res, result, 404);
    }

    return sendOk(res, result);
  } catch (error) {
    return sendError(res, error);
  }
}

export async function weakConcepts(req, res) {
  try {
    const query = {
      ...(req.query || {}),
      userId:
        req.query?.userId ||
        req.user?.id ||
        req.user?._id ||
        req.user?.email ||
        req.headers["x-user-id"] ||
        "guest",
    };

    const result = await getLiveTutorWeakConcepts(query);
    return sendOk(res, result);
  } catch (error) {
    return sendError(res, error);
  }
}

export async function deleteSession(req, res) {
  try {
    const query = {
      ...(req.query || {}),
      ...(req.body || {}),
      userId:
        req.body?.userId ||
        req.query?.userId ||
        req.user?.id ||
        req.user?._id ||
        req.user?.email ||
        req.headers["x-user-id"] ||
        "",
      deviceId:
        req.body?.deviceId ||
        req.query?.deviceId ||
        req.headers["x-device-id"] ||
        req.headers["x-client-id"] ||
        "",
    };

    const result = await deleteLiveTutorSession(query);

    if (!result.ok) {
      return sendOk(res, result, 400);
    }

    return sendOk(res, result);
  } catch (error) {
    return sendError(res, error);
  }
}

export async function listBoards(req, res) {
  try {
    const query = {
      ...(req.query || {}),
      userId:
        req.query?.userId ||
        req.user?.id ||
        req.user?._id ||
        req.user?.email ||
        req.headers["x-user-id"] ||
        "",
      deviceId:
        req.query?.deviceId ||
        req.headers["x-device-id"] ||
        req.headers["x-client-id"] ||
        "",
    };

    const result = await listLiveTutorBoards(query);
    return sendOk(res, result);
  } catch (error) {
    return sendError(res, error);
  }
}

export async function readBoard(req, res) {
  try {
    const { boardId } = req.params;

    if (!boardId) {
      return sendOk(
        res,
        {
          ok: false,
          message: "boardId is required.",
        },
        400
      );
    }

    const result = await getLiveTutorBoard(boardId);

    if (!result.ok) {
      return sendOk(res, result, 404);
    }

    return sendOk(res, result);
  } catch (error) {
    return sendError(res, error);
  }
}

export async function updateBoardBlock(req, res) {
  try {
    const { boardId, pageId, blockId } = req.params;

    if (!boardId || !pageId || !blockId) {
      return sendOk(
        res,
        {
          ok: false,
          message: "boardId, pageId, and blockId are required.",
        },
        400
      );
    }

    const result = await updateLiveTutorBoardBlock({
      boardId,
      pageId,
      blockId,
      patch: req.body?.patch || req.body || {},
      editedBy: req.body?.editedBy || "student",
    });

    if (!result.ok) {
      return sendOk(res, result, 404);
    }

    return sendOk(res, result);
  } catch (error) {
    return sendError(res, error);
  }
}

export async function saveBoard(req, res) {
  try {
    const { boardId } = req.params;

    if (!boardId) {
      return sendOk(
        res,
        {
          ok: false,
          message: "boardId is required.",
        },
        400
      );
    }

    const result = await saveLiveTutorBoard(boardId);

    if (!result.ok) {
      return sendOk(res, result, 404);
    }

    return sendOk(res, result);
  } catch (error) {
    return sendError(res, error);
  }
}

export default {
  health,
  ragHealth,
  vectorHealth,
  debugPayload,

  analyzeMoment,
  explainSelectionController,
  whyThisStep,
  simplify,
  dryRun,
  interrupt,
  repair,
  explainBack,
  roadmap,
  quizMe,

  session,
  interaction,
  weakConcepts,
  deleteSession,

  listBoards,
  readBoard,
  updateBoardBlock,
  saveBoard,
};