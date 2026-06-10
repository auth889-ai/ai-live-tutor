#!/usr/bin/env node
/**
 * test-stage1-tree.js
 * Terminal test for Stage 1 tree building pipeline.
 * Run: node test-stage1-tree.js
 *
 * Tests:
 *  1. Page images load from disk
 *  2. Chunks load from MongoDB
 *  3. Gemini 3-pass tree build (summary → outline → tree)
 *  4. Every node has sourceRefs + pageRefs + richSourcePack
 *  5. Reports quality metrics
 */

require("dotenv").config({ path: __dirname + "/server/.env" });
require("dotenv").config({ path: __dirname + "/.env" });

const RESOURCE_ID = process.argv[2] || "glt_resource_1780558985921_5f1ea0e3";
const OWNER_KEY   = process.argv[3] || "jana_test";

const { buildTree } = require("./server/services/googleAgent/stage1/stage1BuildPipeline");
const { getAllPageImages } = require("./server/services/googleAgent/sourceContext/pageImageContext");
const { loadChunksByResource } = require("./server/services/googleAgent/sourceContext/chunkLoader");
const { loadResource } = require("./server/services/googleAgent/sourceContext/resourceLoader");

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m",
  cyan: "\x1b[36m", blue: "\x1b[34m", dim: "\x1b[2m",
};

const ok  = (msg) => console.log(`${C.green}  ✓${C.reset} ${msg}`);
const err = (msg) => console.log(`${C.red}  ✗${C.reset} ${msg}`);
const info = (msg) => console.log(`${C.cyan}  →${C.reset} ${msg}`);
const head = (msg) => console.log(`\n${C.bold}${C.blue}${msg}${C.reset}`);
const warn = (msg) => console.log(`${C.yellow}  ⚠${C.reset} ${msg}`);

function showNode(node, idx) {
  const refs   = (node.sourceRefs || []).length;
  const pages  = (node.pageRefs || []).join(",") || "?";
  const imgs   = (node.richSourcePack?.pageImages || []).length;
  const ev     = (node.richSourcePack?.selectedEvidence || []).length;
  const hasImg = imgs > 0 ? `${C.green}📷${imgs}${C.reset}` : `${C.dim}no-img${C.reset}`;
  const hasSrc = refs > 0 ? `${C.green}✓refs:${refs}${C.reset}` : `${C.red}✗NO-REFS${C.reset}`;
  console.log(
    `  ${String(idx).padStart(2)}. ${C.bold}${node.title.slice(0, 42).padEnd(42)}${C.reset}` +
    ` [${(node.nodeType || "?").padEnd(10)}]` +
    ` p.${pages.padEnd(8)}` +
    ` ${hasSrc}` +
    ` ev:${ev}` +
    ` ${hasImg}` +
    ` level:${node.level ?? "?"}`
  );
}

async function run() {
  console.log(`\n${C.bold}╔══════════════════════════════════════════════════╗`);
  console.log(`║      Stage 1 Tree Build — Terminal Test           ║`);
  console.log(`╚══════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  resource : ${RESOURCE_ID}`);
  console.log(`  ownerKey : ${OWNER_KEY}`);

  // ── 1. Check page images ──
  head("Step 1 — Page Images on Disk");
  const images = getAllPageImages(RESOURCE_ID);
  if (images.length === 0) {
    err("No page images found. Run Agent 1 to render PDF pages first.");
  } else {
    ok(`${images.length} page images found`);
    info(`First: ${images[0].imageUrl}`);
    info(`Last:  ${images[images.length - 1].imageUrl}`);
  }

  // ── 2. Check chunks ──
  head("Step 2 — Chunks in MongoDB");
  let chunks;
  try {
    chunks = await loadChunksByResource(RESOURCE_ID);
    ok(`${chunks.length} chunks loaded`);
    const pages = [...new Set(chunks.map(c => c.page))].sort((a, b) => a - b);
    info(`Pages covered: ${pages.join(", ")}`);
    info(`Sample chunk (p.${chunks[0].page}): "${(chunks[0].text || "").slice(0, 100)}..."`);
  } catch (e) {
    err(`Chunk load failed: ${e.message}`);
    process.exit(1);
  }

  // ── 3. Check resource ──
  head("Step 3 — Resource Metadata");
  let resource;
  try {
    resource = await loadResource({ ownerKey: OWNER_KEY, resourceId: RESOURCE_ID });
    ok(`Resource: "${resource.title}" | status: ${resource.status}`);
    info(`Pages: ${resource.extraction?.pageCount || "?"} | Chunks: ${resource.extraction?.chunkCount || "?"}`);
  } catch (e) {
    err(`Resource load failed: ${e.message}`);
    process.exit(1);
  }

  // ── 4. Build tree ──
  head("Step 4 — Building Concept Tree (Gemini 3-pass)");
  info("Pass 1: Full PDF summary...");
  info("Pass 2: Chapter outline + roadmap modules...");
  info("Pass 3: Full concept tree with sub-nodes...");
  console.log(`  ${C.dim}(this takes 30-90 seconds with Gemini 2.5 Flash)${C.reset}\n`);

  const startMs = Date.now();
  let result;
  try {
    result = await buildTree({ ownerKey: OWNER_KEY, resourceId: RESOURCE_ID });
  } catch (e) {
    err(`Tree build failed: ${e.message}`);
    if (e.stack) console.log(C.dim + e.stack + C.reset);
    process.exit(1);
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  ok(`Tree built in ${elapsed}s`);

  // ── 5. Quality report ──
  head("Step 5 — Tree Quality Report");
  const nodes  = result.nodes  || [];
  const edges  = result.edges  || [];
  const sourced = nodes.filter(n => (n.sourceRefs || []).length > 0);
  const withImg = nodes.filter(n => (n.richSourcePack?.pageImages || []).length > 0);
  const withEv  = nodes.filter(n => (n.richSourcePack?.selectedEvidence || []).length > 0);
  const noSrc   = nodes.filter(n => !(n.sourceRefs || []).length);

  console.log(`\n  ${C.bold}Tree ID:${C.reset}   ${result.treeId}`);
  console.log(`  ${C.bold}Board ID:${C.reset}  ${result.boardId}`);
  console.log(`  ${C.bold}Root:${C.reset}      ${result.rootNodeId || "?"}`);
  console.log(`  ${C.bold}Title:${C.reset}     ${result.title || "?"}`);
  console.log();
  console.log(`  Total nodes  : ${nodes.length}`);
  console.log(`  Total edges  : ${edges.length}`);
  sourced.length === nodes.length
    ? ok(`All ${nodes.length} nodes have sourceRefs`)
    : warn(`${sourced.length}/${nodes.length} nodes have sourceRefs (${noSrc.length} missing)`);
  withImg.length > 0
    ? ok(`${withImg.length}/${nodes.length} nodes have page images`)
    : warn("No nodes have page images attached");
  withEv.length > 0
    ? ok(`${withEv.length}/${nodes.length} nodes have selectedEvidence`)
    : warn("No nodes have selectedEvidence");

  // ── 6. Show PDF summary ──
  head("Step 6 — Full PDF Summary");
  const summary = result.fullPdfSummary || {};
  ok(`Title:      ${summary.title || "?"}`);
  ok(`Subject:    ${summary.subject || "?"}`);
  ok(`Difficulty: ${summary.difficulty || "?"}`);
  if ((summary.mainTopics || []).length)
    ok(`Topics:     ${summary.mainTopics.slice(0,5).join(", ")}`);
  if ((result.roadmapModules || []).length)
    info(`Modules:    ${result.roadmapModules.join(" | ")}`);

  // ── 7. Show all nodes ──
  head("Step 7 — All Nodes (sorted by level)");
  const byLevel = [...nodes].sort((a, b) => (a.level ?? 1) - (b.level ?? 1) || (a.readOrder ?? 99) - (b.readOrder ?? 99));
  byLevel.forEach((n, i) => showNode(n, i + 1));

  // ── 8. Node type breakdown ──
  head("Step 8 — Node Type Breakdown");
  const typeMap = {};
  nodes.forEach(n => { typeMap[n.nodeType || "unknown"] = (typeMap[n.nodeType || "unknown"] || 0) + 1; });
  Object.entries(typeMap).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log(`  ${type.padEnd(14)} → ${count}`);
  });

  // ── 9. Final verdict ──
  head("Final Verdict");
  const score = Math.round((sourced.length / Math.max(nodes.length, 1)) * 100);
  if (score === 100 && nodes.length >= 15) {
    ok(`PASS — ${nodes.length} nodes, 100% source-grounded, ${withImg.length} with page images`);
  } else if (score >= 70) {
    warn(`PARTIAL — ${nodes.length} nodes, ${score}% sourced — some nodes lack evidence`);
  } else {
    err(`FAIL — ${score}% sourced — rebuild with better PDF chunks`);
  }

  console.log(`\n${C.dim}  Coverage: ${result.metadata?.coverage?.coverageScore ?? "?"}%` +
    ` | Pages covered: ${result.metadata?.coverage?.coveredPages ?? "?"}` +
    ` of ${result.metadata?.coverage?.totalPages ?? "?"}${C.reset}\n`);

  process.exit(0);
}

run().catch((e) => {
  console.error("\n" + C.red + "FATAL:" + C.reset, e.message);
  process.exit(1);
});
