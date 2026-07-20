import express from "express";

import {
  analyze,
  askQuestion,
  getJob,
  health,
  listJobs,
} from "../controllers/goodContentReach.controller.js";

const router = express.Router();

router.get("/health", health);
router.post("/analyze", analyze);
router.get("/jobs", listJobs);
router.get("/jobs/:jobId", getJob);
router.post("/jobs/:jobId/ask", askQuestion);

export default router;