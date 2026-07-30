// The generation job PROCESSOR — the pure unit of work, backend-agnostic. Both the BullMQ
// worker (production) and the in-process runner (local/tests) call this exact function.
// THREE job shapes, one pipeline:
//   material (text/pdf/url/image)            -> one lesson
//   material + course:true                    -> Dean outline -> course saved -> FIRST lesson
//   course-lesson {courseId, outlineLessonId} -> one more lesson of an existing course
// Idempotent: ids derive from the source (+ outline lesson id), so retries overwrite
// rather than duplicate.

import { generateLessonFromSourcePack } from '../generation/lesson/generate-lesson.js';
import { repairLessonPayload } from '../generation/gate/lesson-repair.js';
import { generateVariations, calcSpecFromLesson } from '../generation/practice/variation-engine.js';
import { deckFromQuestions } from '../retention/sm2.js';
import { isCodingDomain } from '../orchestration/agents/planning/coding-instructor.js';
import { buildSourcePackFromInput } from '../source-pack/build/dispatch-source-pack.js';
import { focusSourcePack } from '../source-pack/build/focus-source-pack.js';
import { designCourseOutline } from '../orchestration/agents/planning/dean.js';
import { voiceLesson, voiceScene, lessonAudioKey } from '../tts/voice-lesson.js';
import { publishLessonAssets, publishSceneAssets, lessonAssetKey } from '../storage/asset-publisher.js';
import { saveLesson } from '../storage/lesson-store.js';
import { saveCourse, loadCourse, linkCourseLesson, courseIdFor } from '../storage/course-store.js';
import { findTopicImage } from '../media/topic-image.js';
import { validateJobInput, makeProgress } from './job-contract.js';
import { createProgressiveLessonWriter } from './progressive-lesson.js';

export function lessonIdFor(sourcePackId) {
  return `lesson_${String(sourcePackId).replace(/[^a-z0-9]/gi, '').slice(0, 24)}`;
}

// CODING GATE (audit: "coding lessons lack a final quality gate"): the repair gate below is
// non-coding-only BY DESIGN (its evidence comes from executing the lesson's numbers), which
// left coding lessons with NO final verdict at all. This scan is the deterministic
// equivalent for what makes a coding lesson honest: the dry run must carry a REAL executed
// trace. Pure and exported so it is unit-testable without the whole processor.
//   (a) a 'dry_run' scene without an algorithm object holding non-empty trace steps is a
//       text-only walkthrough wearing a dry run's name;
//   (b) an algorithm object anywhere whose steps are empty is a dead animation — the player
//       would show a frozen board while the voice narrates motion.
export function codingGateViolations(lesson) {
  const violations = [];
  const stepsOf = (object) => {
    const content = object?.content ?? {};
    // Canonical ExecutionTrace carries steps[]; older/diagram-shaped traces carry trace[].
    return Array.isArray(content.steps) ? content.steps : Array.isArray(content.trace) ? content.trace : null;
  };
  for (const scene of lesson?.scenes ?? []) {
    const algos = (scene.objects ?? []).filter((o) => o?.renderHint === 'algorithm');
    if (scene.pedagogicalRole === 'dry_run' && !algos.some((o) => (stepsOf(o)?.length ?? 0) > 0)) {
      violations.push({ rule: 'coding-dry-run-trace', sceneId: scene.sceneId, reason: 'dry_run scene has no algorithm object with executed trace steps' });
    }
    for (const object of algos) {
      const steps = stepsOf(object);
      if (!steps || steps.length === 0) {
        violations.push({ rule: 'coding-dry-run-trace', sceneId: scene.sceneId, objectId: object.id, reason: 'algorithm object carries an empty trace — a dead animation' });
      }
    }
  }
  return violations;
}

export async function processLessonJob(rawInput, { report = () => {}, deps = {} } = {}) {
  const { input, ownerId } = validateJobInput(rawInput);

  if (input.type === 'course-lesson') return processCourseLesson(input, ownerId, { report, deps });

  // Resolve the material FIRST (PDF parse / URL fetch / image vision / text chunking).
  report(makeProgress({ phase: 'routing', message: `Reading your ${input.type} material` }));
  const sourcePack = await (deps.buildPack ?? buildSourcePackFromInput)(input, { env: deps.env ?? process.env });

  if (input.course) {
    // FULL COURSE = FAN-OUT (production design): this job only ingests + architects. The
    // Dean plans the outline, the course is saved with its material embedded, and EVERY
    // lesson is enqueued as its own job — workers process them in PARALLEL and the
    // syllabus page follows each job's live progress. No lesson generates inline here.
    report(makeProgress({ phase: 'planning', message: 'The Dean is architecting your course' }));
    const { outline } = await (deps.designCourseOutline ?? designCourseOutline)({ sourcePack });
    const courseId = courseIdFor(sourcePack.id);
    // Save FIRST so the course exists before any fanned-out lesson job starts.
    await (deps.saveCourse ?? saveCourse)(courseId, { outline, sourcePack, lessonLinks: {}, lessonJobs: {} }, { ownerId });

    const enqueue = deps.enqueue ?? (await import('./lesson-queue.js')).enqueueLesson;
    const lessonJobs = {};
    let first = true;
    for (const episode of outline.episodes) {
      for (const lesson of episode.lessons) {
        const { jobId } = await enqueue(
          { input: { type: 'course-lesson', courseId, outlineLessonId: lesson.id }, ownerId },
          // TIME-TO-FIRST-PLAYABLE: lesson 1.1 jumps the batch (priority 3) so the student
          // has something to WATCH within minutes; the rest fill in behind (priority 10).
          { priority: first ? 3 : 10, jobId: `cl-${courseId}-${lesson.id}` },
        );
        lessonJobs[lesson.id] = { jobId, queuedAt: new Date().toISOString() };
        first = false;
      }
    }
    // Topic cover art (Pexels/Pixabay, free-license) — enrichment, never a failure point.
    const coverImage = await (deps.findTopicImage ?? findTopicImage)(outline.title).catch(() => null);
    await (deps.saveCourse ?? saveCourse)(courseId, { outline, sourcePack, lessonLinks: {}, lessonJobs, coverImage }, { ownerId });

    const lessonsPlanned = outline.episodes.reduce((n, ep) => n + ep.lessons.length, 0);
    report(makeProgress({ phase: 'done', message: `Course architected — ${lessonsPlanned} lessons generating in parallel` }));
    return { courseId, courseTitle: outline.title, episodes: outline.episodes.length, lessonsPlanned, enqueued: lessonsPlanned };
  }

  const { lessonId, lesson } = await produceLesson({ sourcePack, ownerId, report, deps });
  const result = {
    lessonId,
    lessonTitle: lesson.lessonTitle,
    scenes: lesson.scenes.length,
    skippedScenes: lesson.skippedScenes ?? 0,
    voiced: lesson.voiced === true,
  };
  report(makeProgress({ phase: 'done', message: 'Lesson ready', lessonId }));
  return result;
}

// One more lesson of an EXISTING course, on demand. Owner-scoped end to end.
async function processCourseLesson(input, ownerId, { report, deps }) {
  const course = await (deps.loadCourse ?? loadCourse)(input.courseId, { forUser: ownerId });
  if (!course) throw new Error(`Course ${input.courseId} not found`);
  let episode = null;
  let outlineLesson = null;
  for (const ep of course.outline.episodes) {
    const hit = ep.lessons.find((lesson) => lesson.id === input.outlineLessonId);
    if (hit) { episode = ep; outlineLesson = hit; break; }
  }
  if (!outlineLesson) throw new Error(`Outline lesson ${input.outlineLessonId} not in course ${input.courseId}`);

  const link = (lessonId) => (deps.linkCourseLesson ?? linkCourseLesson)(input.courseId, outlineLesson.id, lessonId, { forUser: ownerId });
  const { lessonId } = await produceLesson({
    sourcePack: course.sourcePack, outlineLesson, episode, courseId: input.courseId, ownerId, report, deps,
    // PROGRESSIVE: the syllabus row flips to ▶ Play the moment the FIRST scene is watchable,
    // not when the whole lesson lands. linkCourseLesson is an idempotent $set — the final
    // link below simply re-affirms it.
    onFirstScene: (id) => link(id).catch((error) => console.error(`[lesson] early course link failed: ${error?.message}`)),
  });
  await link(lessonId);
  report(makeProgress({ phase: 'done', message: 'Lesson ready', lessonId }));
  return { courseId: input.courseId, lessonId, lessonTitle: outlineLesson.title, outlineLessonId: outlineLesson.id };
}

// The one lesson pipeline, PROGRESSIVE (the Sankofa lesson: never make the student wait for
// the whole thing): plan -> save a "building" shell -> each scene, as it finishes, is voiced
// + published + appended to the stored lesson so the player can already play the ready
// prefix -> final save flips status to "ready". Injected stubs that ignore the onPlan/
// onScene hooks fall back to exactly the old batch behavior (voice/publish after generate).
async function produceLesson({ sourcePack, outlineLesson = null, episode = null, courseId = null, ownerId, report, deps, onFirstScene = null }) {
  const generate = deps.generate ?? generateLessonFromSourcePack;
  const voice = deps.voice ?? voiceLesson;
  const save = deps.save ?? saveLesson;
  const env = deps.env ?? process.env;

  // A course lesson teaches ITS slice of the source, framed by the Dean's objective.
  const pack = outlineLesson?.focusChunkIds?.length ? focusSourcePack(sourcePack, outlineLesson.focusChunkIds) : sourcePack;
  const lessonId = lessonIdFor(outlineLesson ? `${sourcePack.id}_${outlineLesson.id}` : pack.id);
  const writer = createProgressiveLessonWriter({ lessonId, sourcePackId: pack.id, ownerId, save, outlineLesson, episode, courseId });

  const lesson = await generate(pack, {
    onProgress: (p) => report(makeProgress({ ...p, lessonId, scenesReady: writer.playableCount() })),
    onPlan: (plan) => writer.recordPlan(plan),
    onScene: async (record, index) => {
      // Voice + publish THIS scene now, so what lands in the store is immediately watchable.
      let scene = record;
      if (env.DISABLE_TTS !== '1' && scene.voiceLines?.length) {
        // AUDIO IS AN ENHANCEMENT, NOT THE TEACHING. A scene whose board was designed,
        // survived the critics and the Arbiter, and whose narration passed the teaching
        // contract is GOOD TEACHING — losing it because a speech vendor is down destroys
        // work the student could have read perfectly well. Measured 2026-07-30: every
        // ElevenLabs key returns 401 and the Qwen voice model answers "Model not exist",
        // so a full 12-scene lesson was thrown away with "Every scene failed to generate"
        // whose FIRST failure was TTS — not one word of it a teaching problem.
        // The scene now ships unvoiced (the player already renders text voice lines; the
        // manifest's `voiced` flag records the truth), and the failure is logged LOUDLY so
        // a dead vendor can never masquerade as a quality problem again.
        try {
          scene = await voiceScene(scene, { lessonKey: lessonAudioKey(pack.id) });
        } catch (error) {
          console.error(`[lesson] scene "${scene.title ?? scene.sceneId}" could not be voiced (${String(error?.message ?? error).slice(0, 160)}) — shipping it as TEXT rather than losing the teaching`);
        }
      }
      scene = await publishSceneAssets(scene, { lessonKey: lessonAssetKey(pack.id) });
      const { before, after } = await writer.recordScene(index, scene);
      if (before === 0 && after > 0 && onFirstScene) await onFirstScene(lessonId);
      report(makeProgress({
        phase: 'generating',
        message: after > 0 ? `${after} scene${after === 1 ? '' : 's'} ready to watch` : 'First scene almost ready',
        sceneDone: writer.readyCount(),
        sceneTotal: writer.plannedCount(),
        lessonId,
        scenesReady: after,
      }));
      return scene;
    },
  });

  // Every late-phase report keeps lessonId + scenesReady: the browser's "Watch now" link
  // must never blink out while the tail of the build (voicing/saving) runs.
  const watchable = () => ({ lessonId, scenesReady: writer.playableCount() });
  let finalLesson = lesson;
  if (env.DISABLE_TTS === '1') {
    report(makeProgress({ phase: 'voicing', message: 'Voice disabled (DISABLE_TTS=1) — shipping a silent lesson', ...watchable() }));
  } else {
    const sceneTotal = lesson.scenes.length;
    report(makeProgress({ phase: 'voicing', message: 'Synthesizing the tutor voice', sceneDone: 0, sceneTotal, ...watchable() }));
    // SAME LAW AS THE PER-SCENE PASS ABOVE, and the reason that fix looked incomplete: a
    // fully built lesson — every scene generated, critiqued, narrated and SAVED — still
    // died here, at the very last step, because this second voicing call was unguarded.
    // Measured 2026-07-30/31: `job 7 failed: TTS failed after 3 attempts: HTTP 404 Model
    // not exist` AFTER its scenes were already in MongoDB, and BullMQ then retried the
    // whole 30-minute build from scratch. A dead speech vendor must never discard finished
    // teaching, and must never trigger a full rebuild.
    try {
      finalLesson = await voice(lesson, {
        onProgress: ({ sceneDone }) =>
          report(makeProgress({ phase: 'voicing', message: `Voiced scene ${sceneDone}/${sceneTotal}`, sceneDone, sceneTotal, ...watchable() })),
      });
    } catch (error) {
      console.error(`[lesson] lesson-level voicing failed (${String(error?.message ?? error).slice(0, 160)}) — publishing the lesson as TEXT rather than discarding a finished build`);
      report(makeProgress({ phase: 'voicing', message: 'Voice unavailable — publishing the lesson as text', sceneDone: 0, sceneTotal, ...watchable() }));
      finalLesson = { ...lesson, voiced: false };
    }
  }

  report(makeProgress({ phase: 'saving', message: 'Publishing images and saving', ...watchable() }));
  finalLesson = await (deps.publishAssets ?? publishLessonAssets)(finalLesson);

  if (outlineLesson) {
    finalLesson = {
      ...finalLesson,
      lessonTitle: outlineLesson.title, // the Dean's student-facing title wins in a course
      courseRef: { courseId, episodeId: episode?.id ?? null, outlineLessonId: outlineLesson.id, episodeTitle: episode?.title ?? null },
    };
  }

  const coverImage = await (deps.findTopicImage ?? findTopicImage)(finalLesson.lessonTitle).catch(() => null);
  if (coverImage) finalLesson = { ...finalLesson, coverImage };

  // GATE AT THE DOOR (Universal Course Build step 1): every non-coding lesson is verified
  // and SELF-REPAIRED before the canonical save — unsourced numbers get executed evidence,
  // a missing misconception beat gets its scene, and the verdict is stored on the lesson so
  // course tooling can rank quality without re-gating. Fails OPEN (a broken repair never
  // blocks shipping the lesson the society built). LESSON_GATE=0 disables.
  if (env.LESSON_GATE !== '0' && finalLesson.domain && !isCodingDomain(finalLesson.domain)) {
    report(makeProgress({ phase: 'saving', message: 'Gate: verifying numbers, beats and references', ...watchable() }));
    try {
      const sourceText = (pack.chunks ?? []).map((c) => c.text ?? '').join(' ');
      // repair to CONVERGENCE, not one round: measured live (ML course lesson 1), one round
      // healed 25 -> 8 and a second round was never given; the script loop converges in 2-6.
      // Stop when clean, when a round stops improving, or after 4 rounds (cost ceiling).
      let firstCount = null;
      let verdict = null;
      for (let round = 0; round < 4; round += 1) {
        const { before, after } = await (deps.repair ?? repairLessonPayload)(finalLesson, {
          sourceText, domain: finalLesson.domain, lessonTitle: finalLesson.lessonTitle, env,
        });
        firstCount = firstCount ?? before.violations.length;
        verdict = after;
        if (after.ok || after.violations.length >= before.violations.length) break;
        report(makeProgress({ phase: 'saving', message: `Gate: ${after.violations.length} issue${after.violations.length === 1 ? '' : 's'} left after repair round ${round + 1}`, ...watchable() }));
      }
      finalLesson = {
        ...finalLesson,
        gate: { ok: verdict.ok, violations: verdict.violations.length, repaired: firstCount - verdict.violations.length, rules: [...new Set(verdict.violations.map((v) => v.rule))] },
      };
    } catch (e) {
      // Infra failure ≠ quality failure: record that the gate never ran (distinguishable
      // from gate.ok=false in the manifest and the kernel), ship the lesson.
      console.error(`[gate] gate could not run (infra): ${String(e?.message ?? e).slice(0, 160)}`);
      finalLesson = { ...finalLesson, gate: { ok: null, unavailable: true } };
    }
  }

  // PRACTICE PACK (zero tokens, deterministic): when the lesson carries an executed calc
  // spec, every student gets leveled variations with engine-computed answers, graduated
  // hints, and an SM-2 review deck — attached at save time, regenerated identically on
  // rebuild. Fails open: a lesson without an executed spec simply has no pack.
  try {
    const calcSpec = calcSpecFromLesson(finalLesson);
    if (calcSpec) {
      const variants = generateVariations(calcSpec);
      const questions = variants.filter((v) => v.level <= 2).flatMap((v) => v.questions);
      if (questions.length) {
        finalLesson = { ...finalLesson, practice: { variants, deck: deckFromQuestions(questions) } };
      }
    }
  } catch (e) {
    console.error(`[practice] pack generation failed open: ${String(e?.message ?? e).slice(0, 120)}`);
  }

  // CODING GATE (audit: "coding lessons lack a final quality gate"): deterministic, zero
  // tokens — a coding lesson's correctness layer is execution, so its gate checks that the
  // executed evidence actually SHIPPED (dry runs carry real trace steps, no dead
  // animations). Runs under the same LESSON_GATE switch as the repair gate; the verdict
  // lands in the same finalLesson.gate shape the fail-closed logic below already reads.
  if (env.LESSON_GATE !== '0' && finalLesson.domain && isCodingDomain(finalLesson.domain)) {
    const codingViolations = codingGateViolations(finalLesson);
    // Merge, never clobber: coding lessons carry no repair-gate verdict today, but if one
    // ever appears, both gates' findings must survive side by side.
    const prior = finalLesson.gate ?? { ok: true, violations: 0, rules: [] };
    finalLesson = {
      ...finalLesson,
      gate: {
        ...prior,
        ok: prior.ok === false ? false : codingViolations.length === 0,
        violations: (prior.violations ?? 0) + codingViolations.length,
        rules: [...new Set([...(prior.rules ?? []), ...codingViolations.map((v) => v.rule)])],
      },
    };
    if (codingViolations.length > 0) {
      report(makeProgress({ phase: 'saving', message: `Gate: ${codingViolations.length} coding dry-run issue${codingViolations.length === 1 ? '' : 's'} (${codingViolations.map((v) => v.sceneId).join(', ')})`, ...watchable() }));
    }
  }

  // Wait out any in-flight partial write, then the FINAL save replaces the building shell
  // with the canonical lesson. FAIL-CLOSED BY DEFAULT (external audit 2026-07-26 caught the
  // gate failing open: gate.ok=false lessons shipped as 'ready' with only a log line):
  // a lesson whose gate RAN and still has violations after repair-to-convergence is saved
  // as 'needs_review' — visible, playable via direct link, but honestly labeled — never
  // silently 'ready'. A gate that could not run (infra error) is NOT a failed gate; it
  // ships with gate:'unavailable' recorded. LESSON_GATE_STRICT=0 restores fail-open for
  // demo resilience under provider outages (documented tradeoff, off by default).
  await writer.flush();
  // COVERAGE HOLES count as gate failures (audit #4): a lesson whose plan promised figures/
  // chunks that its surviving scenes no longer deliver is incomplete, not ready.
  const holes = (finalLesson.coverage?.lostFigures?.length ?? 0) + (finalLesson.coverage?.lostChunks?.length ?? 0);
  // H4 (universal fail-closed): a gate that RAN and failed, a gate that COULD NOT RUN, or
  // coverage holes — none of these may silently become 'ready' under strict (default).
  // Coding lessons' correctness gate is the execution layer itself (traces are run, not
  // cited), so the repair gate stays non-coding by design — but infra honesty is universal.
  const gateFailed = ((finalLesson.gate && (finalLesson.gate.ok === false || finalLesson.gate.unavailable === true)) || holes > 0) && env.LESSON_GATE_STRICT !== '0';
  finalLesson = { ...finalLesson, status: gateFailed ? 'needs_review' : 'ready' };
  if (gateFailed) {
    report(makeProgress({ phase: 'saving', message: `Gate: ${finalLesson.gate?.ok === false ? `${finalLesson.gate.violations} unresolved issue(s)` : ''}${finalLesson.gate?.ok === false && holes ? ' + ' : ''}${holes ? `${holes} coverage hole(s) from dropped scenes` : ''} — saved as needs_review, not published as ready`, ...watchable() }));
  }
  await save(lessonId, finalLesson, { ownerId });
  return { lessonId, lesson: finalLesson };
}
