// A slice of the agent society: SourcePack (real chunks) -> grounding review cycle
// (Board Director + Grounding Auditor + Arbiter) -> [Code Runner for code scenes] ->
// Voice Writer -> deterministic timeline compiler -> contract-valid playable scene.
// Focused model calls, never one mega-prompt. No fallbacks: a stage that cannot pass its
// contract throws. Code scenes get a REAL executed program with real output on the board.

import { buildTextSourcePack } from '../../source-pack/build/source-pack.js';
import { runGroundingReview } from '../../orchestration/review/grounding-review-loop.js';
import { writeVoice } from '../../orchestration/agents/authoring/voice-writer.js';
import { warmNarration, directVisualRun } from '../../orchestration/agents/authoring/narration-warmth.js';
import { voiceLinesForTrace } from '../voice/algo-voice.js';
import { generateExecutedCode } from '../../orchestration/agents/coding/code-runner.js';
import { traceExecution } from '../../orchestration/agents/coding/execution-tracer.js';
import { isCodingDomain } from '../../orchestration/agents/planning/coding-instructor.js';
import { compileProvisionalTimeline } from '../timeline/timeline-compiler.js';

const CODE_ROLES = new Set(['worked_example', 'dry_run']);

export async function generateSceneFromSourcePack(
  sourcePack,
  { layout = 'teacher_notebook_code', sceneId, brief = null, domain = 'general', agents = {}, onStep = () => {} } = {},
) {
  const id = sceneId ?? `gen_${sourcePack.id.slice(3)}`;
  const runCodeAgent = agents.generateExecutedCode ?? generateExecutedCode;
  const traceAgent = agents.traceExecution ?? traceExecution;
  const reviewAgent = agents.runGroundingReview ?? runGroundingReview;
  const voiceAgent = agents.writeVoice ?? writeVoice;
  const sourceText = sourcePack.chunks.map((chunk) => chunk.text).join('\n');

  // Board goes through the society's grounding review cycle (generate -> audit -> revise)
  // before it is allowed to be narrated. Ungrounded boards never reach the student.
  const review = await reviewAgent({ sceneId: id, sourcePack, layout, brief, domain, onStep });
  const objects = [...review.objects];

  // DRY-RUN scenes get the ELITE path: the Execution Tracer runs the real algorithm and
  // compiles an ExecutionTrace, rendered by the clock-driven AlgorithmStage (code + structure +
  // pointers + stack/queue + trace table, all synced). HARD RULE: a dry-run without a real
  // trace never ships — a text-only "trace" is exactly the mediocrity Forever exists to beat.
  // The scene fails honestly (the lesson keeps its other scenes and reports the skip).
  // CODING DOMAINS ONLY: for a non-coding subject a "dry_run" brief means an interactive
  // walkthrough on the BOARD, not a sandboxed trace — routing it to the tracer guaranteed a
  // dropped scene (live-caught: an economics "You are the City Council" dry run).
  let algorithmObject = null;
  if (brief?.pedagogicalRole === 'dry_run' && layout === 'teacher_notebook_code' && isCodingDomain(domain)) {
    onStep('The Execution Tracer is running the real algorithm in the sandbox');
    const traced = await traceAgent({ directive: brief.directive, sourceText });
    if (!traced?.trace) {
      throw new Error(`Scene ${sceneId}: dry-run could not produce a REAL ExecutionTrace — refusing to ship a text-only trace`);
    }
    // AI writes the words, the recording guarantees the facts: Qwen retells every step in a
    // beloved teacher's voice; a deterministic validator rejects any step whose rewrite
    // invents a number, and rejected steps keep their template sentence. Never wronger.
    let finalTrace = traced.trace;
    try {
      // Experiment (AI_VISUAL_DIRECTOR=1): the same agent grown into the Visual Director —
      // AI directs the screen per step (voice + beat + spotlight + turning point) in parallel
      // segments; positions still come only from the recording, numbers still validated.
      const warm = agents.warmNarration
        ?? (process.env.AI_VISUAL_DIRECTOR === '1' ? directVisualRun : warmNarration);
      const warmed = await warm({ trace: traced.trace, directive: brief.directive });
      finalTrace = warmed.trace;
    } catch { /* warmth is enrichment — the guaranteed template narration ships regardless */ }
    algorithmObject = {
      id: 'obj_algo_trace',
      objectType: 'algorithm_dry_run',
      renderHint: 'algorithm',
      region: 'code_panel',
      content: finalTrace,
      sourceRef: { chunkId: sourcePack.chunks[0].id },
    };
    // The dry run IS the scene: the Board Director's static diagram/step-list duplicates the
    // real animated trace with hand-authored (driftable) content and buries it under clutter —
    // measured live on the Alien Dictionary lesson, where a static graph + static step list
    // rendered above the correct animated one. Keep text/callouts, drop the imitations.
    const DUPLICATED_BY_TRACE = new Set(['diagram', 'list', 'code']);
    for (let i = objects.length - 1; i >= 0; i -= 1) {
      if (DUPLICATED_BY_TRACE.has(objects[i]?.renderHint)) objects.splice(i, 1);
    }
    objects.push(algorithmObject);
  }

  // For code-teaching scenes with no elite trace, the Code Runner writes a runnable program,
  // EXECUTES it, and the real output goes on the board. Honest: if it can't run, skip the demo.
  // CODING DOMAINS ONLY (universal gate: "wrong primitive chosen") — live-caught: a Supply &
  // Demand worked_example shipped with a Python print() demo bolted onto an economics board.
  if (!algorithmObject && brief && CODE_ROLES.has(brief.pedagogicalRole) && layout === 'teacher_notebook_code' && isCodingDomain(domain)) {
    try {
      onStep('The Code Runner is writing and executing a real demo');
      const demo = await runCodeAgent({ directive: brief.directive, sourceText });
      objects.push({
        id: 'obj_code_demo',
        objectType: 'executed_code_demo',
        renderHint: 'code',
        region: 'code_panel',
        content: demo.code,
        output: demo.output,
        sourceRef: { chunkId: sourcePack.chunks[0].id },
      });
    } catch {
      // No runnable demo this scene — proceed without fabricating output.
    }
  }

  // Narration. The Voice Writer narrates the NON-algorithm board; the algorithm object's lines are
  // generated DIRECTLY from its trace steps (one line per step, tagged with traceStep) so the words
  // are guaranteed to match the animated state — single source of truth, no drift.
  const narratable = objects.filter((o) => o.renderHint !== 'algorithm');
  if (narratable.length) onStep('The Voice Writer is narrating the board');
  const voice = narratable.length ? await voiceAgent({ objects: narratable, sourcePack }) : { voiceLines: [], usage: null };
  const algoLines = algorithmObject ? voiceLinesForTrace(algorithmObject) : [];
  const voiceLines = [...voice.voiceLines, ...algoLines];
  const { timeline, durationMs } = compileProvisionalTimeline({ sceneId: id, objects, voiceLines });

  return {
    scene: { sceneId: id, layout, objects, voiceLines },
    timeline,
    durationMs,
    sourcePack,
    transcript: review.transcript,
    reviewRounds: review.rounds,
    usage: { review: review.usages, voiceWriter: voice.usage },
  };
}

export async function generateSceneFromText(text, options = {}) {
  return generateSceneFromSourcePack(buildTextSourcePack(text), options);
}
