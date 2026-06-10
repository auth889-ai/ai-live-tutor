"use strict";

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

function getPythonCmd() {
  return (
    process.env.GOOGLE_STAGE2_LIVE_TUTOR_PYTHON ||
    process.env.GOOGLE_LIVE_TUTOR_PYTHON ||
    process.env.LIVE_TUTOR_PYTHON ||
    "python3"
  );
}

function getScriptPath() {
  const configured =
    process.env.GOOGLE_STAGE2_LIVE_TUTOR_AGENT_SCRIPT ||
    process.env.GOOGLE_LIVE_TUTOR_AGENT_SCRIPT;
  if (configured && configured.trim()) return path.resolve(configured.trim());
  return path.resolve(__dirname, "../../../..", "google_agent", "stage2_live_tutor_orchestrator.py");
}

function getTimeoutMs() {
  return parseInt(
    process.env.GOOGLE_STAGE2_LIVE_TUTOR_TIMEOUT_MS ||
    process.env.STAGE2_LIVE_TUTOR_TIMEOUT_MS ||
    "600000",
    10
  );
}

async function runPythonOrchestrator(payload, { timeoutMs } = {}) {
  const python = getPythonCmd();
  const script = getScriptPath();
  const timeout = timeoutMs || getTimeoutMs();

  if (!fs.existsSync(script)) {
    const err = new Error(`Stage2 Python script not found: ${script}`);
    err.code = "STAGE2_SCRIPT_MISSING";
    throw err;
  }

  return new Promise((resolve, reject) => {
    const child = spawn(python, [script], {
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      cwd: path.resolve(__dirname, "../../../.."),
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      const err = new Error(`Stage2 Python timed out after ${timeout}ms`);
      err.code = "STAGE2_TIMEOUT";
      reject(err);
    }, timeout);

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();

    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });

    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(stdout.trim());
        if (!result.ok) {
          const err = new Error(result.error || "Stage2 Python returned ok:false");
          err.code = "STAGE2_PYTHON_ERROR";
          err.payload = result;
          return reject(err);
        }
        resolve(result);
      } catch {
        const err = new Error(`Stage2 JSON parse failed (exit ${code}): ${stderr.slice(0, 800)}`);
        err.code = "STAGE2_PARSE_ERROR";
        err.raw = stdout.slice(0, 1000);
        reject(err);
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      err.code = err.code || "STAGE2_SPAWN_ERROR";
      reject(err);
    });
  });
}

module.exports = { runPythonOrchestrator, getPythonCmd, getScriptPath };
