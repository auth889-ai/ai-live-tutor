import assert from 'node:assert/strict';
import test from 'node:test';

import { ingestImage } from '../../../lib/ingest/image/ingest-image.js';

test('ingestImage: vision reading (+ user context) becomes the material, image carried as asset', async () => {
  const pack = await ingestImage('/uploads/u1/diagram.png', {
    contextText: 'This is from my data warehousing course.',
    deps: {
      describeImage: async ({ imagePath }) => {
        assert.equal(imagePath, '/uploads/u1/diagram.png');
        return {
          caption: 'Star schema with a central fact table',
          whatItShows: 'A Fact_Sales table connected to four dimension tables: products, customers, date, and stores.',
        };
      },
    },
  });
  assert.equal(pack.inputType, 'image');
  assert.equal(pack.assets.length, 1);
  assert.equal(pack.assets[0].url, '/uploads/u1/diagram.png');
  assert.match(pack.chunks.map((c) => c.text).join(' '), /Fact_Sales/);
  assert.match(pack.title, /Star schema/);
});

test('ingestImage fails honestly when the image gives too little to teach from', async () => {
  await assert.rejects(
    ingestImage('/uploads/u1/blur.png', { deps: { describeImage: async () => ({ caption: 'A cat', whatItShows: '' }) } }),
    /too little material/,
  );
});
