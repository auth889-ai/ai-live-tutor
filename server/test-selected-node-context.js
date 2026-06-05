"use strict";

const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

const mongoose = require("mongoose");
const {
  GoogleLiveTutorConceptTree,
} = require("./models/GoogleLiveTutorBoard");

const sourceContextBuilder = require("./services/googleAgent/sourceContextBuilder.service");

async function main() {
  const ownerKey = process.env.TEST_OWNER_KEY || "jana_test";
  const treeId = process.env.TEST_TREE_ID;
  const nodeId = process.env.TEST_NODE_ID;

  if (!treeId || treeId === "YOUR_TREE_ID") {
    throw new Error("Set real TEST_TREE_ID first.");
  }

  if (!nodeId || nodeId === "YOUR_NODE_ID") {
    throw new Error("Set real TEST_NODE_ID first.");
  }

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("MONGODB_URI or MONGO_URI missing in .env");
  }

  await mongoose.connect(mongoUri, {
    dbName: process.env.MONGODB_DATABASE || undefined,
  });

  const tree = await GoogleLiveTutorConceptTree.findOne({
    ownerKey,
    treeId,
  }).lean();

  if (!tree) {
    throw new Error(`Tree not found for ownerKey=${ownerKey}, treeId=${treeId}`);
  }

  const selectedNode = (tree.nodes || []).find((node) => {
    return (
      node.nodeId === nodeId ||
      node.id === nodeId ||
      node.title === nodeId ||
      node.label === nodeId
    );
  });

  if (!selectedNode) {
    console.log("Available nodes:");
    console.log(
      (tree.nodes || []).slice(0, 40).map((n) => ({
        nodeId: n.nodeId,
        title: n.title || n.label,
        pages: n.pageRefs,
        imageCount: n.metadata?.richSourcePack?.pageImages?.length || 0,
      }))
    );
    throw new Error(`Node not found in tree: ${nodeId}`);
  }

  console.log("\n=== Selected node ===");
  console.log(JSON.stringify({
    nodeId: selectedNode.nodeId,
    title: selectedNode.title || selectedNode.label,
    pages: selectedNode.pageRefs,
    sourceRefCount: (selectedNode.sourceRefs || []).length,
    richSourcePackPageImageCount: selectedNode.metadata?.richSourcePack?.pageImages?.length || 0,
    richSourcePackPageImages: selectedNode.metadata?.richSourcePack?.pageImages || [],
  }, null, 2));

  const context = await sourceContextBuilder.buildSourceContext({
    ownerKey,
    resourceId: tree.resourceId,
    selectedNode,
    resource: {
      resourceId: tree.resourceId,
      title: tree.title,
      metadata: tree.metadata || {},
    },
    body: {
      treeId,
      nodeId,
    },
  });

  console.log("\n=== Required proof ===");
  console.log(JSON.stringify({
    pageImagesIncluded: context.metadata.pageImagesIncluded,
    richSourcePackPageImageCount: context.metadata.richSourcePackPageImageCount,
    selectedNodeFullPageImagesAvailable: context.metadata.selectedNodeFullPageImagesAvailable,
    geminiVisionPageImagesAvailable: context.metadata.geminiVisionPageImagesAvailable,
    selectedPageFullTextIncluded: context.metadata.selectedPageFullTextIncluded,
    fullPdfSummaryIncluded: context.metadata.fullPdfSummaryIncluded,
    fullPdfOutlineIncluded: context.metadata.fullPdfOutlineIncluded,
    tablesIncluded: context.metadata.tablesIncluded,
    figuresIncluded: context.metadata.figuresIncluded,
    layoutBlocksIncluded: context.metadata.layoutBlocksIncluded,
    fallbackUsed: context.metadata.fallbackUsed,
    usedSmartFallback: context.metadata.usedSmartFallback
  }, null, 2));

  console.log("\n=== Page images sent forward ===");
  console.log(JSON.stringify(context.pageImages, null, 2));

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exitls(1);
});
