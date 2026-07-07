// Publish a lesson's image assets: board "image" objects reference files the ingest wrote
// under .data/ (MinerU figures, page renders, user uploads) — paths a browser can never
// load. This walks the finished lesson, copies each referenced file into
// public/assets/<lessonId>/ and rewrites the object's url to the served path. Production
// swaps the copy for an OSS upload behind this same function. Honest failure: an image
// object whose file is missing is a broken pipeline, not something to ship silently.

import { access, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export async function publishLessonAssets(lesson, { publicDir = 'public', urlBase = '/assets' } = {}) {
  const lessonId = lesson.sourcePackId.replace(/[^a-z0-9]/gi, '').slice(0, 16);
  const outDir = path.join(publicDir, 'assets', lessonId);
  let published = 0;

  const scenes = [];
  for (const scene of lesson.scenes) {
    const objects = [];
    for (const object of scene.objects ?? []) {
      const url = object.renderHint === 'image' ? object.content?.url : null;
      // Already-served (http(s) or a public path) images pass through untouched.
      if (!url || /^https?:\/\//.test(url) || url.startsWith(`${urlBase}/`)) {
        objects.push(object);
        continue;
      }
      try {
        await access(url);
      } catch {
        throw new Error(`Scene ${scene.sceneId}: image object ${object.id} references a missing file: ${url}`);
      }
      const fileName = `${String(published + 1).padStart(2, '0')}_${path.basename(url).replace(/[^a-zA-Z0-9._-]/g, '')}`;
      await mkdir(outDir, { recursive: true });
      await copyFile(url, path.join(outDir, fileName));
      published += 1;
      objects.push({ ...object, content: { ...object.content, url: `${urlBase}/${lessonId}/${fileName}` } });
    }
    scenes.push({ ...scene, objects });
  }

  return { ...lesson, scenes, publishedAssets: published };
}
