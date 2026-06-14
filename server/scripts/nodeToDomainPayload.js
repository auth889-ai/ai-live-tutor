"use strict";
/**
 * scripts/nodeToDomainPayload.js
 * ---------------------------------------------------------------------------
 * Simulates a real node click: resolves a concept node → its pages → the full
 * SourceTruthPacket, using the app's OWN buildSourceContext pipeline.
 * Writes the packet to agent_output/node_payload.json for the Python proof
 * (vision → domain) to consume.
 *
 * Usage:
 *   cd server
 *   node scripts/nodeToDomainPayload.js <resourceId> "<node title match>" <ownerKey>
 *   (defaults: test-7 Denormalization PDF, "Star Schema", jana_test)
 * ---------------------------------------------------------------------------
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const { buildSourceContext } = require("../services/googleAgent/sourceContext/sourceContextPipeline");

const RESOURCE = process.argv[2] || "glt_resource_1780558985921_5f1ea0e3";
const NODE_MATCH = (process.argv[3] || "Star Schema").toLowerCase();
const OWNER = process.argv[4] || "jana_test";

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
    dbName: process.env.MONGODB_DATABASE,
    serverSelectionTimeoutMS: 15000,
  });
  const db = mongoose.connection.db;

  // latest tree for the resource
  const tree = await db
    .collection("live_tutor_concept_trees")
    .findOne({ resourceId: RESOURCE, "nodes.0": { $exists: true } }, { sort: { createdAt: -1 } });
  if (!tree) throw new Error(`No tree with nodes for ${RESOURCE}`);

  const nodes = Array.isArray(tree.nodes) ? tree.nodes : [];
  const node =
    nodes.find((n) => (n.title || n.label || "").toLowerCase().includes(NODE_MATCH)) ||
    nodes.find((n) => n.nodeType === "concept") ||
    nodes[1];

  console.log(`Tree:     ${tree.treeId}`);
  console.log(`Concept:  "${node.title || node.label}"  (nodeId=${node.nodeId})`);
  console.log(`pageRefs: [${node.pageRefs}]`);

  // THE REAL CLICK PATH
  const pack = await buildSourceContext({
    ownerKey: OWNER,
    resourceId: RESOURCE,
    treeId: tree.treeId,
    nodeId: node.nodeId,
  });

  // strip base64 to keep the JSON small — Python loads images via imagePath
  const slimImages = (pack.pageImages || []).map((im) => ({
    page: im.page,
    imagePath: im.imagePath,
    imageUrl: im.imageUrl,
  }));

  const payload = {
    ...pack,
    pageImages: slimImages,
    // ensure vision gets summary/outline as strings
    fullPdfSummary:
      typeof pack.fullPdfSummary === "string"
        ? pack.fullPdfSummary
        : JSON.stringify(pack.fullPdfSummary || {}),
    fullPdfOutline:
      typeof pack.fullPdfOutline === "string"
        ? pack.fullPdfOutline
        : JSON.stringify(pack.fullPdfOutline || {}),
    selectedNode: { nodeId: node.nodeId, title: node.title || node.label, pageRefs: node.pageRefs },
  };

  const out = path.resolve(__dirname, "../../agent_output/node_payload.json");
  fs.writeFileSync(out, JSON.stringify(payload, null, 2));

  console.log(`\nSourceTruthPacket built:`);
  console.log(`  pageImages:        ${slimImages.length}  [pages ${slimImages.map((i) => i.page).join(",")}]`);
  console.log(`  selectedEvidence:  ${(pack.selectedEvidence || []).length}`);
  console.log(`  semanticChunks:    ${(pack.semanticChunks || []).length}  (RAG)`);
  console.log(`  sourceRefs:        ${(pack.sourceRefs || []).length}`);
  console.log(`  selectedPageText:  ${(pack.selectedPageFullText || "").length} chars`);
  console.log(`\nWrote: ${out}`);

  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
