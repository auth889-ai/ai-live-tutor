import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMultimodalSourcePack, validateMultimodalSourcePack } from '../../../lib/source-pack/build/multimodal-source-pack.js';

const TEXT =
  'A star schema has one central fact table connected to multiple dimension tables. ' +
  'The fact table stores measures; dimension tables store descriptive context like product, date, and store.';

test('builds a SourcePack with text chunks and image assets', () => {
  const sp = buildMultimodalSourcePack({
    title: 'Star Schema',
    text: TEXT,
    images: [
      { kind: 'figure', url: '/img/star.png', page: 45, caption: 'Star schema diagram' },
      { kind: 'page', url: '/img/page45.png', page: 45 },
    ],
  });
  assert.ok(sp.chunks.length >= 1);
  assert.equal(sp.assets.length, 2);
  assert.equal(sp.assets[0].kind, 'figure');
  assert.equal(sp.assets[0].caption, 'Star schema diagram');
});

test('a SourcePack with no images is still valid (assets optional)', () => {
  const sp = buildMultimodalSourcePack({ text: TEXT });
  assert.deepEqual(sp.assets, []);
  validateMultimodalSourcePack(sp);
});

test('an asset with an unknown kind is rejected', () => {
  const sp = buildMultimodalSourcePack({ text: TEXT, images: [{ kind: 'figure', url: '/x.png' }] });
  sp.assets[0].kind = 'hologram';
  assert.throws(() => validateMultimodalSourcePack(sp), /unknown kind/);
});

test('an asset without a url is rejected', () => {
  const sp = buildMultimodalSourcePack({ text: TEXT, images: [{ kind: 'figure', url: '/x.png' }] });
  sp.assets[0].url = '';
  assert.throws(() => validateMultimodalSourcePack(sp), /needs a url/);
});
