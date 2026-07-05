// A slice of the agent society: SourcePack (real chunks) -> grounding review cycle
// (Board Director + Grounding Auditor + Arbiter) -> Voice Writer -> deterministic
// timeline compiler -> contract-valid playable scene. Focused model calls, never one
// mega-prompt. No fallbacks: a stage that cannot pass its contract throws.

import { buildTextSourcePack } from '../../source-pack/build/source-pack.js';
import { runGroundingReview } from '../../orchestration/review/grounding-review-loop.js';
import { writeVoice } from '../../orchestration/agents/voice-writer.js';
import { compileProvisionalTimeline } from '../timeline/timeline-compiler.js';

export async function generateSceneFromSourcePack(sourcePack, { layout = 'teacher_notebook_code', sceneId } = {}) {
  const id = sceneId ?? `gen_${sourcePack.id.slice(3)}`;

  // Board goes through the society's grounding review cycle (generate -> audit -> revise)
  // before it is allowed to be narrated. Ungrounded boards never reach the student.
  const review = await runGroundingReview({ sceneId: id, sourcePack, layout });
  const voice = await writeVoice({ objects: review.objects, sourcePack });
  const { timeline, durationMs } = compileProvisionalTimeline({
    sceneId: id,
    objects: review.objects,
    voiceLines: voice.voiceLines,
  });

  return {
    scene: { sceneId: id, layout, objects: review.objects, voiceLines: voice.voiceLines },
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
