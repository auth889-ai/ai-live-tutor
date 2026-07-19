// Full lesson generator: text -> Teacher (deep teaching sequence) -> per-scene grounded
// generation (BullMQ-style parallel), each scene told its pedagogical role -> a deep,
// multi-scene lesson like a world-class course. Teacher + scene generator are injectable
// for deterministic testing.

import { isTransient } from '../../qwen/client.js';
import { ROLE_ALIASES } from '../gate/lesson-gate.js';
import { buildTextSourcePack } from '../../source-pack/build/source-pack.js';
import { focusSourcePack } from '../../source-pack/build/focus-source-pack.js';
import { mapWithConcurrency } from '../../util/concurrency.js';
import { designPedagogy as designPedagogyAgent } from '../../orchestration/agents/planning/teacher.js';
import { teacherFor } from '../../orchestration/agents/planning/teachers/registry.js';
import { designCodingLesson as designCodingLessonAgent, isCodingDomain } from '../../orchestration/agents/planning/coding-instructor.js';
import { routeDomain as routeDomainAgent } from '../../orchestration/agents/planning/domain-router.js';
import { generateSceneFromSourcePack as generateScene } from '../scene/generate-scene.js';

export async function generateLessonFromText(text, options = {}) {
  return generateLessonFromSourcePack(buildTextSourcePack(text), options);
}

// Accepts a prebuilt SourcePack (text OR multimodal from a PDF/URL/YouTube) so every input
// type flows through the same society pipeline.
// PROGRESSIVE PLAYBACK hooks (both optional, both awaited):
//   onPlan({ lessonTitle, briefs })  — fires the moment the teaching sequence exists, so the
//     caller can persist a "building" lesson shell the player can already open.
//   onScene(record, index) -> record — fires as EACH scene finishes, with the scene in its
//     FINAL stored shape; whatever it returns replaces the scene (so the caller can voice/
//     publish per scene). A throw here fails that scene only — same loud-drop semantics as
//     a generation failure, never a silent skip.
export async function generateLessonFromSourcePack(sourcePack, { agents = {}, onProgress = () => {}, onPlan = null, onScene = null } = {}) {
  const designPedagogy = agents.designPedagogy ?? designPedagogyAgent;
  const routeDomain = agents.routeDomain ?? routeDomainAgent;
  const genScene = agents.generateScene ?? generateScene;

  // Route the subject so the RIGHT planning specialist architects the lesson: coding/DSA
  // material goes to the Coding Instructor (brute->better->optimal arc with mandatory
  // dry-run traces); everything else to the general Teacher. Same brief contract out.
  onProgress({ phase: 'routing', message: 'Identifying the subject domain' });
  const { domain } = await routeDomain({ sourcePack });
  // ONE SPECIALIST TEACHER PER COURSE (user design): coding -> the Coding Instructor;
  // the 14 course domains -> their own named teacher agent; anything else -> the
  // Universal Teacher. Injected stubs keep overriding everything for tests.
  const planLesson = agents.designPedagogy
    ?? (isCodingDomain(domain)
      ? (agents.designCodingLesson ?? designCodingLessonAgent)
      : ({ sourcePack: pack, domain: d }) => teacherFor(d).designLesson({ sourcePack: pack, domain: d }));
  onProgress({ phase: 'planning', message: isCodingDomain(domain) ? 'The Coding Instructor is architecting the lesson' : 'Designing the teaching sequence' });
  const { lessonTitle, scenes: briefs } = await planLesson({ sourcePack, domain });
  if (onPlan) await onPlan({ lessonTitle, briefs });

  // Scenes are independent -> generate in parallel, but BOUNDED (SCENE_CONCURRENCY, default
  // 3): each scene is several LLM calls, lesson jobs themselves run on parallel workers,
  // and an uncapped fan-out multiplies into provider 429 storms. RESILIENT: one scene
  // failing (timeout, a stubborn grounding audit) must not kill the whole lesson —
  // successful scenes are kept in order; the lesson fails only if none succeed.
  let done = 0;
  const sceneTotal = briefs.length;
  onProgress({ phase: 'generating', message: `Generating ${sceneTotal} scenes`, sceneDone: 0, sceneTotal });
  const results = new Array(briefs.length).fill(null); // per-index: keeps scene ORDER across passes
  const failures = new Array(briefs.length).fill(null);
  const runPass = async (indices, concurrency) => {
    const settled = await mapWithConcurrency(indices, concurrency, (index) => {
      const brief = briefs[index];
      const focused = focusSourcePack(sourcePack, brief.focusChunkIds);
      return genScene(focused, {
        sceneId: `sc_${String(index + 1).padStart(2, '0')}`,
        brief,
        domain,
        // THINKING ALOUD: society steps stream to the student as narrated progress
        // ("Scene 3 · Heat Wave: the Grounding Auditor is reviewing").
        onStep: (msg) => onProgress({
          phase: 'generating',
          message: `Scene ${index + 1} · ${brief.title}: ${msg}`,
          sceneDone: done,
          sceneTotal,
        }),
      })
        .then((result) => {
          // Flatten HERE (not at return time) so onScene sees the scene exactly as it will
          // be stored — and can hand back a voiced/published version of the same shape.
          const record = {
            sceneId: result.scene.sceneId,
            title: brief.title,
            pedagogicalRole: brief.pedagogicalRole,
            layout: result.scene.layout,
            objects: result.scene.objects,
            voiceLines: result.scene.voiceLines,
            timeline: result.timeline,
            durationMs: result.durationMs,
            reviewRounds: result.reviewRounds,
            // The society's debate on THIS scene (proposal -> objections+evidence -> arbiter
            // verdict -> revision). Generated by the review loop, attached here so it survives
            // into storage and the player — the Society Audit Trail a judge can actually SEE,
            // not a live-only stream that vanishes. Track 3's "how agents resolve conflict",
            // made permanent and inspectable. Real data from the real loop (the honesty edge).
            transcript: result.transcript ?? [],
          };
          return onScene ? Promise.resolve(onScene(record, index)).then((r) => r ?? record) : record;
        })
        .finally(() => {
          done = Math.min(done + 1, sceneTotal);
          // Real progress: fires as EACH scene finishes (success or failure), so the bar
          // reflects the society's actual throughput rather than a guess.
          onProgress({ phase: 'generating', message: `Scene ${done}/${sceneTotal} done`, sceneDone: done, sceneTotal });
        });
    });
    settled.forEach((r, k) => {
      const index = indices[k];
      if (r.status === 'fulfilled') {
        results[index] = r.value;
        failures[index] = null;
      } else {
        failures[index] = r.reason;
      }
    });
  };

  await runPass(briefs.map((_, i) => i), Number(process.env.SCENE_CONCURRENCY || 3));

  // SECOND CHANCE: a scene killed by a flaky provider window (timeout/abort/429/5xx) is not a
  // quality rejection — retry those once, at lower concurrency, before accepting the loss.
  // Dry-run scenes whose tracer gave up also qualify: the tracer is stochastic (fresh sampling
  // succeeds where a bad first draft spiraled — measured standalone 16s/0 fixes right after an
  // in-lesson give-up). Real contract violations stay dropped; measured 2026-07-08: one slow
  // DashScope window aborted 7/11 scenes of a lesson, including every dry run.
  const worthRetry = (e) => isTransient(e) || /REAL ExecutionTrace/.test(String(e?.message ?? e));
  const retryable = failures.map((e, i) => (e && worthRetry(e) ? i : null)).filter((i) => i !== null);
  if (retryable.length > 0) {
    done = sceneTotal - retryable.length;
    onProgress({ phase: 'generating', message: `Retrying ${retryable.length} scenes lost to a flaky provider window`, sceneDone: done, sceneTotal });
    await runPass(retryable, Math.min(2, Number(process.env.SCENE_CONCURRENCY || 3)));
  }

  // REQUIRED-BEAT RESCUE: a scene carrying a required beat (worked example, misconception,
  // checkpoint, recap) that died for ANY reason — including an honest grounding-consensus
  // refusal — gets ONE more attempt: scene generation is stochastic (fresh sampling passes
  // where a bad draft spiraled), and a lesson missing a required beat fails the deterministic
  // gate anyway, so the retry is cheaper than shipping a structurally broken lesson.
  const beatOf = (role) => Object.keys(ROLE_ALIASES)
    .find((b) => ROLE_ALIASES[b].some((a) => String(role ?? '').includes(a))) ?? null;
  const coveredBeats = new Set(results.filter(Boolean).map((s) => beatOf(s.pedagogicalRole)).filter(Boolean));
  const beatRescue = failures
    .map((e, i) => {
      const beat = e ? beatOf(briefs[i].pedagogicalRole) : null;
      return beat && !coveredBeats.has(beat) ? i : null;
    })
    .filter((i) => i !== null);
  if (beatRescue.length > 0) {
    done = sceneTotal - beatRescue.length;
    onProgress({ phase: 'generating', message: `Rescuing ${beatRescue.length} required-beat scene(s)`, sceneDone: done, sceneTotal });
    await runPass(beatRescue, 1);
  }

  const scenes = results.filter(Boolean);
  const skippedScenes = failures
    .map((e, i) => (e ? { title: briefs[i].title, pedagogicalRole: briefs[i].pedagogicalRole, reason: String(e?.message ?? e).slice(0, 300) } : null))
    .filter(Boolean);
  // A dropped scene must be LOUD and DIAGNOSABLE — silent skips are how quality rots.
  for (const skip of skippedScenes) console.error(`[lesson] scene DROPPED "${skip.title}" (${skip.pedagogicalRole}): ${skip.reason}`);
  const skipped = skippedScenes.length;
  if (scenes.length === 0) throw new Error(`Every scene failed to generate — refusing to ship an empty lesson. First failure: ${skippedScenes[0]?.reason}`);

  return {
    lessonTitle,
    sourcePackId: sourcePack.id,
    domain, // persists so Ask-the-Tutor answers in the lesson's own specialist register
    skippedScenes: skipped,
    skippedSceneReasons: skippedScenes,
    scenes, // already in final stored shape (flattened per scene, possibly voiced/published by onScene)
  };
}
