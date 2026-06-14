"use strict";
/**
 * scripts/regenerateConceptTree.js
 * ---------------------------------------------------------------------------
 * Regenerate the concept/subconcept ROADMAP TREE for a resource and print it.
 *
 * The tree is built MULTIMODALLY: the AI sees ALL page images of the PDF plus
 * the extracted text, finds every concept/subconcept, and we keep every page
 * (vision = truth — picture-only concepts are no longer dropped).
 *
 * Usage:
 *   cd server
 *   node scripts/regenerateConceptTree.js <resourceId> <ownerKey>
 *
 * Defaults to the "test 7" Denormalization PDF (22 pages).
 * ---------------------------------------------------------------------------
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const mongoose = require("mongoose");
const svc = require("../services/googleAgent/stage1ConceptTree.service.js");

const RESOURCE = process.argv[2] || "glt_resource_1780558985921_5f1ea0e3";
const OWNER = process.argv[3] || "jana_test";

function printTree(nodes) {
  const childrenOf = (id) => nodes.filter((n) => n.parentId === id);
  const roots = nodes.filter((n) => !n.parentId || !nodes.some((m) => m.nodeId === n.parentId));
  const seen = new Set();

  const line = (n, prefix, isLast) => {
    if (seen.has(n.nodeId)) return;
    seen.add(n.nodeId);
    const branch = prefix === "" ? "" : isLast ? "└── " : "├── ";
    const pages = (n.pageRefs || []).join(",");
    const type = n.nodeType ? ` (${n.nodeType})` : "";
    console.log(`${prefix}${branch}${n.title || n.label || n.nodeId}${type}  [p${pages}]`);
    const kids = childrenOf(n.nodeId);
    const childPrefix = prefix === "" ? "" : prefix + (isLast ? "    " : "│   ");
    kids.forEach((c, i) => line(c, childPrefix === "" ? "" : childPrefix, i === kids.length - 1));
    // top level children indent under root
    if (prefix === "") kids.forEach(() => {});
  };

  // print root then its subtree with box-drawing
  roots.forEach((r) => {
    console.log(`${r.title || r.label || r.nodeId}  [p${(r.pageRefs || []).join(",")}]`);
    const kids = childrenOf(r.nodeId);
    seen.add(r.nodeId);
    kids.forEach((c, i) => line(c, "", i === kids.length - 1));
  });
  // orphans
  nodes.filter((n) => !seen.has(n.nodeId)).forEach((n) => line(n, "", true));
}

(async () => {
  console.log(`\nRegenerating concept tree for ${RESOURCE} (owner ${OWNER})...\n`);
  const out = await svc.buildConceptTree({ ownerKey: OWNER, resourceId: RESOURCE, body: {}, context: {} });
  const treeId = (out.tree || out).treeId || out.treeId;

  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
    dbName: process.env.MONGODB_DATABASE,
    serverSelectionTimeoutMS: 15000,
  });
  const doc = await mongoose.connection.db
    .collection("live_tutor_concept_trees")
    .findOne({ treeId });
  const nodes = (doc && doc.nodes) || [];

  // stats
  const types = {};
  nodes.forEach((n) => (types[n.nodeType] = (types[n.nodeType] || 0) + 1));
  const covered = new Set();
  nodes.forEach((n) => (n.pageRefs || []).forEach((p) => covered.add(Number(p))));
  const totalPages = (doc && doc.metadata && doc.metadata.pageCoverage && doc.metadata.pageCoverage.totalPages) ||
    Math.max(...[...covered, 0]);
  const missing = [];
  for (let p = 1; p <= totalPages; p++) if (!covered.has(p)) missing.push(p);

  console.log("============================ ROADMAP TREE ============================\n");
  printTree(nodes);
  console.log("\n=====================================================================");
  console.log(`treeId:           ${treeId}`);
  console.log(`nodes:            ${nodes.length}`);
  console.log(`nodeTypes:        ${JSON.stringify(types)}`);
  console.log(`pages seen by AI: ${doc && doc.metadata && doc.metadata.pageImagesSeenByModel}`);
  console.log(`pages covered:    ${[...covered].sort((a, b) => a - b).join(",")}`);
  console.log(`MISSING pages:    ${missing.length ? missing.join(",") : "NONE — all pages covered ✅"}`);
  console.log("=====================================================================\n");

  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
