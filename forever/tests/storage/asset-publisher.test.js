import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { publishLessonAssets } from '../../lib/storage/asset-publisher.js';

const work = path.join(tmpdir(), `forever-assets-${process.pid}`);

function lessonWith(objects) {
  return { sourcePackId: 'sp_assets01', lessonTitle: 'T', scenes: [{ sceneId: 'sc_01', objects, voiceLines: [] }] };
}

test('image files are copied into public/assets and urls rewritten; other objects untouched', async () => {
  const src = path.join(work, 'ingest', 'fig1.png');
  await mkdir(path.dirname(src), { recursive: true });
  await writeFile(src, Buffer.from('PNGDATA'));

  const lesson = lessonWith([
    { id: 'o1', renderHint: 'image', content: { url: src, alt: 'figure', page: 4 } },
    { id: 'o2', renderHint: 'text', content: 'hello' },
    { id: 'o3', renderHint: 'image', content: { url: 'https://cdn.example.com/x.png', alt: 'remote' } },
  ]);
  const publicDir = path.join(work, 'public');
  const published = await publishLessonAssets(lesson, { publicDir });

  const [img, text, remote] = published.scenes[0].objects;
  assert.equal(img.content.url, '/assets/spassets01/01_fig1.png');
  assert.equal(img.content.page, 4); // source-proof chip data survives
  assert.equal(text.content, 'hello');
  assert.equal(remote.content.url, 'https://cdn.example.com/x.png'); // already servable
  assert.equal(published.publishedAssets, 1);
  assert.equal(String(await readFile(path.join(publicDir, 'assets', 'spassets01', '01_fig1.png'))), 'PNGDATA');

  // Idempotent second publish: urls already under /assets pass through.
  const again = await publishLessonAssets(published, { publicDir });
  assert.equal(again.scenes[0].objects[0].content.url, '/assets/spassets01/01_fig1.png');
  assert.equal(again.publishedAssets, 0);
  await rm(work, { recursive: true, force: true });
});

test('a missing image file fails the publish loudly (broken pipeline must not ship)', async () => {
  await assert.rejects(
    publishLessonAssets(lessonWith([{ id: 'oX', renderHint: 'image', content: { url: '/nowhere/gone.png', alt: 'x' } }]), {
      publicDir: path.join(work, 'public2'),
    }),
    /missing file: \/nowhere\/gone\.png/,
  );
});
