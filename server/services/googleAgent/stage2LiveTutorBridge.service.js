"use strict";

/**
 * server/services/googleAgent/stage2LiveTutorBridge.service.js
 * =============================================================================
 * Stage 2 Live Tutor Bridge
 *
 * Node/Express
 *   -> this bridge
 *   -> google_agent/stage2_live_tutor_orchestrator.py
 *   -> separate Python live_tutor_agents
 *
 * Fixes in this version:
 * - Env-driven timeout policy; no hardcoded 10-minute kill.
 * - Supports request-level payload.timeoutMs / payload.stage2TimeoutMs as total ceiling only.
 * - Provides clearer timeout/runtime/stdout/stderr diagnostics and timeoutPolicy proof metadata.
 * - Exposes per-step timeout env values to Python for context/agent/external/TTS caps.
 * - Keeps strict no-fake behavior.
 *
 * No fake fallback:
 * - If Python script missing, fail.
 * - If Python exits non-zero, fail.
 * - If output is invalid JSON, fail.
 * - If Python returns ok=false, pass it honestly to caller.
 * =============================================================================
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ONE_MINUTE_MS = 60 * 1000;

// Safety ceiling only. Fast response comes from parallel context/caching in later files.
// Keep this high enough that a large, source-grounded lesson is not killed mid-save.
const DEFAULT_STAGE2_TOTAL_TIMEOUT_MS = 30 * ONE_MINUTE_MS;
const DEFAULT_STAGE2_CONTEXT_TIMEOUT_MS = 60 * 1000;
const DEFAULT_STAGE2_AGENT_TIMEOUT_MS = 180 * 1000;
const DEFAULT_STAGE2_EXTERNAL_TIMEOUT_MS = 8 * 1000;
const DEFAULT_STAGE2_TTS_TIMEOUT_MS = 60 * 1000;
const DEFAULT_STAGE2_HEALTH_TIMEOUT_MS = 90 * 1000;

// Backward-compatible name for older imports/debug scripts.
const DEFAULT_STAGE2_TIMEOUT_MS = DEFAULT_STAGE2_TOTAL_TIMEOUT_MS;

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

function cleanText(value, max = 4000) {
  return safeString(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function parsePositiveInt(value, fallback, min = 1000, max = 1000 * 60 * 60) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const n = Math.floor(parsed);
  if (n < min) return fallback;
  return Math.min(n, max);
}

function readFirstEnv(keys, fallback) {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return fallback;
}

function getStage2TimeoutPolicy(overrides = {}) {
  const obj = safeObject(overrides);

  const totalMs = parsePositiveInt(
    obj.totalMs ||
      obj.timeoutMs ||
      obj.stage2TimeoutMs ||
      readFirstEnv(
        [
          "STAGE2_TOTAL_TIMEOUT_MS",
          "GOOGLE_STAGE2_LIVE_TUTOR_TOTAL_TIMEOUT_MS",
          "GOOGLE_STAGE2_LIVE_TUTOR_TIMEOUT_MS",
          "STAGE2_LIVE_TUTOR_TIMEOUT_MS",
          "GOOGLE_LIVE_TUTOR_TIMEOUT_MS",
          "LIVE_TUTOR_AGENT_TIMEOUT_MS",
        ],
        String(DEFAULT_STAGE2_TOTAL_TIMEOUT_MS)
      ),
    DEFAULT_STAGE2_TOTAL_TIMEOUT_MS,
    30 * 1000,
    60 * 60 * 1000
  );

  const contextMs = parsePositiveInt(
    obj.contextMs ||
      obj.stage2ContextTimeoutMs ||
      readFirstEnv(
        [
          "STAGE2_CONTEXT_TIMEOUT_MS",
          "GOOGLE_STAGE2_CONTEXT_TIMEOUT_MS",
          "GOOGLE_STAGE2_LIVE_TUTOR_CONTEXT_TIMEOUT_MS",
        ],
        String(DEFAULT_STAGE2_CONTEXT_TIMEOUT_MS)
      ),
    DEFAULT_STAGE2_CONTEXT_TIMEOUT_MS,
    5 * 1000,
    totalMs
  );

  const agentMs = parsePositiveInt(
    obj.agentMs ||
      obj.stage2AgentTimeoutMs ||
      readFirstEnv(
        [
          "STAGE2_AGENT_TIMEOUT_MS",
          "GOOGLE_STAGE2_AGENT_TIMEOUT_MS",
          "GOOGLE_STAGE2_LIVE_TUTOR_AGENT_TIMEOUT_MS",
        ],
        String(DEFAULT_STAGE2_AGENT_TIMEOUT_MS)
      ),
    DEFAULT_STAGE2_AGENT_TIMEOUT_MS,
    10 * 1000,
    totalMs
  );

  const externalMs = parsePositiveInt(
    obj.externalMs ||
      obj.stage2ExternalTimeoutMs ||
      readFirstEnv(
        [
          "STAGE2_EXTERNAL_TIMEOUT_MS",
          "GOOGLE_STAGE2_EXTERNAL_TIMEOUT_MS",
          "GOOGLE_STAGE2_LIVE_TUTOR_EXTERNAL_TIMEOUT_MS",
        ],
        String(DEFAULT_STAGE2_EXTERNAL_TIMEOUT_MS)
      ),
    DEFAULT_STAGE2_EXTERNAL_TIMEOUT_MS,
    1000,
    Math.min(totalMs, 120 * 1000)
  );

  const ttsMs = parsePositiveInt(
    obj.ttsMs ||
      obj.stage2TtsTimeoutMs ||
      readFirstEnv(
        [
          "STAGE2_TTS_TIMEOUT_MS",
          "GOOGLE_STAGE2_TTS_TIMEOUT_MS",
          "GOOGLE_STAGE2_LIVE_TUTOR_TTS_TIMEOUT_MS",
        ],
        String(DEFAULT_STAGE2_TTS_TIMEOUT_MS)
      ),
    DEFAULT_STAGE2_TTS_TIMEOUT_MS,
    5 * 1000,
    Math.min(totalMs, 10 * 60 * 1000)
  );

  return {
    contextMs,
    agentMs,
    externalMs,
    ttsMs,
    totalMs,
    source: "stage2-timeout-policy-v11",
  };
}

function getProjectRoot() {
  return path.resolve(__dirname, "../../..");
}

function getPythonCommand() {
  return (
    process.env.GOOGLE_STAGE2_LIVE_TUTOR_PYTHON ||
    process.env.GOOGLE_LIVE_TUTOR_PYTHON ||
    process.env.LIVE_TUTOR_PYTHON ||
    process.env.PYTHON ||
    "python3"
  );
}

function getStage2ScriptPath() {
  const configured =
    process.env.GOOGLE_STAGE2_LIVE_TUTOR_AGENT_SCRIPT ||
    process.env.STAGE2_LIVE_TUTOR_AGENT_SCRIPT ||
    process.env.GOOGLE_LIVE_TUTOR_STAGE2_SCRIPT;

  if (configured && String(configured).trim()) {
    return path.resolve(String(configured).trim());
  }

  return path.join(getProjectRoot(), "google_agent", "stage2_live_tutor_orchestrator.py");
}

function getTimeoutMs(override) {
  return getStage2TimeoutPolicy({ timeoutMs: override }).totalMs;
}

function getHealthTimeoutMs(override) {
  if (override !== undefined && override !== null && String(override).trim()) {
    return parsePositiveInt(override, DEFAULT_STAGE2_HEALTH_TIMEOUT_MS, 5000);
  }

  const raw =
    process.env.GOOGLE_STAGE2_LIVE_TUTOR_HEALTH_TIMEOUT_MS ||
    process.env.STAGE2_LIVE_TUTOR_HEALTH_TIMEOUT_MS ||
    process.env.GOOGLE_LIVE_TUTOR_HEALTH_TIMEOUT_MS ||
    String(DEFAULT_STAGE2_HEALTH_TIMEOUT_MS);

  return parsePositiveInt(raw, DEFAULT_STAGE2_HEALTH_TIMEOUT_MS, 5000);
}

function getPayloadTimeoutMs(payload = {}) {
  const obj = safeObject(payload);
  return (
    obj.timeoutMs ||
    obj.stage2TimeoutMs ||
    obj.pythonTimeoutMs ||
    safeObject(obj.metadata).timeoutMs ||
    safeObject(obj.metadata).stage2TimeoutMs ||
    null
  );
}

function getPayloadTimeoutPolicy(payload = {}) {
  const obj = safeObject(payload);
  const meta = safeObject(obj.metadata);
  const timeoutPolicy = safeObject(obj.timeoutPolicy || meta.timeoutPolicy);

  return getStage2TimeoutPolicy({
    ...timeoutPolicy,
    totalMs: getPayloadTimeoutMs(obj) || timeoutPolicy.totalMs,
    contextMs: obj.stage2ContextTimeoutMs || meta.stage2ContextTimeoutMs || timeoutPolicy.contextMs,
    agentMs: obj.stage2AgentTimeoutMs || meta.stage2AgentTimeoutMs || timeoutPolicy.agentMs,
    externalMs: obj.stage2ExternalTimeoutMs || meta.stage2ExternalTimeoutMs || timeoutPolicy.externalMs,
    ttsMs: obj.stage2TtsTimeoutMs || meta.stage2TtsTimeoutMs || timeoutPolicy.ttsMs,
  });
}

function assertScriptExists(scriptPath) {
  if (!fs.existsSync(scriptPath)) {
    const error = new Error(`Stage 2 Python orchestrator file not found: ${scriptPath}`);
    error.code = "STAGE2_PYTHON_SCRIPT_MISSING";
    error.statusCode = 500;
    throw error;
  }
}

function extractLastJsonObject(stdout) {
  const text = safeString(stdout).trim();

  if (!text) {
    throw new Error("Stage 2 Python returned empty stdout.");
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // Continue.
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Continue.
    }
  }

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");

  if (first >= 0 && last > first) {
    const candidate = text.slice(first, last + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Throw below.
    }
  }

  const preview = text.slice(0, 2000);
  const error = new Error(`Could not parse JSON from Stage 2 Python stdout. Preview: ${preview}`);
  error.code = "STAGE2_INVALID_JSON";
  throw error;
}

function buildPythonEnv(extraEnv = {}, timeoutPolicy = getStage2TimeoutPolicy()) {
  const projectRoot = getProjectRoot();
  const existingPythonPath = process.env.PYTHONPATH || "";

  return {
    ...process.env,
    ...extraEnv,

    PYTHONUNBUFFERED: "1",

    PYTHONPATH: existingPythonPath
      ? `${projectRoot}${path.delimiter}${existingPythonPath}`
      : projectRoot,

    LIVE_TUTOR_PROJECT_ROOT: projectRoot,

    // Total safety ceiling used by Python orchestrator.
    GOOGLE_STAGE2_LIVE_TUTOR_TIMEOUT_MS: String(timeoutPolicy.totalMs),
    STAGE2_LIVE_TUTOR_TIMEOUT_MS: String(timeoutPolicy.totalMs),
    STAGE2_TOTAL_TIMEOUT_MS: String(timeoutPolicy.totalMs),

    // Per-phase caps. Python can use these to avoid one slow optional task blocking the full lesson.
    STAGE2_CONTEXT_TIMEOUT_MS: String(timeoutPolicy.contextMs),
    STAGE2_AGENT_TIMEOUT_MS: String(timeoutPolicy.agentMs),
    STAGE2_EXTERNAL_TIMEOUT_MS: String(timeoutPolicy.externalMs),
    STAGE2_TTS_TIMEOUT_MS: String(timeoutPolicy.ttsMs),

    GOOGLE_STAGE2_CONTEXT_TIMEOUT_MS: String(timeoutPolicy.contextMs),
    GOOGLE_STAGE2_AGENT_TIMEOUT_MS: String(timeoutPolicy.agentMs),
    GOOGLE_STAGE2_EXTERNAL_TIMEOUT_MS: String(timeoutPolicy.externalMs),
    GOOGLE_STAGE2_TTS_TIMEOUT_MS: String(timeoutPolicy.ttsMs),
  };
}

function buildTimeoutError({
  timeoutMs,
  finalPayload,
  python,
  scriptPath,
  stdout,
  stderr,
  startedAt,
}) {
  const runtimeMs = Date.now() - startedAt;
  const error = new Error(
    `Stage 2 Python timed out after ${timeoutMs}ms. mode=${finalPayload.mode || "unknown"}`
  );

  error.code = "STAGE2_PYTHON_TIMEOUT";
  error.statusCode = 504;
  error.runtimeMs = runtimeMs;
  error.timeoutMs = timeoutMs;
  error.python = python;
  error.scriptPath = scriptPath;
  error.stdout = stdout.slice(-5000);
  error.stderr = stderr.slice(-5000);
  error.stage2 = {
    ok: false,
    error: error.message,
    stdoutPreview: stdout.slice(-2000),
    stderrPreview: stderr.slice(-2000),
    metadata: {
      fallbackUsed: false,
      bridge: "stage2LiveTutorBridge.service.js",
      timeoutMs,
      runtimeMs,
      mode: finalPayload.mode || "unknown",
      python,
      scriptPath,
    },
  };

  return error;
}

function runPythonJson({
  payload = {},
  mode = "",
  timeoutMs = null,
  timeoutPolicy = null,
  extraEnv = {},
} = {}) {
  return new Promise((resolve, reject) => {
    const python = getPythonCommand();
    const scriptPath = getStage2ScriptPath();

    try {
      assertScriptExists(scriptPath);
    } catch (error) {
      reject(error);
      return;
    }

    const resolvedTimeoutPolicy = timeoutPolicy || getPayloadTimeoutPolicy({ ...safeObject(payload), timeoutMs });
    const resolvedTimeoutMs = resolvedTimeoutPolicy.totalMs;

    const finalPayload = {
      ...safeObject(payload),
      ...(mode ? { mode } : {}),
      timeoutMs: resolvedTimeoutMs,
      stage2TimeoutMs: resolvedTimeoutMs,
      timeoutPolicy: resolvedTimeoutPolicy,
      stage2ContextTimeoutMs: resolvedTimeoutPolicy.contextMs,
      stage2AgentTimeoutMs: resolvedTimeoutPolicy.agentMs,
      stage2ExternalTimeoutMs: resolvedTimeoutPolicy.externalMs,
      stage2TtsTimeoutMs: resolvedTimeoutPolicy.ttsMs,
      metadata: {
        ...safeObject(payload.metadata),
        timeoutMs: resolvedTimeoutMs,
        stage2TimeoutMs: resolvedTimeoutMs,
        timeoutPolicy: resolvedTimeoutPolicy,
        bridgeStartedAt: new Date().toISOString(),
        fallbackUsed: false,
      },
    };

    const args = [scriptPath];
    if (mode) {
      args.push("--mode", mode);
    }

    const child = spawn(python, args, {
      cwd: getProjectRoot(),
      env: buildPythonEnv(extraEnv, resolvedTimeoutPolicy),
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const startedAt = Date.now();

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;

      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }

      reject(
        buildTimeoutError({
          timeoutMs: resolvedTimeoutMs,
          finalPayload,
          python,
          scriptPath,
          stdout,
          stderr,
          startedAt,
        })
      );
    }, resolvedTimeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      error.message = `Failed to start Stage 2 Python process using "${python}": ${error.message}`;
      error.code = error.code || "STAGE2_PYTHON_SPAWN_ERROR";
      error.statusCode = 500;
      error.python = python;
      error.scriptPath = scriptPath;
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const runtimeMs = Date.now() - startedAt;

      let parsed = null;
      try {
        parsed = extractLastJsonObject(stdout);
      } catch (parseError) {
        parseError.statusCode = 502;
        parseError.stdout = stdout.slice(-5000);
        parseError.stderr = stderr.slice(-5000);
        parseError.runtimeMs = runtimeMs;
        parseError.timeoutMs = resolvedTimeoutMs;
        parseError.timeoutPolicy = resolvedTimeoutPolicy;
        parseError.python = python;
        parseError.scriptPath = scriptPath;
        reject(parseError);
        return;
      }

      const result = {
        ...parsed,
        metadata: {
          ...safeObject(parsed.metadata),
          bridge: "stage2LiveTutorBridge.service.js",
          python,
          scriptPath,
          runtimeMs,
          timeoutMs: resolvedTimeoutMs,
          timeoutPolicy: resolvedTimeoutPolicy,
          exitCode: code,
          signal,
          fallbackUsed: false,
        },
      };

      if (code !== 0) {
        const error = new Error(
          result.error || `Stage 2 Python exited with code=${code}, signal=${signal || ""}`
        );
        error.code = "STAGE2_PYTHON_EXIT_NONZERO";
        error.statusCode = 502;
        error.stage2 = result;
        error.stdout = stdout.slice(-5000);
        error.stderr = stderr.slice(-5000);
        error.runtimeMs = runtimeMs;
        error.timeoutMs = resolvedTimeoutMs;
        error.timeoutPolicy = resolvedTimeoutPolicy;
        error.python = python;
        error.scriptPath = scriptPath;
        reject(error);
        return;
      }

      resolve(result);
    });

    try {
      child.stdin.write(JSON.stringify(finalPayload));
      child.stdin.end();
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      error.message = `Failed to write payload to Stage 2 Python stdin: ${error.message}`;
      error.code = "STAGE2_STDIN_WRITE_FAILED";
      error.statusCode = 500;
      error.python = python;
      error.scriptPath = scriptPath;

      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }

      reject(error);
    }
  });
}

async function runStage2PythonAdk(payload = {}) {
  const mode = cleanText(payload.mode || "teach_node_pipeline", 120);
  const timeoutPolicy = getPayloadTimeoutPolicy(payload);

  return runPythonJson({
    payload: {
      ...safeObject(payload),
      mode,
      timeoutMs: timeoutPolicy.totalMs,
      stage2TimeoutMs: timeoutPolicy.totalMs,
      timeoutPolicy,
      stage2ContextTimeoutMs: timeoutPolicy.contextMs,
      stage2AgentTimeoutMs: timeoutPolicy.agentMs,
      stage2ExternalTimeoutMs: timeoutPolicy.externalMs,
      stage2TtsTimeoutMs: timeoutPolicy.ttsMs,
    },
    mode,
    timeoutMs: timeoutPolicy.totalMs,
    timeoutPolicy,
  });
}

async function health() {
  const python = getPythonCommand();
  const scriptPath = getStage2ScriptPath();
  const scriptExists = fs.existsSync(scriptPath);

  if (!scriptExists) {
    return {
      ok: false,
      service: "stage2LiveTutorBridge.service",
      python,
      scriptPath,
      scriptExists: false,
      error: `Stage 2 Python orchestrator file not found: ${scriptPath}`,
      metadata: {
        fallbackUsed: false,
      },
    };
  }

  try {
    const timeoutMs = getHealthTimeoutMs();

    const agent = await runPythonJson({
      payload: {
        mode: "health",
        timeoutMs,
        stage2TimeoutMs: timeoutMs,
      },
      mode: "health",
      timeoutMs,
    });

    return {
      ok: Boolean(agent.ok),
      service: "stage2LiveTutorBridge.service",
      python,
      scriptPath,
      scriptExists: true,
      timeoutMs: getTimeoutMs(),
      timeoutPolicy: getStage2TimeoutPolicy(),
      healthTimeoutMs: timeoutMs,
      agent,
      metadata: {
        fallbackUsed: false,
        realSeparateAgents: Boolean(agent.realSeparateAgents),
      },
    };
  } catch (error) {
    return {
      ok: false,
      service: "stage2LiveTutorBridge.service",
      python,
      scriptPath,
      scriptExists: true,
      timeoutMs: getTimeoutMs(),
      timeoutPolicy: getStage2TimeoutPolicy(),
      healthTimeoutMs: getHealthTimeoutMs(),
      error: error.message,
      stderr: process.env.NODE_ENV === "development" ? error.stderr : undefined,
      stdout: process.env.NODE_ENV === "development" ? error.stdout : undefined,
      stage2: process.env.NODE_ENV === "development" ? error.stage2 : undefined,
      metadata: {
        fallbackUsed: false,
      },
    };
  }
}

module.exports = {
  runStage2PythonAdk,
  health,

  getProjectRoot,
  getPythonCommand,
  getStage2ScriptPath,
  getTimeoutMs,
  getStage2TimeoutPolicy,
  getHealthTimeoutMs,
  extractLastJsonObject,
};