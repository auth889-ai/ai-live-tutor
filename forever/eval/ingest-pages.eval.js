// LIVE eval: vision-first ingest of a folder of PDF page images -> a course lesson that
// DISPLAYS the pages and EXPLAINS their diagrams. Usage:
//   node --env-file=.env eval/ingest-pages.eval.js "/path/to/page-images-dir" "Lesson Title"

import { writeFile, mkdir } from 'node:fs/promises';
import { ingestPageImages } from '../lib/ingest/pages/ingest-page-images.js';
import { generateLessonFromSourcePack } from '../lib/generation/lesson/generate-lesson.js';

const pageDir = process.argv[2];
const title = process.argv[3] || 'Course from PDF';
if (!pageDir) {
  console.error('Usage: node --env-file=.env eval/ingest-pages.eval.js "<page-images-dir>" "Title"');
  process.exit(1);
}

console.log('Vision-reading page images (qwen3.7-plus sees each page)...');
const sourcePack = await ingestPageImages(pageDir, { title, maxPages: 6 });
console.log(`SourcePack: ${sourcePack.chunks.length} chunks, ${sourcePack.assets.length} page images (with vision captions).`);

console.log('Generating course lesson (agents teach FROM the pages)...');
const lesson = await generateLessonFromSourcePack(sourcePack);
console.log(`\n=== ${lesson.lessonTitle} — ${lesson.scenes.length} scenes (skipped ${lesson.skippedScenes}) ===`);
let imageObjs = 0;
for (const s of lesson.scenes) {
  const imgs = s.objects.filter((o) => o.renderHint === 'image').length;
  imageObjs += imgs;
  console.log(`  ${s.sceneId} [${s.pedagogicalRole}] ${s.title}${imgs ? ` (${imgs} image on board)` : ''}`);
}
console.log(`\nImage objects placed on the board: ${imageObjs}`);

await mkdir('app/dev/lesson', { recursive: true });
await writeFile('app/dev/lesson/generated-lesson.json', JSON.stringify(lesson, null, 2));
console.log('Saved -> app/dev/lesson/generated-lesson.json — restart dev server to watch the PDF-image course.');
