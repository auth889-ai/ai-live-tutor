// Full lesson generator: text -> Teacher (deep teaching sequence) -> per-scene grounded
// generation (BullMQ-style parallel), each scene told its pedagogical role -> a deep,
// multi-scene lesson like a world-class course. Teacher + scene generator are injectable
// for deterministic testing.

import { buildTextSourcePack } from '../../source-pack/build/source-pack.js';
import { focusSourcePack } from '../../source-pack/build/focus-source-pack.js';
import { designPedagogy as designPedagogyAgent } from '../../orchestration/agents/teacher.js';
import { generateSceneFromSourcePack as generateScene } from '../scene/generate-scene.js';

export async function generateLessonFromText(text, { agents = {} } = {}) {
  const designPedagogy = agents.designPedagogy ?? designPedagogyAgent;
  const genScene = agents.generateScene ?? generateScene;

  const sourcePack = buildTextSourcePack(text);
  const { lessonTitle, scenes: briefs } = await designPedagogy({ sourcePack });

  // Scenes are independent -> generate in parallel (the production BullMQ model). Each
  // scene carries its teaching brief (role + directive) so it goes deep, not shallow.
  const scenes = await Promise.all(
    briefs.map((brief, index) => {
      const focused = focusSourcePack(sourcePack, brief.focusChunkIds);
      return genScene(focused, {
        sceneId: `sc_${String(index + 1).padStart(2, '0')}`,
        brief,
      }).then((result) => ({ title: brief.title, pedagogicalRole: brief.pedagogicalRole, ...result }));
    }),
  );

  return {
    lessonTitle,
    sourcePackId: sourcePack.id,
    scenes: scenes.map((scene) => ({
      sceneId: scene.scene.sceneId,
      title: scene.title,
      pedagogicalRole: scene.pedagogicalRole,
      layout: scene.scene.layout,
      objects: scene.scene.objects,
      voiceLines: scene.scene.voiceLines,
      timeline: scene.timeline,
      durationMs: scene.durationMs,
      reviewRounds: scene.reviewRounds,
    })),
  };
}
