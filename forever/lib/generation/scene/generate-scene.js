// The first live slice of the agent society: ANY user text -> SourcePack (real chunks)
// -> Board Director (Qwen) -> Voice Writer (Qwen) -> deterministic timeline compiler
// -> contract-valid playable scene. Two focused model calls, never one mega-prompt.
// No fallbacks: a stage that cannot pass its contract throws.

import { buildTextSourcePack } from '../../source-pack/build/source-pack.js';
import { designBoard } from '../../orchestration/agents/board-director.js';
import { writeVoice } from '../../orchestration/agents/voice-writer.js';
import { compileProvisionalTimeline } from '../timeline/timeline-compiler.js';

export async function generateSceneFromText(text, { layout = 'teacher_notebook_code' } = {}) {
  const sourcePack = buildTextSourcePack(text);
  const sceneId = `gen_${sourcePack.id.slice(3)}`;

  const board = await designBoard({ sourcePack, layout });
  const voice = await writeVoice({ objects: board.objects, sourcePack });
  const { timeline, durationMs } = compileProvisionalTimeline({
    sceneId,
    objects: board.objects,
    voiceLines: voice.voiceLines,
  });

  return {
    scene: { sceneId, layout, objects: board.objects, voiceLines: voice.voiceLines },
    timeline,
    durationMs,
    sourcePack,
    usage: {
      boardDirector: board.usage,
      voiceWriter: voice.usage,
    },
  };
}
