// LIVE eval (spends tokens): generate a REAL multi-scene lesson and save it so the
// browser player can play it.  Usage:
//   node --env-file=.env eval/generate-lesson.eval.js "<teaching text>"
// Output: app/dev/lesson/generated-lesson.json  (real AI output, cached for playback)

import { mkdirSync, writeFileSync } from 'node:fs';
import { generateLessonFromText } from '../lib/generation/lesson/generate-lesson.js';

const text = process.argv[2];
if (!text || text.trim().length < 60) {
  console.error('Usage: node --env-file=.env eval/generate-lesson.eval.js "<teaching text, 60+ chars>"');
  process.exit(1);
}

const started = Date.now();
console.log('Planning lesson (task decomposition)...');
const lesson = await generateLessonFromText(text);

console.log(`\n=== LESSON: ${lesson.lessonTitle} — ${lesson.scenes.length} scenes ===`);
for (const scene of lesson.scenes) {
  console.log(`  ${scene.sceneId}: "${scene.title}" — ${scene.objects.length} board objects, ${scene.voiceLines.length} voice lines, ${(scene.durationMs / 1000).toFixed(1)}s, ${scene.reviewRounds} review round(s)`);
}

// Report the teaching-visual mix — especially ANIMATED dry-run traces (array/graph), the
// feature that makes a search/traversal feel like a real teacher walking the structure.
const diagramCounts = {};
let animatedTraces = 0;
let traceSteps = 0;
for (const scene of lesson.scenes) {
  for (const object of scene.objects) {
    if (object.renderHint !== 'diagram') continue;
    const t = object.content?.diagramType ?? 'unknown';
    diagramCounts[t] = (diagramCounts[t] ?? 0) + 1;
    if (Array.isArray(object.content?.trace) && object.content.trace.length) {
      animatedTraces += 1;
      traceSteps += object.content.trace.length;
    }
  }
}
console.log('\n=== teaching visuals ===');
console.log('diagram types:', JSON.stringify(diagramCounts));
console.log(`ANIMATED dry-run traces (array/graph): ${animatedTraces} (${traceSteps} total steps)`);

mkdirSync('app/dev/lesson', { recursive: true });
writeFileSync('app/dev/lesson/generated-lesson.json', JSON.stringify(lesson, null, 2));
console.log(`\nSaved -> app/dev/lesson/generated-lesson.json · wall ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log('Watch it: npm run dev, then open http://localhost:3000/dev/lesson');
