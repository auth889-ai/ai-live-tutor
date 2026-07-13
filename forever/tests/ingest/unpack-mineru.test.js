import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

import { unpackMineru } from '../../lib/ingest/pdf/unpack-mineru.js';

const run = promisify(execFile);
const work = path.join(tmpdir(), `forever-mineru-${process.pid}`);

// Build a real MinerU-shaped zip: markdown + images/ + content_list.json (the OpenMAIC
// harvest source: page_idx, bbox 0-1000, image_caption[] per figure).
async function makeZip({ withContentList }) {
  const src = path.join(work, withContentList ? 'src-meta' : 'src-plain');
  await mkdir(path.join(src, 'images'), { recursive: true });
  await writeFile(path.join(src, 'doc.md'), '# Star Schemas\nA fact table joins dimensions.');
  await writeFile(path.join(src, 'images', 'aaa.jpg'), Buffer.from('JPG1'));
  await writeFile(path.join(src, 'images', 'bbb.jpg'), Buffer.from('JPG2'));
  if (withContentList) {
    await writeFile(path.join(src, 'doc_content_list.json'), JSON.stringify([
      { type: 'text', text: 'A fact table joins dimensions.', page_idx: 0 },
      { type: 'image', img_path: 'images/aaa.jpg', page_idx: 3, bbox: [100, 200, 900, 700], image_caption: ['Figure 2: Star schema', 'with four dimensions'] },
      { type: 'image', img_path: 'images/bbb.jpg', page_idx: 5, bbox: [0, 0, 1000, 1000], image_caption: [] },
    ]));
  }
  const zipPath = path.join(work, withContentList ? 'meta.zip' : 'plain.zip');
  await run('zip', ['-r', zipPath, '.'], { cwd: src });
  return zipPath;
}

test('content_list.json enriches figures with the document_s own captions, pages and bboxes', async () => {
  const zipPath = await makeZip({ withContentList: true });
  const { markdown, images } = await unpackMineru(zipPath, path.join(work, 'out-meta'));
  assert.match(markdown, /Star Schemas/);

  const a = images.find((i) => i.name === 'aaa.jpg');
  assert.equal(a.page, 4); // page_idx 3 -> human page 4
  assert.deepEqual(a.bbox, [100, 200, 900, 700]);
  assert.equal(a.sourceCaption, 'Figure 2: Star schema with four dimensions');

  const b = images.find((i) => i.name === 'bbb.jpg');
  assert.equal(b.page, 6);
  assert.equal(b.sourceCaption, undefined); // empty caption list -> no invented caption
});

test('a result WITHOUT content_list still unpacks (glob fallback, no metadata)', async () => {
  const zipPath = await makeZip({ withContentList: false });
  const { images } = await unpackMineru(zipPath, path.join(work, 'out-plain'));
  assert.equal(images.length, 2);
  assert.ok(images.every((i) => i.page === undefined && i.sourceCaption === undefined));
  await rm(work, { recursive: true, force: true });
});
