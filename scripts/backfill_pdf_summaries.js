"use strict";

/**
 * scripts/backfill_pdf_summaries.js
 * Generates fullPdfSummary + fullPdfOutline for every existing resource
 * that doesn't have one yet (Task 1.5 backfill). Idempotent.
 *
 * Run: node scripts/backfill_pdf_summaries.js
 */

const path = require("path");
const ROOT = path.join(__dirname, "..");
require(path.join(ROOT, "server", "node_modules", "dotenv")).config({
  path: path.join(ROOT, ".env"),
});
const mongoose = require(path.join(ROOT, "server", "node_modules", "mongoose"));

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.MONGODB_DATABASE || "live-tutor",
  });

  const {
    GoogleLiveTutorResource,
  } = require(path.join(ROOT, "server", "models", "GoogleLiveTutorResource"));
  const {
    generatePdfSummaryOutline,
  } = require(path.join(ROOT, "server", "services", "googleAgent", "pdfSummaryOutline.service"));

  const resources = await GoogleLiveTutorResource.find({}).select("resourceId").lean();
  console.log(`Found ${resources.length} resources`);

  for (const r of resources) {
    try {
      const result = await generatePdfSummaryOutline(r.resourceId);
      console.log(
        result.skipped
          ? `SKIP  ${r.resourceId} (already has summary)`
          : `DONE  ${r.resourceId} — "${result.title}" (${result.sectionCount} sections)`
      );
    } catch (err) {
      console.error(`FAIL  ${r.resourceId}: ${err.message.slice(0, 160)}`);
    }
  }

  await mongoose.disconnect();
  console.log("Backfill complete.");
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
