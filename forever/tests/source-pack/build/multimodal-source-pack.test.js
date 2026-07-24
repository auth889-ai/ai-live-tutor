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

test('vision depth (whatItShows) survives into the asset — the Board Director must see it', () => {
  // Regression: normalizeAsset used to strip whatItShows, so PDF figures paid for the
  // ingest vision pass and the authoring agents still only saw a one-line caption
  // (image-id-mapping.js reads asset.whatItShows — it was always undefined).
  const sp = buildMultimodalSourcePack({
    text: TEXT,
    images: [{
      kind: 'figure', url: '/img/star.png', page: 45, caption: 'Star schema diagram',
      whatItShows: 'A central fact table linked to four dimension tables (product, date, store, promotion); arrows mark foreign-key joins.',
    }],
  });
  assert.match(sp.assets[0].whatItShows, /fact table linked to four dimension tables/);
  validateMultimodalSourcePack(sp);
  // And absent depth stays absent — no empty-string noise on the contract.
  const bare = buildMultimodalSourcePack({ text: TEXT, images: [{ kind: 'figure', url: '/x.png' }] });
  assert.equal('whatItShows' in bare.assets[0], false);
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

test('inventory (transcript + components) survives into the asset for anchors and depth', () => {
  const sp = buildMultimodalSourcePack({
    text: TEXT,
    images: [{
      kind: 'figure', url: '/img/star.png',
      transcript: 'SALES_FACT DIM_PRODUCT',
      components: [{ label: 'fact table', kind: 'box', bbox: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } }],
    }],
  });
  assert.equal(sp.assets[0].transcript, 'SALES_FACT DIM_PRODUCT');
  assert.equal(sp.assets[0].components[0].label, 'fact table');
  validateMultimodalSourcePack(sp);
  const bare = buildMultimodalSourcePack({ text: TEXT, images: [{ kind: 'figure', url: '/x.png', components: [] }] });
  assert.equal('components' in bare.assets[0], false);
});
