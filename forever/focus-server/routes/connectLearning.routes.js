// server/routes/connectLearning.routes.js
import express from "express";
import * as controller from "../controllers/connectLearning.controller.js";

const router = express.Router();

router.get("/health", (req, res) => {
  res.json({
    ok: true,
    feature: "connect-learning",
    mode: "evidence-backed-learning-graph",
    at: new Date().toISOString(),
  });
});

router.post("/tree", controller.createTree);
router.get("/trees/:deviceId", controller.getTrees);
router.get("/tree/:treeId", controller.getTree);
router.patch("/tree/:treeId/status", controller.updateTreeStatus);
router.delete("/tree/:treeId", controller.deleteTree);

router.post("/tree/:treeId/node", controller.createNode);
router.post("/node", controller.createNode);
router.patch("/node/:nodeId/status", controller.updateNodeStatus);
router.delete("/node/:nodeId", controller.deleteNode);

router.post("/resource/pdf", controller.uploadPdfMiddleware, controller.uploadPdfResource);
router.get("/resource/pdf/job/:jobId", controller.getPdfJob);

router.get("/node/:nodeId/resources", controller.getNodeResources);
router.post("/node/:nodeId/generate-resources", controller.generateNodeResources);
router.post("/tree/:treeId/generate-resources", controller.generateTreeResources);

router.post("/resource/manual", controller.saveManualResource);
router.post("/resource/webpage", controller.saveWebpageResource);

router.post("/resource/:resourceId/connect", controller.connectResource);
router.post("/resource/:resourceId/move", controller.moveResource);
router.patch("/resource/:resourceId/move", controller.moveResource);
router.patch("/resource/:resourceId", controller.updateResource);
router.patch("/resource/:resourceId/progress", controller.updateResourceProgress);
router.delete("/resource/:resourceId", controller.deleteResource);

router.post("/agent/command", controller.agentCommand);
router.get("/search", controller.search);
router.get("/recommendations", controller.recommendations);
router.get("/recommendations/:deviceId", controller.recommendations);

export default router;