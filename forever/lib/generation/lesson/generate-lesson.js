// Full lesson generator: text -> Lesson Planner (task decomposition) -> per-scene
// grounded generation (BullMQ-style parallel) -> a playable multi-scene lesson.
// Planner + scene generator are injectable for deterministic testing.

import { buildTextSourcePack } from '../../source-pack/build/source-pack.js';
import { focusSourcePack } from '../../source-pack/build/focus-source-pack.js';
import { planLesson as planLessonAgent } from '../../orchestration/agents/lesson-planner.js';
import { generateSceneFromSourcePack as generateScene } from '../scene/generate-scene.js';

export async function generateLessonFromText(text, { agents = {} } = {}) {
  const plan = agents.planLesson ?? planLessonAgent;
  const genScene = agents.generateScene ?? generateScene;

  const sourcePack = buildTextSourcePack(text);
  const { lessonTitle, scenes: briefs } = await plan({ sourcePack });

  // Scenes are independent -> generate in parallel (the production BullMQ model).
  const scenes = await Promise.all(
    briefs.map((brief, index) => {
      const focused = focusSourcePack(sourcePack, brief.focusChunkIds);
      return genScene(focused, { sceneId: `sc_${String(index + 1).padStart(2, '0')}` }).then((result) => ({
        title: brief.title,
        ...result,
      }));
    }),
  );

  return {
    lessonTitle,
    sourcePackId: sourcePack.id,
    scenes: scenes.map((scene) => ({
      sceneId: scene.scene.sceneId,
      title: scene.title,
      layout: scene.scene.layout,
      objects: scene.scene.objects,
      voiceLines: scene.scene.voiceLines,
      timeline: scene.timeline,
      durationMs: scene.durationMs,
      reviewRounds: scene.reviewRounds,
    })),
  };
}
