import assert from 'node:assert/strict';
import test from 'node:test';

import { buildImageIndex, resolveImageIds } from '../../../lib/orchestration/agents/authoring/image-id-mapping.js';

const sourcePack = {
  assets: [
    { id: 'fig_001', kind: 'figure', url: '.data/ingest/doc/images/a.jpg', caption: 'Figure 1: The star schema', whatItShows: 'fact table with dimensions', page: 4 },
    { id: 'fig_002', kind: 'figure', url: '.data/ingest/doc/images/b.jpg', caption: '' }, // uncaptioned -> not offered
    { id: 'page_003', kind: 'page', url: '.data/ingest/doc/pages/p3.png', page: 3 },
  ],
};

test('the index offers captioned figures and pages BY ID — never raw paths', () => {
  const { available } = buildImageIndex(sourcePack);
  assert.deepEqual(available.map((a) => a.imageId), ['fig_001', 'page_003']);
  assert.ok(available.every((a) => !('url' in a)), 'the model must never see file paths');
  assert.equal(available[0].caption, 'Figure 1: The star schema');
  assert.equal(available[1].caption, 'Full render of source page 3');
});

test('ids resolve to real urls (with page/alt enriched); unknown ids are DELETED, not shipped', () => {
  const index = buildImageIndex(sourcePack);
  const { objects, dropped } = resolveImageIds([
    { id: 'o1', renderHint: 'image', content: { url: 'fig_001' } },
    { id: 'o2', renderHint: 'image', content: { url: 'diagram_from_my_imagination.png', alt: 'x' } },
    { id: 'o3', renderHint: 'text', content: 'unrelated, untouched' },
    // an already-real url (revision pass round-trips resolved boards) passes through
    { id: 'o4', renderHint: 'image', content: { url: '.data/ingest/doc/pages/p3.png', alt: 'page' } },
  ], index);

  assert.deepEqual(dropped, ['o2']); // the hallucinated source never reaches a student
  const [o1, o3, o4] = objects;
  assert.equal(o1.content.url, '.data/ingest/doc/images/a.jpg');
  assert.equal(o1.content.page, 4); // enriched from the asset
  assert.equal(o1.content.alt, 'Figure 1: The star schema');
  assert.equal(o3.content, 'unrelated, untouched');
  assert.equal(o4.content.url, '.data/ingest/doc/pages/p3.png');
});
