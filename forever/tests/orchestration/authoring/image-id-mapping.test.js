import assert from 'node:assert/strict';
import test from 'node:test';

import { buildImageIndex, resolveImageIds, collectFigureContext } from '../../../lib/orchestration/agents/authoring/image-id-mapping.js';

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

test('buildImageIndex exposes parts, visibleText and sourceContext for inventoried figures', () => {
  const sp = {
    assets: [{
      id: 'fig_001', kind: 'figure', url: '/f1.png', caption: 'Figure 2.1: Star schema', page: 45,
      whatItShows: 'A fact table joined to dimensions.',
      transcript: 'SALES_FACT  DIM_PRODUCT  DIM_DATE',
      components: [
        { label: 'fact table', kind: 'box', bbox: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } },
        { label: 'dim product', kind: 'box', bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
      ],
    }],
    chunks: [
      { text: 'As Figure 2.1 shows, the fact table sits at the center of the star.' },
      { text: 'Unrelated paragraph about indexing.' },
      { text: 'Figure 2.1 also demonstrates the foreign keys into each dimension.' },
      { text: 'Figure 2.10 is a different figure and must not match.' },
    ],
  };
  const index = buildImageIndex(sp);
  const entry = index.available[0];
  assert.deepEqual(entry.parts, ['fact table', 'dim product']);
  assert.match(entry.visibleText, /SALES_FACT/);
  assert.equal(entry.sourceContext.length, 2);
  assert.match(entry.sourceContext[0], /center of the star/);
  // the figure-number match is exact: 2.1 must not swallow 2.10
  assert.ok(entry.sourceContext.every((s) => !s.includes('different figure')));
});

test('collectFigureContext: captionless/numberless figures return no context (never guess)', () => {
  assert.deepEqual(collectFigureContext({ caption: 'a nice diagram' }, { chunks: [{ text: 'Figure 3 shows things.' }] }), []);
});

test('resolveImageIds rides whatItShows onto the object content for the Voice Writer', () => {
  const index = buildImageIndex({
    assets: [{ id: 'fig_002', kind: 'figure', url: '/f2.png', caption: 'ER diagram', whatItShows: 'Entities and their relationships with cardinality marks.' }],
    chunks: [],
  });
  const { objects } = resolveImageIds(
    [{ id: 'obj1', renderHint: 'image', content: { url: 'fig_002', alt: 'ER diagram' } }],
    index,
  );
  assert.match(objects[0].content.whatItShows, /cardinality/);
});
