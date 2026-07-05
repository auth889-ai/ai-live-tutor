// The first live slice of the agent society: ANY user text -> SourcePack (real chunks)
// -> Board Director (Qwen) -> Voice Writer (Qwen) -> deterministic timeline compiler
// -> contract-valid playable scene. Two focused model calls, never one mega-prompt.
// No fallbacks: a stage that cannot pass its contract throws.

import { buildTextSourcePack } from '../../source-pack/build/source-pack.js';
import { runGroundingReview } from '../../orchestration/review/grounding-review-loop.js';
import { writeVoice } from '../../orchestration/agents/voice-writer.js';
import { compileProvisionalTimeline } from '../timeline/timeline-compiler.js';

export async function generateSceneFromText(text, { layout = 'teacher_notebook_code' } = {}) {
  const sourcePack = buildTextSourcePack(text);
  const sceneId = `gen_${sourcePack.id.slice(3)}`;

  // Board goes through the society's grounding review cycle (generate -> audit -> revise)
  // before it is allowed to be narrated. Ungrounded boards never reach the student.
  const review = await runGroundingReview({ sceneId, sourcePack, layout });
  const voice = await writeVoice({ objects: review.objects, sourcePack });
  const { timeline, durationMs } = compileProvisionalTimeline({
    sceneId,
    objects: review.objects,
    voiceLines: voice.voiceLines,
  });

  return {
    scene: { sceneId, layout, objects: review.objects, voiceLines: voice.voiceLines },
    timeline,
    durationMs,
    sourcePack,
    transcript: review.transcript,
    reviewRounds: review.rounds,
    usage: {
      review: review.usages,
      voiceWriter: voice.usage,
    },
  };
}
