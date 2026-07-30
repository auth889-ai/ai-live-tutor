// THE QUESTION: under the hard rules, does a dynamic lesson GENERATE or FAIL?
// This runs the REAL production path end to end — real Teacher, real Board Director, real
// review loop, real Voice Writer, real teaching contract (including today's board law C).
// Nothing is stubbed. It reports, per scene, whether it shipped or dropped and why.
import { generateLessonFromText } from './lib/generation/lesson/generate-lesson.js';

const SOURCE = `A hash table stores key-value pairs and finds any value in constant time on average.
It works by running the key through a hash function, which turns the key into an array index.
The value is then stored in a bucket at that index, so a lookup jumps straight to the bucket
instead of scanning every entry.

Two different keys can hash to the same index, which is called a collision. The most common
fix is chaining: each bucket holds a small list, and colliding entries are appended to that
list. A lookup then scans only that short list rather than the whole table.

The load factor is the number of stored entries divided by the number of buckets. When the
load factor grows past about 0.75, the lists get long and lookups slow down, so the table
resizes: it allocates a larger bucket array and rehashes every existing key into it.`;

const started = Date.now();
const sceneLog = [];
try {
  const lesson = await generateLessonFromText(SOURCE, {
    onProgress: ({ message }) => { if (message) console.log(`  [progress] ${message}`); },
    onScene: (record) => { sceneLog.push(record?.title ?? '(untitled)'); return record; },
  });

  const mins = ((Date.now() - started) / 1000 / 60).toFixed(1);
  console.log(`\n${'='.repeat(70)}`);
  console.log(`VERDICT: LESSON GENERATED  —  "${lesson.lessonTitle}"   (${mins} min)`);
  console.log('='.repeat(70));
  console.log(`scenes shipped : ${lesson.scenes.length}`);
  console.log(`scenes dropped : ${lesson.skippedScenes}`);
  console.log(`coverage       : ${lesson.coverage.survivedChunks}/${lesson.coverage.plannedChunks} chunks kept, ${lesson.coverage.lostChunks.length} hole(s)`);
  console.log('\n--- what shipped ---');
  for (const s of lesson.scenes) {
    const moves = (s.teachingMoves ?? []).map((m) => m.type).join(', ') || '(none declared)';
    console.log(`  ✓ ${s.title}  [${s.pedagogicalRole}]  ${s.voiceLines?.length ?? 0} lines`);
    console.log(`      contract: ${moves}`);
    const mech = (s.teachingMoves ?? []).find((m) => m.type === 'mechanism');
    if (mech?.cause) console.log(`      board law C -> cause: "${mech.cause}" | effect: "${mech.effect}"`);
  }
  if (lesson.skippedSceneReasons?.length) {
    console.log('\n--- what dropped, and why (the hard rules speaking) ---');
    for (const r of lesson.skippedSceneReasons) console.log(`  ✗ ${r.title} [${r.pedagogicalRole}]: ${r.reason.slice(0, 200)}`);
  }
  console.log(`\nANSWER: hard rules dropped ${lesson.skippedScenes} scene(s) and the lesson still shipped with ${lesson.scenes.length}.`);
} catch (e) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`VERDICT: LESSON FAILED after ${((Date.now() - started) / 1000 / 60).toFixed(1)} min`);
  console.log('='.repeat(70));
  console.log(`reason: ${e.message.slice(0, 600)}`);
  console.log(`scenes that had reached assembly before the failure: ${sceneLog.length}`);
}
