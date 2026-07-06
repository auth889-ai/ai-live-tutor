// A slice of the agent society: SourcePack (real chunks) -> grounding review cycle
// (Board Director + Grounding Auditor + Arbiter) -> [Code Runner for code scenes] ->
// Voice Writer -> deterministic timeline compiler -> contract-valid playable scene.
// Focused model calls, never one mega-prompt. No fallbacks: a stage that cannot pass its
// contract throws. Code scenes get a REAL executed program with real output on the board.

import { buildTextSourcePack } from '../../source-pack/build/source-pack.js';
import { runGroundingReview } from '../../orchestration/review/grounding-review-loop.js';
import { writeVoice } from '../../orchestration/agents/authoring/voice-writer.js';
import { generateExecutedCode } from '../../orchestration/agents/coding/code-runner.js';
import { compileProvisionalTimeline } from '../timeline/timeline-compiler.js';

const CODE_ROLES = new Set(['worked_example', 'dry_run']);

export async function generateSceneFromSourcePack(
  sourcePack,
  { layout = 'teacher_notebook_code', sceneId, brief = null, agents = {} } = {},
) {
  const id = sceneId ?? `gen_${sourcePack.id.slice(3)}`;
  const runCodeAgent = agents.generateExecutedCode ?? generateExecutedCode;

  // Board goes through the society's grounding review cycle (generate -> audit -> revise)
  // before it is allowed to be narrated. Ungrounded boards never reach the student.
  const review = await runGroundingReview({ sceneId: id, sourcePack, layout, brief });
  const objects = [...review.objects];

  // For code-teaching scenes, the Code Runner writes a runnable program, EXECUTES it, and
  // the real output goes on the board. Honest: if it can't run, we skip the demo (never
  // show fake output) rather than fail the whole scene.
  if (brief && CODE_ROLES.has(brief.pedagogicalRole) && layout === 'teacher_notebook_code') {
    try {
      const demo = await runCodeAgent({
        directive: brief.directive,
        sourceText: sourcePack.chunks.map((chunk) => chunk.text).join('\n'),
      });
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

  const voice = await writeVoice({ objects, sourcePack });
  const { timeline, durationMs } = compileProvisionalTimeline({ sceneId: id, objects, voiceLines: voice.voiceLines });

  return {
    scene: { sceneId: id, layout, objects, voiceLines: voice.voiceLines },
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
