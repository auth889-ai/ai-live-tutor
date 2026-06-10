"use strict";

const { spawn } = require("child_process");

function getMcpArgs() {
  const cmd  = process.env.MONGODB_MCP_COMMAND || "npx";
  const args = (process.env.MONGODB_MCP_ARGS   || "-y mongodb-mcp-server").split(/\s+/);
  const conn = process.env.MDB_MCP_CONNECTION_STRING || process.env.MONGODB_MCP_CONNECTION_STRING || "";
  const db   = process.env.MONGODB_MCP_DATABASE || "live-tutor";
  return { cmd, args, conn, db };
}

function isMcpEnabled() {
  const v = process.env.LIVE_TUTOR_USE_MONGODB_MCP || process.env.USE_MONGODB_MCP || "";
  return ["1","true","yes"].includes(v.toLowerCase());
}

async function mirrorToMcp(collection, documents) {
  if (!isMcpEnabled() || !documents.length) {
    return { ok: true, mirrored: 0, skipped: true, reason: "MCP disabled or no documents." };
  }

  const { conn, db } = getMcpArgs();
  if (!conn) return { ok: false, mirrored: 0, error: "MDB_MCP_CONNECTION_STRING missing." };

  const payload = { operation: "insertMany", database: db, collection, documents };

  return new Promise((resolve) => {
    const child = spawn("npx", ["-y", "mongodb-mcp-server"], {
      env: { ...process.env, MDB_MCP_CONNECTION_STRING: conn },
    });
    let out = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, mirrored: 0, error: "MCP mirror timeout." });
    }, Number(process.env.MONGODB_MCP_TIMEOUT_MS || 15000));

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
    child.stdout.on("data", (d) => { out += d; });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(out.trim());
        resolve({ ok: true, mirrored: documents.length, result: r });
      } catch {
        resolve({ ok: true, mirrored: 0, warning: "MCP response not JSON — documents may have been inserted." });
      }
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, mirrored: 0, error: e.message });
    });
  });
}

async function mirrorTreeToMcp(treeDoc, chunks) {
  const treeCol   = process.env.MONGODB_MCP_TREES_COLLECTION  || "googlelivetutorconcepttrees";
  const chunkCol  = process.env.MONGODB_MCP_CHUNKS_COLLECTION || "googlelivetutorresourcechunks";

  const [treeResult, chunkResult] = await Promise.all([
    mirrorToMcp(treeCol,  [{ ...treeDoc, _mcpMirrored: true }]),
    mirrorToMcp(chunkCol, chunks.slice(0, 200).map((c) => ({ ...c, _mcpMirrored: true }))),
  ]);

  return {
    ok:           treeResult.ok,
    treeMirrored: treeResult.mirrored,
    chunksMirrored: chunkResult.mirrored,
    treeResult,
    chunkResult,
  };
}

module.exports = { mirrorToMcp, mirrorTreeToMcp, isMcpEnabled };
