// The generation job PROCESSOR — the pure unit of work, backend-agnostic. Both the BullMQ
// worker (production) and the in-process runner (local/tests) call this exact function.
// THREE job shapes, one pipeline:
//   material (text/pdf/url/image)            -> one lesson
//   material + course:true                    -> Dean outline -> course saved -> FIRST lesson
//   course-lesson {courseId, outlineLessonId} -> one more lesson of an existing course
// Idempotent: ids derive from the source (+ outline lesson id), so retries overwrite
// rather than duplicate.

import { generateLessonFromSourcePack } from '../generation/lesson/generate-lesson.js';
import { buildSourcePackFromInput } from '../source-pack/build/dispatch-source-pack.js';
import { focusSourcePack } from '../source-pack/build/focus-source-pack.js';
import { designCourseOutline } from '../orchestration/agents/planning/dean.js';
import { voiceLesson } from '../tts/voice-lesson.js';
import { publishLessonAssets } from '../storage/asset-publisher.js';
import { saveLesson } from '../storage/lesson-store.js';
import { saveCourse, loadCourse, linkCourseLesson, courseIdFor } from '../storage/course-store.js';
import { validateJobInput, makeProgress } from './job-contract.js';

export function lessonIdFor(sourcePackId) {
  return `lesson_${String(sourcePackId).replace(/[^a-z0-9]/gi, '').slice(0, 24)}`;
}

export async function processLessonJob(rawInput, { report = () => {}, deps = {} } = {}) {
  const { input, ownerId } = validateJobInput(rawInput);

  if (input.type === 'course-lesson') return processCourseLesson(input, ownerId, { report, deps });

  // Resolve the material FIRST (PDF parse / URL fetch / image vision / text chunking).
  report(makeProgress({ phase: 'routing', message: `Reading your ${input.type} material` }));
  const sourcePack = await (deps.buildPack ?? buildSourcePackFromInput)(input, { env: deps.env ?? process.env });

  if (input.course) {
    // FULL COURSE: the Dean architects episodes/lessons, the course is saved with its
    // material embedded, and the first lesson generates immediately; the rest generate
    // on demand from the library (each a cheap, focused job).
    report(makeProgress({ phase: 'planning', message: 'The Dean is architecting your course' }));
    const { outline } = await (deps.designCourseOutline ?? designCourseOutline)({ sourcePack });
    const courseId = courseIdFor(sourcePack.id);
    await (deps.saveCourse ?? saveCourse)(courseId, { outline, sourcePack, lessonLinks: {} }, { ownerId });

    const episode = outline.episodes[0];
    const first = episode.lessons[0];
    const { lessonId } = await produceLesson({
      sourcePack, outlineLesson: first, episode, courseId, ownerId, report, deps,
    });
    await (deps.linkCourseLesson ?? linkCourseLesson)(courseId, first.id, lessonId, { forUser: ownerId });

    const lessonsPlanned = outline.episodes.reduce((n, ep) => n + ep.lessons.length, 0);
    const result = { courseId, courseTitle: outline.title, episodes: outline.episodes.length, lessonsPlanned, firstLessonId: lessonId };
    report(makeProgress({ phase: 'done', message: 'Course ready — first lesson generated', lessonId }));
    return result;
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

  const { lessonId } = await produceLesson({
    sourcePack: course.sourcePack, outlineLesson, episode, courseId: input.courseId, ownerId, report, deps,
  });
  await (deps.linkCourseLesson ?? linkCourseLesson)(input.courseId, outlineLesson.id, lessonId, { forUser: ownerId });
  report(makeProgress({ phase: 'done', message: 'Lesson ready', lessonId }));
  return { courseId: input.courseId, lessonId, lessonTitle: outlineLesson.title, outlineLessonId: outlineLesson.id };
}

// The one lesson pipeline: (focus ->) generate -> voice -> publish images -> save.
async function produceLesson({ sourcePack, outlineLesson = null, episode = null, courseId = null, ownerId, report, deps }) {
  const generate = deps.generate ?? generateLessonFromSourcePack;
  const voice = deps.voice ?? voiceLesson;
  const env = deps.env ?? process.env;

  // A course lesson teaches ITS slice of the source, framed by the Dean's objective.
  const pack = outlineLesson?.focusChunkIds?.length ? focusSourcePack(sourcePack, outlineLesson.focusChunkIds) : sourcePack;
  const lesson = await generate(pack, { onProgress: (p) => report(makeProgress(p)) });

  let finalLesson = lesson;
  if (env.DISABLE_TTS === '1') {
    report(makeProgress({ phase: 'voicing', message: 'Voice disabled (DISABLE_TTS=1) — shipping a silent lesson' }));
  } else {
    const sceneTotal = lesson.scenes.length;
    report(makeProgress({ phase: 'voicing', message: 'Synthesizing the tutor voice', sceneDone: 0, sceneTotal }));
    finalLesson = await voice(lesson, {
      onProgress: ({ sceneDone }) =>
        report(makeProgress({ phase: 'voicing', message: `Voiced scene ${sceneDone}/${sceneTotal}`, sceneDone, sceneTotal })),
    });
  }

  report(makeProgress({ phase: 'saving', message: 'Publishing images and saving' }));
  finalLesson = await (deps.publishAssets ?? publishLessonAssets)(finalLesson);

  if (outlineLesson) {
    finalLesson = {
      ...finalLesson,
      lessonTitle: outlineLesson.title, // the Dean's student-facing title wins in a course
      courseRef: { courseId, episodeId: episode?.id ?? null, outlineLessonId: outlineLesson.id, episodeTitle: episode?.title ?? null },
    };
  }

  const lessonId = lessonIdFor(outlineLesson ? `${sourcePack.id}_${outlineLesson.id}` : finalLesson.sourcePackId);
  await (deps.save ?? saveLesson)(lessonId, finalLesson, { ownerId });
  return { lessonId, lesson: finalLesson };
}
