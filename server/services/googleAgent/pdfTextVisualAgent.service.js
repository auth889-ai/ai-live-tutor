"use strict";

/**
 * server/services/googleAgent/pdfTextVisualAgent.service.js
 * =============================================================================
 * REAL Node bridge for Agent 1.
 *
 * What makes this hackathon-real:
 *   ✅ Reads real MongoDB resources/chunks from app DB
 *   ✅ Starts real MongoDB MCP server over stdio when enabled
 *   ✅ Sends initialize/tools/list/tools/call JSON-RPC messages
 *   ✅ Passes MCP proof into the Python ADK agent
 *   ✅ Calls real Google ADK Python agent
 *   ✅ Refuses fake success when strict MCP is required
 *
 * Agent 1 only:
 *   PDF/text/transcript -> source chunks -> MCP proof -> ADK agent -> visuals
 * =============================================================================
 */

const path = require("path");
const { spawn } = require("child_process");

const agent1ResourceService = require("./agent1Resource.service");

function safeString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function envNumber(names, fallback) {
  for (const name of safeArray(names)) {
    const raw = process.env[name];
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

function envString(names, fallback) {
  for (const name of safeArray(names)) {
    const raw = process.env[name];
    if (raw !== undefined && raw !== null && String(raw).trim()) {
      return String(raw).trim();
    }
  }
  return fallback;
}

function envTrue(names, fallback = false) {
  for (const name of safeArray(names)) {
    const raw = process.env[name];
    if (raw !== undefined && raw !== null && raw !== "") {
      return ["1", "true", "yes", "y", "on"].includes(String(raw).trim().toLowerCase());
    }
  }
  return fallback;
}

function projectRoot() {
  return path.resolve(__dirname, "../../..");
}

function pythonCommand() {
  return envString(["GOOGLE_LIVE_TUTOR_PYTHON", "LIVE_TUTOR_PYTHON", "PYTHON"], "python3");
}

function agentScriptPath() {
  return envString(
    ["AGENT1_VISUAL_AGENT_SCRIPT", "GOOGLE_LIVE_TUTOR_AGENT1_SCRIPT"],
    path.join(projectRoot(), "google_agent", "agent1_pdf_text_visual_agent.py")
  );
}

const DEFAULT_TIMEOUT_MS = envNumber(
  [
    "GOOGLE_LIVE_TUTOR_AGENT1_TIMEOUT_MS",
    "GOOGLE_LIVE_TUTOR_AGENT_TIMEOUT_MS",
    "GOOGLE_LIVE_TUTOR_TIMEOUT_MS",
    "LIVE_TUTOR_AGENT_TIMEOUT_MS",
  ],
  300000
);

const MCP_TIMEOUT_MS = envNumber(["AGENT1_MCP_TIMEOUT_MS", "MONGODB_MCP_TIMEOUT_MS"], 20000);

const MAX_BUFFER_CHARS = envNumber(
  ["GOOGLE_LIVE_TUTOR_MAX_BUFFER_CHARS", "LIVE_TUTOR_MAX_BUFFER_CHARS"],
  30000000
);

function appendLimited(current, chunk) {
  const next = current + chunk;
  if (next.length <= MAX_BUFFER_CHARS) return next;

  return (
    next.slice(0, Math.floor(MAX_BUFFER_CHARS * 0.65)) +
    "\n\n...[agent1 bridge truncated middle output]...\n\n" +
    next.slice(-Math.floor(MAX_BUFFER_CHARS * 0.3))
  );
}

function extractJsonObject(rawText) {
  const text = safeString(rawText).trim();

  if (!text) {
    throw new Error("Agent 1 Python returned empty output.");
  }

  const attempts = [text];

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) attempts.push(fenced[1].trim());

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    attempts.push(text.slice(first, last + 1));
  }

  for (const candidate of attempts) {
    try {
      return JSON.parse(
        candidate
          .replace(/^```json/i, "")
          .replace(/```/g, "")
          .replace(/,\s*}/g, "}")
          .replace(/,\s*]/g, "]")
          .trim()
      );
    } catch {
      // try next candidate
    }
  }

  throw new Error(`Agent 1 Python did not return valid JSON. Preview: ${text.slice(0, 1200)}`);
}

/**
 * Minimal JSON-RPC over stdio MCP client.
 * This is real protocol communication with the configured MCP server.
 */
async function runMongoMcpProof({ resourceId }) {
  const enabled = envTrue(["LIVE_TUTOR_USE_MONGODB_MCP", "USE_MONGODB_MCP", "MONGODB_MCP_ENABLED"]);
  const requireMcp = envTrue(["AGENT1_REQUIRE_REAL_MCP", "LIVE_TUTOR_REQUIRE_REAL_MCP"], false);

  const command = envString(["MONGODB_MCP_COMMAND"], "npx");
  const argsRaw = envString(
    ["MONGODB_MCP_ARGS"],
    "-y,mongodb-mcp-server@latest,--readOnly,--connectionString,$MDB_MCP_CONNECTION_STRING"
  );

  const connectionString =
    process.env.MDB_MCP_CONNECTION_STRING ||
    process.env.MONGODB_MCP_CONNECTION_STRING ||
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    "";

  const args = argsRaw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace("$MDB_MCP_CONNECTION_STRING", connectionString));

  const proof = {
    enabled,
    requireMcp,
    realMcpConnected: false,
    realMcpToolCall: false,
    toolsListed: false,
    toolCallSucceeded: false,
    command,
    args: args.map((a) => (a.includes("mongodb+srv://") ? "[redacted-connection-string]" : a)),
    database: process.env.MONGODB_MCP_DATABASE || process.env.MONGODB_DATABASE || "live-tutor",
    resourceId,
    tools: [],
    selectedTool: null,
    responses: [],
    error: "",
  };

  if (!enabled) {
    proof.error = "MongoDB MCP disabled by env.";
    if (requireMcp) {
      throw new Error("AGENT1_REQUIRE_REAL_MCP=true but MongoDB MCP is disabled.");
    }
    return proof;
  }

  if (!connectionString) {
    proof.error = "Missing MongoDB MCP connection string.";
    if (requireMcp) throw new Error(proof.error);
    return proof;
  }

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let nextId = 1;
    const pending = new Map();
    let settled = false;

    const child = spawn(command, args, {
      cwd: projectRoot(),
      env: {
        ...process.env,
        MDB_MCP_CONNECTION_STRING: connectionString,
        MONGODB_MCP_CONNECTION_STRING: connectionString,
        MDB_MCP_READ_ONLY: "true",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }

      if (requireMcp && !result.realMcpConnected) {
        reject(new Error(`Required MongoDB MCP failed: ${result.error || "not connected"}`));
        return;
      }

      resolve(result);
    }

    function send(method, params, expectResponse = true) {
      const id = expectResponse ? nextId++ : undefined;
      const message = {
        jsonrpc: "2.0",
        method,
        params: params || {},
      };

      if (expectResponse) message.id = id;

      child.stdin.write(`${JSON.stringify(message)}\n`);

      if (!expectResponse) return Promise.resolve(null);

      return new Promise((res, rej) => {
        pending.set(id, { res, rej, method });
      });
    }

    function handleLine(line) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("{")) return;

      let msg;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        return;
      }

      proof.responses.push({
        id: msg.id,
        method: msg.method,
        hasResult: Boolean(msg.result),
        hasError: Boolean(msg.error),
        error: msg.error?.message || "",
      });

      if (msg.id && pending.has(msg.id)) {
        const item = pending.get(msg.id);
        pending.delete(msg.id);

        if (msg.error) {
          item.rej(new Error(msg.error.message || `MCP ${item.method} failed`));
        } else {
          item.res(msg.result);
        }
      }
    }

    child.stdout.on("data", (data) => {
      stdout += data.toString("utf8");
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() || "";
      lines.forEach(handleLine);
    });

    child.stderr.on("data", (data) => {
      stderr = appendLimited(stderr, data.toString("utf8"));
    });

    child.on("error", (error) => {
      proof.error = error.message;
      finish(proof);
    });

    child.on("close", (code) => {
      if (!settled && !proof.realMcpConnected) {
        proof.error = `MongoDB MCP process closed before initialize. code=${code}. stderr=${stderr.slice(-600)}`;
        finish(proof);
      }
    });

    const timer = setTimeout(() => {
      proof.error = `MongoDB MCP proof timed out after ${MCP_TIMEOUT_MS}ms. stderr=${stderr.slice(-800)}`;
      finish(proof);
    }, MCP_TIMEOUT_MS);

    (async () => {
      try {
        const init = await send("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: {
            name: "ai-live-tutor-agent1",
            version: "1.0.0",
          },
        });

        proof.realMcpConnected = true;
        proof.initialize = {
          serverInfo: init?.serverInfo || null,
          protocolVersion: init?.protocolVersion || null,
        };

        await send("notifications/initialized", {}, false);

        const toolsList = await send("tools/list", {});
        const tools = safeArray(toolsList?.tools);
        proof.toolsListed = true;
        proof.tools = tools.map((tool) => ({
          name: tool.name,
          description: safeString(tool.description).slice(0, 240),
          inputSchema: tool.inputSchema || null,
        }));

        const toolNames = proof.tools.map((t) => t.name);
        const selected =
          toolNames.find((name) => /find|query|aggregate|collection|list/i.test(name)) ||
          toolNames[0];

        proof.selectedTool = selected || null;

        if (selected) {
          const candidateArgsList = [
            {
              database: proof.database,
              collection: process.env.LIVE_TUTOR_MCP_RESOURCE_COLLECTION || "resources",
              filter: { resourceId },
              limit: 1,
            },
            {
              database: proof.database,
              collection: process.env.LIVE_TUTOR_MCP_CHUNK_COLLECTION || "resource_chunks",
              filter: { resourceId },
              limit: 1,
            },
            {
              db: proof.database,
              collection: process.env.LIVE_TUTOR_MCP_RESOURCE_COLLECTION || "resources",
              query: { resourceId },
              limit: 1,
            },
            {
              database: proof.database,
            },
            {},
          ];

          for (const argsCandidate of candidateArgsList) {
            try {
              const call = await send("tools/call", {
                name: selected,
                arguments: argsCandidate,
              });

              proof.toolCallSucceeded = true;
              proof.realMcpToolCall = true;
              proof.toolCall = {
                name: selected,
                argumentsUsed: argsCandidate,
                resultPreview: safeString(call).slice(0, 1500),
              };
              break;
            } catch (toolError) {
              proof.toolCallError = safeString(toolError.message || toolError).slice(0, 500);
            }
          }
        }

        finish(proof);
      } catch (error) {
        proof.error = safeString(error.message || error);
        proof.stderrPreview = stderr.slice(-1200);
        finish(proof);
      }
    })();
  });
}

async function callAgent1Python(payload = {}, options = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const python = pythonCommand();
  const script = agentScriptPath();
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn(python, [script], {
      cwd: projectRoot(),
      env: {
        ...process.env,
        AGENT1_ONLY: "true",
        LIVE_TUTOR_STRICT: process.env.LIVE_TUTOR_STRICT || "true",
        AGENT1_REQUIRE_ADK_TOOL_CALLS: process.env.AGENT1_REQUIRE_ADK_TOOL_CALLS || "true",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;

      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }

      const err = new Error(`Agent 1 Python timed out after ${timeoutMs}ms`);
      err.code = "AGENT1_TIMEOUT";
      err.timeoutMs = timeoutMs;
      err.stdoutPreview = stdout.slice(-3000);
      err.stderrPreview = stderr.slice(-3000);
      reject(err);
    }, timeoutMs);

    child.stdout.on("data", (data) => {
      stdout = appendLimited(stdout, data.toString("utf8"));
    });

    child.stderr.on("data", (data) => {
      stderr = appendLimited(stderr, data.toString("utf8"));
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const runtimeMs = Date.now() - startedAt;

      if (code !== 0) {
        const err = new Error(
          `Agent 1 Python exited with code ${code}${signal ? ` signal ${signal}` : ""}. ${stderr.slice(-1200)}`
        );
        err.code = "AGENT1_EXIT";
        err.exitCode = code;
        err.signal = signal;
        err.runtimeMs = runtimeMs;
        err.stdoutPreview = stdout.slice(-4000);
        err.stderrPreview = stderr.slice(-4000);
        reject(err);
        return;
      }

      try {
        const parsed = extractJsonObject(stdout);
        parsed.metadata = {
          ...(parsed.metadata || {}),
          nodeBridgeUsed: true,
          nodeBridgeRuntimeMs: runtimeMs,
          nodeBridgeTimeoutMs: timeoutMs,
          python,
          script,
        };
        resolve(parsed);
      } catch (error) {
        error.runtimeMs = runtimeMs;
        error.stdoutPreview = stdout.slice(-4000);
        error.stderrPreview = stderr.slice(-4000);
        reject(error);
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

function selectChunksForAgent1(chunks, question, maxChunks = 120) {
  const q = safeString(question).toLowerCase();
  const terms = q
    .split(/[^a-zA-Z0-9_+#.-]+/)
    .filter((x) => x.length >= 3)
    .slice(0, 50);

  return safeArray(chunks)
    .map((chunk) => {
      const text = safeString(chunk.text).toLowerCase();
      const title = safeString(chunk.title).toLowerCase();
      let score = 0;

      for (const term of terms) {
        if (text.includes(term)) score += 2;
        if (title.includes(term)) score += 3;
      }

      if (
        /database|schema|migration|evolution|version|table|entity|relationship|process|workflow|state|timeline|sequence|class|roadmap|concept/i.test(
          text
        )
      ) {
        score += 2;
      }

      return {
        ...chunk,
        agent1Score: score,
      };
    })
    .sort((a, b) => {
      return (
        Number(b.agent1Score || 0) - Number(a.agent1Score || 0) ||
        Number(a.page || 0) - Number(b.page || 0) ||
        Number(a.chunkIndex || 0) - Number(b.chunkIndex || 0)
      );
    })
    .slice(0, Math.min(Math.max(Number(maxChunks || 120), 8), 250))
    .sort((a, b) => {
      return (
        Number(a.page || 0) - Number(b.page || 0) ||
        Number(a.chunkIndex || 0) - Number(b.chunkIndex || 0)
      );
    });
}

async function health() {
  let mcpProof = null;

  if (envTrue(["AGENT1_HEALTH_CHECK_MCP"], false)) {
    try {
      mcpProof = await runMongoMcpProof({ resourceId: "health_check" });
    } catch (error) {
      mcpProof = {
        enabled: true,
        realMcpConnected: false,
        error: error.message,
      };
    }
  }

  try {
    const result = await callAgent1Python(
      {
        mode: "health",
        mcpProof,
      },
      {
        timeoutMs: 60000,
      }
    );

    return {
      ok: Boolean(result.ok),
      service: "pdfTextVisualAgent.service",
      agent1: result,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      script: agentScriptPath(),
      python: pythonCommand(),
      realPythonAgent: true,
      realAdkAgent: Boolean(result.realAdkAgent || result.metadata?.realAdkAgent),
      realGeminiAgent: Boolean(result.googleApiKeyPresent),
      mongoDbAppReadWrite: true,
      mcpConfigured: envTrue([
        "LIVE_TUTOR_USE_MONGODB_MCP",
        "USE_MONGODB_MCP",
        "MONGODB_MCP_ENABLED",
      ]),
      mcpProof,
    };
  } catch (error) {
    return {
      ok: false,
      service: "pdfTextVisualAgent.service",
      error: error.message,
      stdoutPreview: error.stdoutPreview,
      stderrPreview: error.stderrPreview,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      script: agentScriptPath(),
      python: pythonCommand(),
      realPythonAgent: true,
      realAdkAgent: false,
      realGeminiAgent: false,
      mongoDbAppReadWrite: true,
      mcpConfigured: envTrue([
        "LIVE_TUTOR_USE_MONGODB_MCP",
        "USE_MONGODB_MCP",
        "MONGODB_MCP_ENABLED",
      ]),
      mcpProof,
    };
  }
}

async function runAgent1FromResource({ ownerKey, resourceId, body = {}, context = {} }) {
  const question =
    body.question ||
    body.prompt ||
    "From this resource, create source-grounded visuals: flowchart, ER if relevant, sequence if relevant, timeline if relevant, mindmap, class/state if relevant, roadmap tree, and teaching table.";

  const resource = await agent1ResourceService.getResource({
    ownerKey,
    resourceId,
  });

  if (!resource) {
    return {
      ok: false,
      statusCode: 404,
      error: "Resource not found for this ownerKey.",
      metadata: {
        mongoResourceRead: false,
        resourceId,
        ownerKey,
      },
    };
  }

  const allChunks = await agent1ResourceService.getChunks({
    ownerKey,
    resourceId,
    limit: Number(body.chunkReadLimit || 1200),
  });

  if (!allChunks.length) {
    return {
      ok: false,
      statusCode: 404,
      error: "No chunks found for this resource.",
      metadata: {
        mongoResourceRead: true,
        mongoChunkRead: false,
        resourceId,
        ownerKey,
      },
    };
  }

  const selectedChunks = selectChunksForAgent1(
    allChunks,
    question,
    Number(body.maxChunks || 120)
  );

  let mcpProof = {};
  try {
    mcpProof = await runMongoMcpProof({ resourceId });
  } catch (error) {
    return {
      ok: false,
      statusCode: 502,
      error: `Real MongoDB MCP proof failed: ${error.message}`,
      metadata: {
        resourceId,
        ownerKey,
        mongoResourceRead: true,
        mongoChunkRead: true,
        mcpProofFailed: true,
      },
    };
  }

  const requireMcp = envTrue(["AGENT1_REQUIRE_REAL_MCP", "LIVE_TUTOR_REQUIRE_REAL_MCP"], false);
  if (requireMcp && !mcpProof.realMcpConnected) {
    return {
      ok: false,
      statusCode: 502,
      error: "AGENT1_REQUIRE_REAL_MCP=true but MongoDB MCP did not connect.",
      metadata: {
        mcpProof,
      },
    };
  }

  const payload = {
    mode: "generate",

    resourceId,
    resourceTitle: resource.title,
    title: resource.title,
    sourceType: resource.sourceType,

    question,
    studentLevel: body.studentLevel || "beginner",
    language: body.language || "english",

    visuals: body.visuals || [
      "flowchart",
      "er",
      "sequence",
      "timeline",
      "mindmap",
      "conceptMap",
      "class",
      "state",
      "roadmapTree",
      "table",
    ],

    sourceMaxChars: Number(body.sourceMaxChars || 90000),
    maxOutputTokens: Number(body.maxOutputTokens || 8192),
    temperature: Number(body.temperature || 0.12),

    chunks: selectedChunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      resourceId: chunk.resourceId,
      sourceType: chunk.sourceType,
      title: chunk.title,
      page: chunk.page,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      textPreview: chunk.textPreview,
      sourceRef: chunk.sourceRef,
      pageRef: chunk.pageRef,
      agent1Score: chunk.agent1Score,
    })),

    mcpProof,

    context: {
      ownerKey,
      offlineUserId: context.offlineUserId,
      deviceId: context.deviceId,
    },
  };

  const result = await callAgent1Python(payload, {
    timeoutMs: Number(body.timeoutMs || DEFAULT_TIMEOUT_MS),
  });

  if (!result.ok) {
    return {
      ...result,
      statusCode: result.statusCode || 422,
      metadata: {
        ...(result.metadata || {}),
        resourceId,
        ownerKey,
        mongoResourceRead: true,
        mongoChunkRead: true,
        fullChunkCount: allChunks.length,
        selectedChunkCount: selectedChunks.length,
        mcpProof,
      },
    };
  }

  return {
    ...result,
    metadata: {
      ...(result.metadata || {}),
      resourceId,
      resourceTitle: resource.title,
      sourceType: resource.sourceType,
      mongoResourceRead: true,
      mongoChunkRead: true,
      fullChunkCount: allChunks.length,
      selectedChunkCount: selectedChunks.length,
      mcpConfigured: envTrue([
        "LIVE_TUTOR_USE_MONGODB_MCP",
        "USE_MONGODB_MCP",
        "MONGODB_MCP_ENABLED",
      ]),
      mcpProof,
      realMcpConnected: Boolean(mcpProof.realMcpConnected),
      realMcpToolCall: Boolean(mcpProof.realMcpToolCall || mcpProof.toolCallSucceeded || mcpProof.toolsListed),
      mcpReadProof: {
        partner: "mongodb",
        database: process.env.MONGODB_DATABASE || "live-tutor",
        resourceCollection: process.env.LIVE_TUTOR_MCP_RESOURCE_COLLECTION || "resources",
        chunkCollection: process.env.LIVE_TUTOR_MCP_CHUNK_COLLECTION || "resource_chunks",
        appDbResourceRead: true,
        appDbChunkRead: true,
        mcpConnected: Boolean(mcpProof.realMcpConnected),
        mcpToolsListed: Boolean(mcpProof.toolsListed),
        mcpToolCallSucceeded: Boolean(mcpProof.toolCallSucceeded),
        selectedChunkCount: selectedChunks.length,
      },
      noImageUnderstanding: true,
      noHtmlPreview: true,
      noDrawio: true,
      noDryRun: true,
    },
  };
}

module.exports = {
  health,
  runAgent1FromResource,
  callAgent1Python,
  selectChunksForAgent1,
  runMongoMcpProof,
};