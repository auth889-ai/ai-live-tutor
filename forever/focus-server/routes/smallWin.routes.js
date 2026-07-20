import express from "express";

import authMiddleware from "../middleware/authMiddleware.js";

import {
  addSmallWinMissionFeedbackHandler,
  createSmallWinMissionHandler,
  deleteSmallWinMissionHandler,
  getSmallWinMissionHandler,
  listSmallWinMissionsHandler,
  smallWinDebugSourceHandler,
  smallWinFieldsHandler,
  smallWinHealthHandler,
  smallWinMissionSummaryHandler,
  smallWinOpportunitiesHandler,
  submitSmallWinMissionProofHandler,
  updateSmallWinMissionChecklistHandler,
  updateSmallWinMissionStatusHandler,
} from "../controllers/smallWin.controller.js";

const router = express.Router();

/**
 * Public only: no private user data.
 */
router.get("/health", smallWinHealthHandler);
router.get("/fields", smallWinFieldsHandler);

/**
 * Everything below requires login.
 * This protects goal, feeling, mission, proof, feedback, and history.
 */
router.use(authMiddleware);

/**
 * Real opportunity fetch.
 */
router.post("/opportunities", smallWinOpportunitiesHandler);
router.post("/debug/source/:source", smallWinDebugSourceHandler);

/**
 * Private mission/proof/history CRUD.
 */
router.post("/missions", createSmallWinMissionHandler);
router.get("/missions", listSmallWinMissionsHandler);
router.get("/missions/summary", smallWinMissionSummaryHandler);
router.get("/missions/:missionId", getSmallWinMissionHandler);
router.patch("/missions/:missionId/status", updateSmallWinMissionStatusHandler);
router.patch("/missions/:missionId/checklist", updateSmallWinMissionChecklistHandler);
router.patch("/missions/:missionId/proof", submitSmallWinMissionProofHandler);
router.post("/missions/:missionId/feedback", addSmallWinMissionFeedbackHandler);
router.delete("/missions/:missionId", deleteSmallWinMissionHandler);

export default router;