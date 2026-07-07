// The lesson-generation job PROCESSOR — the pure unit of work, backend-agnostic. Both the
// BullMQ worker (production) and the in-process runner (local/tests) call this exact function,
// so behaviour is identical everywhere; only WHERE it runs differs. Idempotent: the lessonId
// is derived from the source, so re-running a job overwrites the same lesson (safe on retry).

import { generateLessonFromSourcePack } from '../generation/lesson/generate-lesson.js';
import { buildSourcePackFromInput } from '../source-pack/build/dispatch-source-pack.js';
import { voiceLesson } from '../tts/voice-lesson.js';
import { publishLessonAssets } from '../storage/asset-publisher.js';
import { saveLesson } from '../storage/lesson-store.js';
import { validateJobInput, makeProgress } from './job-contract.js';

export function lessonIdFor(sourcePackId) {
  return `lesson_${String(sourcePackId).replace(/[^a-z0-9]/gi, '').slice(0, 16)}`;
}

// report(progress): called with normalized progress objects throughout. deps are injectable so
// tests run without the real society or filesystem.
export async function processLessonJob(rawInput, { report = () => {}, deps = {} } = {}) {
  const buildPack = deps.buildPack ?? buildSourcePackFromInput;
  const generate = deps.generate ?? generateLessonFromSourcePack;
  const voice = deps.voice ?? voiceLesson;
  const save = deps.save ?? saveLesson;
  const env = deps.env ?? process.env;

  const { input, ownerId } = validateJobInput(rawInput);

  // Resolve the material FIRST (PDF parse / URL fetch / image vision / text chunking) —
  // every input type flows through the same dispatcher into the same society pipeline.
  report(makeProgress({ phase: 'routing', message: `Reading your ${input.type} material` }));
  const sourcePack = await buildPack(input, { env });

  const lesson = await generate(sourcePack, {
    // The society's phase/scene progress is normalized and forwarded upward untouched.
    onProgress: (p) => report(makeProgress(p)),
  });

  // Give the tutor its real voice: synthesize narration + reconcile the timeline to the
  // real audio, per scene. This IS the product (silent lessons don't ship); the only
  // escape hatch is an EXPLICIT env opt-out for offline dev — never a silent fallback.
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

  const lessonId = lessonIdFor(finalLesson.sourcePackId);
  report(makeProgress({ phase: 'saving', message: 'Publishing images and saving' }));
  // Board images reference ingest files under .data/ — copy them somewhere a browser can
  // load (public/assets locally, OSS in production) and rewrite the urls.
  finalLesson = await (deps.publishAssets ?? publishLessonAssets)(finalLesson);
  await save(lessonId, finalLesson, { ownerId }); // saved under its owner — privacy at the data layer

  const result = {
    lessonId,
    lessonTitle: finalLesson.lessonTitle,
    scenes: finalLesson.scenes.length,
    skippedScenes: finalLesson.skippedScenes ?? 0,
    voiced: finalLesson.voiced === true,
  };
  report(makeProgress({ phase: 'done', message: 'Lesson ready', lessonId }));
  return result;
}
