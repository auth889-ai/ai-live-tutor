"use strict";

/**
 * stage2LessonOrchestrator.js
 * Uses NEW stage2_adk_orchestrator.py — all ADK agents connected,
 * preprocessing agents optional (no timeout kills pipeline).
 */

const { spawn }  = require("child_process");
const path       = require("path");
const fs         = require("fs");

const PROJECT_ROOT = path.resolve(__dirname, "../../../..");
const NEW_SCRIPT   = path.join(PROJECT_ROOT, "google_agent", "stage2_adk_orchestrator.py");

function getPython() {
  return (
    process.env.GOOGLE_STAGE2_LIVE_TUTOR_PYTHON ||
    process.env.GOOGLE_LIVE_TUTOR_PYTHON         ||
    process.env.LIVE_TUTOR_PYTHON                ||
    "python3"
  );
}

function safeObj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
function safeArr(v) { return Array.isArray(v) ? v : []; }

const SEGMENT_EVENT_PREFIX = "__LUMINA_SEGMENT_READY__";

async function runAdkOrchestrator(payload, { timeoutMs = 600000, onSegmentReady = null } = {}) {
  if (!fs.existsSync(NEW_SCRIPT)) {
    throw Object.assign(new Error(`ADK orchestrator not found: ${NEW_SCRIPT}`), { code: "SCRIPT_MISSING" });
  }
  return new Promise((resolve, reject) => {
    const child = spawn(getPython(), [NEW_SCRIPT], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    let stdout = "", stderr = "";
    let stderrLineBuffer = "";
    const pendingSegmentCallbacks = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(Object.assign(new Error(`ADK orchestrator timed out after ${timeoutMs}ms`), { code: "ADK_TIMEOUT" }));
    }, timeoutMs);
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => {
      stderrLineBuffer += d.toString();
      const lines = stderrLineBuffer.split(/\r?\n/);
      stderrLineBuffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith(SEGMENT_EVENT_PREFIX)) {
          try {
            const event = JSON.parse(line.slice(SEGMENT_EVENT_PREFIX.length));
            if (typeof onSegmentReady === "function") {
              const pending = Promise.resolve(onSegmentReady(event.segmentIndex, safeObj(event.segment)))
                .catch((err) => console.warn("[stage2LessonOrchestrator] onSegmentReady failed:", err.message));
              pendingSegmentCallbacks.push(pending);
            }
          } catch (err) {
            console.warn("[stage2LessonOrchestrator] bad segment event:", err.message);
          }
        } else {
          stderr += line + "\n";
        }
      }
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      if (stderrLineBuffer && !stderrLineBuffer.startsWith(SEGMENT_EVENT_PREFIX)) {
        stderr += stderrLineBuffer;
      }
      if (pendingSegmentCallbacks.length) {
        await Promise.allSettled(pendingSegmentCallbacks);
      }
      try {
        const result = JSON.parse(stdout.trim());
        if (!result.ok && !result.boardCommands) {
          return reject(Object.assign(new Error(result.error || "ADK pipeline returned no content"), { payload: result }));
        }
        resolve(result);
      } catch {
        reject(Object.assign(new Error(`ADK JSON parse failed (exit ${code}): ${stderr.slice(0, 600)}`), { raw: stdout.slice(0, 400) }));
      }
    });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

async function teachNodeWithAdkPipeline(sourceContext, options = {}) {
  const payload = {
    mode:                "teach_node_pipeline",
    ...sourceContext,
    _emitSegmentEvents:  Boolean(options.onSegmentReady),
    studentLevel:        options.studentLevel || "beginner",
    lessonMode:          options.lessonMode   || "masterclass",
    maxSelectedPageVisionImages: Number(options.maxSelectedPageVisionImages || 1),
    targetMinutes:       Number(options.targetMinutes || 120),
    segmentMinutes:      Number(options.segmentMinutes || 8),
    agentTimeoutsMs: {
      // Preprocessing — helpful but not critical, keep short
      ConceptExtractionAgent:  90000,
      KnowledgeGraphAgent:     90000,
      TeachingStrategyAgent:   90000,
      CoursePlannerAgent:      90000,
      SegmentPlannerAgent:     90000,
      RagRetrievalAgent:       45000,
      SelectedPageVisionAgent: 120000,
      MongoDbMcpToolAgent:     20000,
      // Content generators — these produce the actual lesson, give them time
      DetailedExplanationAgent: 180000,
      AnalogyExampleAgent:     120000,
      AssessmentQuizAgent:     120000,
      VisualPlannerAgent:      180000,
      BoardSceneAgent:         180000,
      DiagramCompilerAgent:     90000,
      BoardCommandAgent:       120000,
      LayoutAgent:              60000,
      HandwritingDrawingAgent:  60000,
      VoiceScriptAgent:        180000,
      SubtitleSyncAgent:        90000,
      ValidatorSafetyAgent:     30000,
    },
    metadata: { fallbackUsed: false, usesAdkPipelineV2: true },
  };
  return runAdkOrchestrator(payload, {
    timeoutMs: options.timeoutMs || 840000,
    onSegmentReady: options.onSegmentReady,
  });
}

module.exports = { teachNodeWithAdkPipeline, runAdkOrchestrator };
