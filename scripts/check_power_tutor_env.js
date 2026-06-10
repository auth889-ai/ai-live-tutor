#!/usr/bin/env node
"use strict";

/**
 * Print Stage 2 power-tool readiness without exposing secret values.
 */

const path = require("path");

require(path.join(__dirname, "..", "server", "node_modules", "dotenv")).config({
  path: path.join(__dirname, "..", ".env"),
});

const { buildPowerToolsReport } = require("../server/services/googleAgent/stage2/stage2PowerToolsConfig");

function mark(value) {
  return value ? "OK" : "MISS";
}

const report = buildPowerToolsReport();

console.log("Stage 2 Power Tutor Environment");
console.log("================================");
console.log(`mode: ${report.readiness.mode}`);
console.log(`minimumReady: ${report.readiness.minimumReady}`);
console.log(`strongReady: ${report.readiness.strongReady}`);
console.log(`worldBestReady: ${report.readiness.worldBestReady}`);
console.log("");

for (const tool of report.tools) {
  const present = tool.presentEnv.length ? ` present=[${tool.presentEnv.join(", ")}]` : "";
  console.log(`${mark(tool.configured)} ${tool.id} (${tool.tier})${present}`);
  if (!tool.configured) {
    console.log(`    add one of: ${tool.acceptedEnv.join(" OR ")}`);
  }
}

console.log("");
if (report.missingRequired.length) {
  console.log("Missing required env:");
  for (const key of report.missingRequired) console.log(`- ${key}`);
} else {
  console.log("Required env: OK");
}

if (report.missingForWorldBest.length) {
  console.log("");
  console.log("Missing for world-best mode:");
  for (const item of report.missingForWorldBest) {
    console.log(`- ${item.label}: ${item.acceptedEnv.join(" OR ")}`);
  }
}
