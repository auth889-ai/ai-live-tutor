// Publish a lesson's image assets: board "image" objects reference files the ingest wrote
// under .data/ (MinerU figures, page renders, user uploads) — paths a browser can never
// load. This walks the finished lesson, copies each referenced file into
// public/assets/<lessonId>/ and rewrites the object's url to the served path. Production
// swaps the copy for an OSS upload behind this same function. Honest failure: an image
// object whose file is missing is a broken pipeline, not something to ship silently.

import { access, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// Publish ONE scene's images (the progressive-playback unit). nameFor decides the served
// file name; parallel per-scene publishing uses a sceneId prefix so two scenes finishing
// at once can never collide on a shared counter.
async function publishSceneObjects(scene, { outDir, urlBase, lessonKey, nameFor }) {
  const objects = [];
  let published = 0;
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
    const fileName = nameFor(url);
    await mkdir(outDir, { recursive: true });
    await copyFile(url, path.join(outDir, fileName));
    published += 1;
    objects.push({ ...object, content: { ...object.content, url: `${urlBase}/${lessonKey}/${fileName}` } });
  }
  return { scene: { ...scene, objects }, published };
}

export function lessonAssetKey(sourcePackId) {
  return String(sourcePackId).replace(/[^a-z0-9]/gi, '').slice(0, 16);
}

export async function publishSceneAssets(scene, { lessonKey, publicDir = 'public', urlBase = '/assets' } = {}) {
  let n = 0;
  const { scene: out } = await publishSceneObjects(scene, {
    outDir: path.join(publicDir, 'assets', lessonKey),
    urlBase,
    lessonKey,
    nameFor: (url) => `${scene.sceneId}_${String((n += 1)).padStart(2, '0')}_${path.basename(url).replace(/[^a-zA-Z0-9._-]/g, '')}`,
  });
  return out;
}

export async function publishLessonAssets(lesson, { publicDir = 'public', urlBase = '/assets' } = {}) {
  const lessonKey = lessonAssetKey(lesson.sourcePackId);
  const outDir = path.join(publicDir, 'assets', lessonKey);
  let published = 0;
  let seq = 0; // one running number across the whole lesson (the original naming scheme)

  const scenes = [];
  for (const scene of lesson.scenes) {
    const result = await publishSceneObjects(scene, {
      outDir,
      urlBase,
      lessonKey,
      nameFor: (url) => `${String((seq += 1)).padStart(2, '0')}_${path.basename(url).replace(/[^a-zA-Z0-9._-]/g, '')}`,
    });
    published += result.published;
    scenes.push(result.scene);
  }

  return { ...lesson, scenes, publishedAssets: published };
}
