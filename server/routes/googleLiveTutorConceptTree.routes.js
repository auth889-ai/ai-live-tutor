"use strict";

/**
 * server/routes/googleLiveTutorConceptTree.routes.js
 * =============================================================================
 * Stage 1 routes for Advanced Live Tutor Concept Tree Board.
 *
 * Mount suggestion in app.js/server.js:
 *
 *   const googleLiveTutorConceptTreeRoutes =
 *     require("./routes/googleLiveTutorConceptTree.routes");
 *
 *   app.use(
 *     "/api/google-agent/live-tutor",
 *     googleLiveTutorConceptTreeRoutes
 *   );
 *
 * Important:
 *   This file intentionally avoids wildcard routes because newer path-to-regexp
 *   versions can throw "Missing parameter name" for unnamed wildcards.
 * =============================================================================
 */

const express = require("express");

const controller = require("../controllers/googleLiveTutorConceptTree.controller");

const router = express.Router();

/**
 * Health
 *
 * GET /api/google-agent/live-tutor/concept-tree/health
 */
router.get("/concept-tree/health", controller.health);

/**
 * Build source-grounded concept tree from an already uploaded/chunked resource.
 *
 * POST /api/google-agent/live-tutor/resources/:resourceId/concept-tree
 *
 * Headers:
 *   x-offline-user-id: jana_test
 *   x-device-id: device_test
 *   x-owner-key: jana_test
 *
 * Body:
 *   {
 *     "studentLevel": "beginner",
 *     "language": "english",
 *     "maxNodes": 42
 *   }
 */
router.post(
  "/resources/:resourceId/concept-tree",
  controller.buildConceptTree
);

/**
 * Get concept tree and its latest saved board.
 *
 * GET /api/google-agent/live-tutor/concept-trees/:treeId
 */
router.get(
  "/concept-trees/:treeId",
  controller.getConceptTree
);

/**
 * Explain clicked node using source chunks.
 *
 * POST /api/google-agent/live-tutor/resources/:resourceId/explain-node
 *
 * Body:
 *   {
 *     "treeId": "glt_tree_...",
 *     "boardId": "glt_board_...",
 *     "nodeId": "migrations",
 *     "studentLevel": "beginner",
 *     "language": "bangla",
 *     "question": "Explain this node like a tutor"
 *   }
 */
router.post(
  "/resources/:resourceId/explain-node",
  controller.explainNode
);

/**
 * Save React Flow board state.
 *
 * POST /api/google-agent/live-tutor/boards/:boardId/save
 *
 * Body:
 *   {
 *     "flow": {
 *       "nodes": [],
 *       "edges": [],
 *       "viewport": { "x": 0, "y": 0, "zoom": 0.85 }
 *     },
 *     "selectedNodeId": "migrations",
 *     "expandedNodeIds": [],
 *     "collapsedNodeIds": [],
 *     "annotations": [],
 *     "saveReason": "manual"
 *   }
 */
router.post(
  "/boards/:boardId/save",
  controller.saveBoard
);

/**
 * Restore saved board state.
 *
 * GET /api/google-agent/live-tutor/boards/:boardId
 */
router.get(
  "/boards/:boardId",
  controller.getBoard
);

module.exports = router;