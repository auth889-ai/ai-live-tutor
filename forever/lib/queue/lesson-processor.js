// The lesson-generation job PROCESSOR — the pure unit of work, backend-agnostic. Both the
// BullMQ worker (production) and the in-process runner (local/tests) call this exact function,
// so behaviour is identical everywhere; only WHERE it runs differs. Idempotent: the lessonId
// is derived from the source, so re-running a job overwrites the same lesson (safe on retry).

import { generateLessonFromText } from '../generation/lesson/generate-lesson.js';
import { saveLesson } from '../storage/lesson-store.js';
import { validateJobInput, makeProgress } from './job-contract.js';

export function lessonIdFor(sourcePackId) {
  return `lesson_${String(sourcePackId).replace(/[^a-z0-9]/gi, '').slice(0, 16)}`;
}

// report(progress): called with normalized progress objects throughout. deps are injectable so
// tests run without the real society or filesystem.
export async function processLessonJob(rawInput, { report = () => {}, deps = {} } = {}) {
  const generate = deps.generate ?? generateLessonFromText;
  const save = deps.save ?? saveLesson;

  const { text, ownerId } = validateJobInput(rawInput);
  report(makeProgress({ phase: 'routing', message: 'Starting' }));

  const lesson = await generate(text, {
    // The society's phase/scene progress is normalized and forwarded upward untouched.
    onProgress: (p) => report(makeProgress(p)),
  });

  const lessonId = lessonIdFor(lesson.sourcePackId);
  report(makeProgress({ phase: 'saving', message: 'Saving lesson' }));
  await save(lessonId, lesson, { ownerId }); // saved under its owner — privacy at the data layer

  const result = { lessonId, lessonTitle: lesson.lessonTitle, scenes: lesson.scenes.length, skippedScenes: lesson.skippedScenes ?? 0 };
  report(makeProgress({ phase: 'done', message: 'Lesson ready', lessonId }));
  return result;
}
