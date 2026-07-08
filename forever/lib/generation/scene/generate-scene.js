// A slice of the agent society: SourcePack (real chunks) -> grounding review cycle
// (Board Director + Grounding Auditor + Arbiter) -> [Code Runner for code scenes] ->
// Voice Writer -> deterministic timeline compiler -> contract-valid playable scene.
// Focused model calls, never one mega-prompt. No fallbacks: a stage that cannot pass its
// contract throws. Code scenes get a REAL executed program with real output on the board.

import { buildTextSourcePack } from '../../source-pack/build/source-pack.js';
import { runGroundingReview } from '../../orchestration/review/grounding-review-loop.js';
import { writeVoice } from '../../orchestration/agents/authoring/voice-writer.js';
import { voiceLinesForTrace } from '../voice/algo-voice.js';
import { generateExecutedCode } from '../../orchestration/agents/coding/code-runner.js';
import { traceExecution } from '../../orchestration/agents/coding/execution-tracer.js';
import { compileProvisionalTimeline } from '../timeline/timeline-compiler.js';

const CODE_ROLES = new Set(['worked_example', 'dry_run']);

export async function generateSceneFromSourcePack(
  sourcePack,
  { layout = 'teacher_notebook_code', sceneId, brief = null, agents = {} } = {},
) {
  const id = sceneId ?? `gen_${sourcePack.id.slice(3)}`;
  const runCodeAgent = agents.generateExecutedCode ?? generateExecutedCode;
  const traceAgent = agents.traceExecution ?? traceExecution;
  const reviewAgent = agents.runGroundingReview ?? runGroundingReview;
  const voiceAgent = agents.writeVoice ?? writeVoice;
  const sourceText = sourcePack.chunks.map((chunk) => chunk.text).join('\n');

  // Board goes through the society's grounding review cycle (generate -> audit -> revise)
  // before it is allowed to be narrated. Ungrounded boards never reach the student.
  const review = await reviewAgent({ sceneId: id, sourcePack, layout, brief });
  const objects = [...review.objects];

  // DRY-RUN scenes get the ELITE path: the Execution Tracer runs the real algorithm and
  // compiles an ExecutionTrace, rendered by the clock-driven AlgorithmStage (code + structure +
  // pointers + stack/queue + trace table, all synced). HARD RULE: a dry-run without a real
  // trace never ships — a text-only "trace" is exactly the mediocrity Forever exists to beat.
  // The scene fails honestly (the lesson keeps its other scenes and reports the skip).
  let algorithmObject = null;
  if (brief?.pedagogicalRole === 'dry_run' && layout === 'teacher_notebook_code') {
    const traced = await traceAgent({ directive: brief.directive, sourceText });
    if (!traced?.trace) {
      throw new Error(`Scene ${sceneId}: dry-run could not produce a REAL ExecutionTrace — refusing to ship a text-only trace`);
    }
    algorithmObject = {
      id: 'obj_algo_trace',
      objectType: 'algorithm_dry_run',
      renderHint: 'algorithm',
      region: 'code_panel',
      content: traced.trace,
      sourceRef: { chunkId: sourcePack.chunks[0].id },
    };
    objects.push(algorithmObject);
  }

  // For code-teaching scenes with no elite trace, the Code Runner writes a runnable program,
  // EXECUTES it, and the real output goes on the board. Honest: if it can't run, skip the demo.
  if (!algorithmObject && brief && CODE_ROLES.has(brief.pedagogicalRole) && layout === 'teacher_notebook_code') {
    try {
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
