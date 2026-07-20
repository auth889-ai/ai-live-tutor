// server/routes/gemmaResource.routes.js

import express from "express";

import {
  health,
  overview,
  saveResource,
  uploadResource,
  getJob,
  listResources,
  getResource,
  deleteResource,
} from "../controllers/gemmaResource.controller.js";

import {
  handleAskGemmaResource,
  handleTutorBoard,
  handleCodeDryRun,
  handleQuiz,
  handleQuizAnswer,
  handleMemory,
} from "../services/gemmaResource/ragAsk.service.js";

import {
  handleCreateAgenticGraphBook,
  handleGetAgenticGraphBook,
  handleJoinAgenticGraphBooks,
} from "../services/gemmaResource/agenticBookGraph.service.js";

import {
  uploadSingleGemmaResourceFile,
  handleGemmaResourceUploadError,
} from "../middleware/gemmaResourceUpload.middleware.js";

import {
  attachGemmaResourceOwner,
  forceGemmaDeviceParamToOwner,
  handleListOwnedGemmaBooks,
  requireGemmaResourceOwner,
  requireOwnedGemmaBodyResource,
  requireOwnedGemmaBook,
  requireOwnedGemmaJoinBooks,
  requireOwnedGemmaResource,
} from "../middleware/gemmaResourcePrivacy.middleware.js";

const router = express.Router();

/**
 * Public setup endpoints only.
 *
 * These must stay before privacy middleware because they do not return
 * private saved resources/books.
 */
router.get("/health", health);
router.get("/overview", overview);

/**
 * Everything below is private.
 *
 * Owner priority is handled inside gemmaResourcePrivacy.middleware.js:
 * 1. req.user / authenticated user if your auth middleware attaches it
 * 2. x-gemma-offline-user-id / offlineUserId for offline profile
 * 3. safe unique x-device-id fallback
 *
 * This prevents shared fallback ids like:
 * local-device, web, guest, default, anonymous.
 */
router.use(attachGemmaResourceOwner);
router.use(requireGemmaResourceOwner);

/**
 * Param-level ownership guards.
 *
 * This protects every route containing:
 * - :resourceId
 * - :bookId
 *
 * If id exists but belongs to another user/profile/device, middleware returns 403.
 */
router.param("resourceId", requireOwnedGemmaResource);
router.param("bookId", requireOwnedGemmaBook);

/**
 * Save URL/text/code/notes.
 *
 * Privacy middleware injects owner into req.body/req.query before controller runs.
 */
router.post("/save", saveResource);

/**
 * Upload PDF/text/code file.
 *
 * Privacy middleware runs before multer so device/user owner is already known.
 * Upload error handler must remain last in the file.
 */
router.post("/upload", uploadSingleGemmaResourceFile, uploadResource);

/**
 * Poll processing job.
 *
 * Controller filters job by current owner.
 */
router.get("/job/:jobId", getJob);

/**
 * List saved resources.
 *
 * Important:
 * URL deviceId can be spoofed by another user.
 * forceGemmaDeviceParamToOwner overwrites req.params.deviceId with current owner.
 */
router.get(
  "/resources/:deviceId",
  forceGemmaDeviceParamToOwner,
  listResources
);

/**
 * Open/delete one saved resource.
 *
 * router.param("resourceId") already verifies ownership before controller/service.
 */
router.get("/resource/:resourceId", getResource);
router.delete("/resource/:resourceId", deleteResource);

/**
 * Ask Gemma from one resource.
 *
 * Protected by router.param("resourceId").
 */
router.post("/resource/:resourceId/ask", handleAskGemmaResource);

/**
 * Old alias:
 * POST /api/gemma-resource/ask
 *
 * This has no :resourceId param in URL, so it needs body-resource guard.
 */
router.post(
  "/ask",
  requireOwnedGemmaBodyResource,
  handleAskGemmaResource
);

/**
 * Create AI flipable book / study book from saved resource.
 *
 * Protected by router.param("resourceId").
 */
router.post("/resource/:resourceId/book", handleCreateAgenticGraphBook);
router.post("/resource/:resourceId/flipbook", handleCreateAgenticGraphBook);

/**
 * List saved books.
 *
 * Important:
 * Do NOT use old deviceId-only book list service here.
 * handleListOwnedGemmaBooks queries by req.gemmaOwner, so another user cannot
 * pass your deviceId and see books.
 */
router.get(
  "/books/:deviceId",
  forceGemmaDeviceParamToOwner,
  handleListOwnedGemmaBooks
);

/**
 * Direct open book.
 *
 * Protected by router.param("bookId").
 */
router.get("/book/:bookId", handleGetAgenticGraphBook);

/**
 * Join books.
 *
 * This has bookIds in body, so it needs explicit ownership guard.
 */
router.post(
  "/books/join",
  requireOwnedGemmaJoinBooks,
  handleJoinAgenticGraphBooks
);

/**
 * Tutor board.
 *
 * Protected by router.param("resourceId").
 */
router.post("/resource/:resourceId/tutor-board", handleTutorBoard);
router.post("/resource/:resourceId/board", handleTutorBoard);

/**
 * Code Tutor dry run.
 *
 * Protected by router.param("resourceId").
 */
router.post("/resource/:resourceId/code-dry-run", handleCodeDryRun);
router.post("/resource/:resourceId/dry-run", handleCodeDryRun);

/**
 * Quiz.
 *
 * Protected by router.param("resourceId").
 */
router.post("/resource/:resourceId/quiz", handleQuiz);
router.post("/resource/:resourceId/quiz/answer", handleQuizAnswer);

/**
 * Memory.
 *
 * DeviceId URL spoofing is blocked here.
 */
router.get(
  "/memory/:deviceId",
  forceGemmaDeviceParamToOwner,
  handleMemory
);

router.get("/memory", handleMemory);

/**
 * Upload error handler must stay last.
 */
router.use(handleGemmaResourceUploadError);

export default router;