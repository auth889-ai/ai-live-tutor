// LIVE eval: voice the already-generated lesson with ElevenLabs, save audio to public/,
// reconcile timelines, and overwrite the dev lesson so the player speaks.
//   node --env-file=.env eval/voice-lesson.eval.js

import { readFile, writeFile } from 'node:fs/promises';
import { voiceLesson } from '../lib/tts/voice-lesson.js';

const lesson = JSON.parse(await readFile('app/dev/lesson/generated-lesson.json', 'utf8'));
console.log(`Voicing "${lesson.lessonTitle}" — ${lesson.scenes.length} scenes...`);

const voiced = await voiceLesson(lesson);
await writeFile('app/dev/lesson/generated-lesson.json', JSON.stringify(voiced, null, 2));

let lines = 0;
for (const scene of voiced.scenes) {
  lines += scene.voiceLines.length;
  console.log(`  ${scene.sceneId}: ${(scene.durationMs / 1000).toFixed(1)}s audio -> ${scene.audioUrl}`);
}
console.log(`Done. ${lines} narration clips synthesized. Restart dev server and play /dev/lesson to HEAR it.`);
