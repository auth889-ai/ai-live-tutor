// Full lesson generator: text -> Teacher (deep teaching sequence) -> per-scene grounded
// generation (BullMQ-style parallel), each scene told its pedagogical role -> a deep,
// multi-scene lesson like a world-class course. Teacher + scene generator are injectable
// for deterministic testing.

import { buildTextSourcePack } from '../../source-pack/build/source-pack.js';
import { focusSourcePack } from '../../source-pack/build/focus-source-pack.js';
import { designPedagogy as designPedagogyAgent } from '../../orchestration/agents/planning/teacher.js';
import { designCodingLesson as designCodingLessonAgent, isCodingDomain } from '../../orchestration/agents/planning/coding-instructor.js';
import { routeDomain as routeDomainAgent } from '../../orchestration/agents/planning/domain-router.js';
import { generateSceneFromSourcePack as generateScene } from '../scene/generate-scene.js';

export async function generateLessonFromText(text, options = {}) {
  return generateLessonFromSourcePack(buildTextSourcePack(text), options);
}

// Accepts a prebuilt SourcePack (text OR multimodal from a PDF/URL/YouTube) so every input
// type flows through the same society pipeline.
export async function generateLessonFromSourcePack(sourcePack, { agents = {}, onProgress = () => {} } = {}) {
  const designPedagogy = agents.designPedagogy ?? designPedagogyAgent;
  const routeDomain = agents.routeDomain ?? routeDomainAgent;
  const genScene = agents.generateScene ?? generateScene;

  // Route the subject so the RIGHT planning specialist architects the lesson: coding/DSA
  // material goes to the Coding Instructor (brute->better->optimal arc with mandatory
  // dry-run traces); everything else to the general Teacher. Same brief contract out.
  onProgress({ phase: 'routing', message: 'Identifying the subject domain' });
  const { domain } = await routeDomain({ sourcePack });
  const planLesson = agents.designPedagogy
    ?? (isCodingDomain(domain) ? (agents.designCodingLesson ?? designCodingLessonAgent) : designPedagogy);
  onProgress({ phase: 'planning', message: isCodingDomain(domain) ? 'The Coding Instructor is architecting the lesson' : 'Designing the teaching sequence' });
  const { lessonTitle, scenes: briefs } = await planLesson({ sourcePack, domain });

  // Scenes are independent -> generate in parallel (the production BullMQ model). Each
  // carries its teaching brief (role + directive) so it goes deep. RESILIENT: one scene
  // failing (timeout, a stubborn grounding audit) must not kill the whole lesson —
  // successful scenes are kept in order; the lesson fails only if none succeed.
  let done = 0;
  const sceneTotal = briefs.length;
  onProgress({ phase: 'generating', message: `Generating ${sceneTotal} scenes`, sceneDone: 0, sceneTotal });
  const settled = await Promise.allSettled(
    briefs.map((brief, index) => {
      const focused = focusSourcePack(sourcePack, brief.focusChunkIds);
      return genScene(focused, {
        sceneId: `sc_${String(index + 1).padStart(2, '0')}`,
        brief,
      })
        .then((result) => ({ title: brief.title, pedagogicalRole: brief.pedagogicalRole, ...result }))
        .finally(() => {
          done += 1;
          // Real progress: fires as EACH scene finishes (success or failure), so the bar
          // reflects the society's actual throughput rather than a guess.
          onProgress({ phase: 'generating', message: `Scene ${done}/${sceneTotal} done`, sceneDone: done, sceneTotal });
        });
    }),
  );
  const scenes = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const skipped = settled.length - scenes.length;
  if (scenes.length === 0) throw new Error('Every scene failed to generate — refusing to ship an empty lesson');

  return {
    lessonTitle,
    sourcePackId: sourcePack.id,
    skippedScenes: skipped,
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
