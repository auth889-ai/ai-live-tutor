// Exit-door sweep: no mark leaves generation without provenance (kernel-caught leak:
// revision/repair-authored marks bypassed the production-time grounding).

import assert from 'node:assert/strict';
import test from 'node:test';
import { groundSceneImages } from '../../../lib/orchestration/agents/vision/ground-scene-images.js';

const img = (annotations) => ({ id: 'fig1', renderHint: 'image', content: { url: '/assets/x/f.png', alt: 'x', annotations } });

test('untagged marks are re-grounded; tagged marks pass through with zero vision calls', async () => {
  let calls = 0;
  const objects = [img([
    { verb: 'highlight', text: 'fact table', bbox: { x: 0, y: 0, w: 0.1, h: 0.1 }, groundedBy: 'consensus' },
    { verb: 'arrow', text: 'join path', bbox: { x: 0.5, y: 0.5, w: 0.2, h: 0.1 } }, // untagged
  ])];
  await groundSceneImages(objects, {
    assets: [{ url: '/assets/x/f.png', components: [], transcript: '' }],
    ground: async ({ annotations }) => { calls += 1; return { annotations: annotations.map((a) => ({ ...a, bbox: { x: 0.4, y: 0.4, w: 0.2, h: 0.1 }, groundedBy: 'consensus' })), dropped: [] }; },
  });
  assert.equal(calls, 1);
  const marks = objects[0].content.annotations;
  assert.equal(marks.length, 2);
  assert.ok(marks.every((a) => a.groundedBy));
  // fully-tagged object: no call at all
  await groundSceneImages(objects, { assets: [], ground: async () => { throw new Error('must not be called'); } });
});

test('grounding failure removes unverified marks, keeps verified ones (unverifiable = undrawable)', async () => {
  const objects = [img([
    { verb: 'highlight', text: 'ok', bbox: { x: 0, y: 0, w: 0.1, h: 0.1 }, groundedBy: 'anchor' },
    { verb: 'label', text: 'ghost', bbox: { x: 0.9, y: 0.9, w: 0.05, h: 0.05 } },
  ])];
  await groundSceneImages(objects, { assets: [], ground: async () => { throw new Error('vision down'); } });
  assert.equal(objects[0].content.annotations.length, 1);
  assert.equal(objects[0].content.annotations[0].text, 'ok');
});

test('wrong-image verdict strips all untagged marks', async () => {
  const objects = [img([{ verb: 'highlight', text: 'schema story', bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }])];
  await groundSceneImages(objects, { assets: [], ground: async () => ({ annotations: [], dropped: ['schema story'], wrongImage: true }) });
  assert.equal(objects[0].content.annotations.length, 0);
});
