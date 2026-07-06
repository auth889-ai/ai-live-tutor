// LIVE eval: ingest a real PDF (MinerU text + figures + page images) and generate a
// full course lesson from it. Usage:
//   node --env-file=.env eval/ingest-pdf.eval.js /path/to/document.pdf

import { writeFile, mkdir } from 'node:fs/promises';
import { ingestPdf } from '../lib/ingest/pdf/ingest-pdf.js';
import { generateLessonFromSourcePack } from '../lib/generation/lesson/generate-lesson.js';

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: node --env-file=.env eval/ingest-pdf.eval.js /path/to/document.pdf');
  process.exit(1);
}

console.log(`Ingesting ${pdfPath} via MinerU (parse + figures + page images)...`);
const sourcePack = await ingestPdf(pdfPath);
console.log(`SourcePack: ${sourcePack.chunks.length} text chunks, ${sourcePack.assets.length} image assets (${sourcePack.assets.filter((a) => a.kind === 'figure').length} figures, ${sourcePack.assets.filter((a) => a.kind === 'page').length} pages).`);

console.log('Generating course lesson from the PDF...');
const lesson = await generateLessonFromSourcePack(sourcePack);
console.log(`\n=== ${lesson.lessonTitle} — ${lesson.scenes.length} scenes (skipped ${lesson.skippedScenes}) ===`);
for (const scene of lesson.scenes) console.log(`  ${scene.sceneId} [${scene.pedagogicalRole}] ${scene.title}`);

await mkdir('app/dev/lesson', { recursive: true });
await writeFile('app/dev/lesson/generated-lesson.json', JSON.stringify(lesson, null, 2));
console.log('\nSaved -> app/dev/lesson/generated-lesson.json — restart dev server to watch the PDF-based course.');
