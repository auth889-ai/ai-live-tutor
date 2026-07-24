// The coordinate-space contract of vision grounding, locked by measurement (probe:
// scripts/calibrate-vision-grounding.mjs, 2026-07-24, qwen3.7-plus): the model answers
// bbox_2d in 0-1000 NORMALIZED space in every prompt style — including when ordered to use
// absolute pixels. These tests pin the normalization so nobody "fixes" it back to pixel
// space on belief (that belief shipped every mark scaled/shifted: IoU 0.00-0.17 vs truth).

import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { bboxFromModelAnswer, fetchImageForGrounding, matchAnchor, intentsMatchFigure, groundAnnotations } from '../../../lib/orchestration/agents/vision/ground-annotations.js';

test('0-1000 answer maps to exact fractions (the measured model convention)', () => {
  // Probe ground truth: red square at px [300,200,450,320] in a 1200x800 image.
  // Model answered ~[249,249,376,401] in 0-1000 space => fractions of the IMAGE, not pixels.
  const bbox = bboxFromModelAnswer([250, 250, 375, 400]);
  assert.deepEqual(bbox, { x: 0.25, y: 0.25, w: 0.125, h: 0.15000000000000002 });
});

test('already-fractional answer passes through unscaled (defensive path)', () => {
  const bbox = bboxFromModelAnswer([0.25, 0.25, 0.375, 0.4]);
  assert.equal(bbox.x, 0.25);
  assert.ok(Math.abs(bbox.w - 0.125) < 1e-9);
});

test('over-1000 coordinates clamp to the image instead of escaping it', () => {
  const bbox = bboxFromModelAnswer([900, 900, 1400, 1300]);
  assert.ok(bbox.x + bbox.w <= 1);
  assert.ok(bbox.y + bbox.h <= 1);
});

test('malformed and zero-area answers are dropped (null), never guessed', () => {
  assert.equal(bboxFromModelAnswer(null), null);
  assert.equal(bboxFromModelAnswer([100, 100]), null);
  assert.equal(bboxFromModelAnswer([100, 100, 100, 300]), null); // zero width
  assert.equal(bboxFromModelAnswer([100, 100, -5, 300]), null); // negative
  assert.equal(bboxFromModelAnswer(['a', 1, 2, 3]), null);
});

// fetchImageForGrounding: web images must be grounded like local ones (they used to skip
// grounding and ship blind bboxes). Bounded fetch, honest throw on anything non-image.
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await run(base); } finally { server.close(); }
}

test('fetches a remote image and returns bytes + mime from content-type', async () => {
  await withServer(
    (req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG_BYTES); },
    async (base) => {
      const { bytes, mime } = await fetchImageForGrounding(`${base}/fig.png`);
      assert.equal(mime, 'image/png');
      assert.equal(bytes.length, PNG_BYTES.length);
    },
  );
});

test('mime falls back to the url extension when content-type is generic', async () => {
  await withServer(
    (req, res) => { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(PNG_BYTES); },
    async (base) => {
      const { mime } = await fetchImageForGrounding(`${base}/diagram.png?v=2`);
      assert.equal(mime, 'image/png');
    },
  );
});

test('non-image responses throw — never ground on an HTML error page', async () => {
  await withServer(
    (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>not found</html>'); },
    async (base) => {
      await assert.rejects(() => fetchImageForGrounding(`${base}/fig`), /not an image/);
    },
  );
});

test('oversized and error responses throw (bounded fetch, honest degrade)', async () => {
  await withServer(
    (req, res) => {
      if (req.url === '/big.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(Buffer.alloc(2048)); }
      else { res.writeHead(404); res.end(); }
    },
    async (base) => {
      await assert.rejects(() => fetchImageForGrounding(`${base}/big.png`, { maxBytes: 1024 }), /too large/);
      await assert.rejects(() => fetchImageForGrounding(`${base}/missing.png`), /HTTP 404/);
    },
  );
});

// matchAnchor: name-matched inventory components rescue marks whose live double-pass
// disagreed. Conservative on purpose — a wrong rescue would re-open the wrong-marks bug.
test('matchAnchor: exact normalized name wins over containment', () => {
  const anchors = [
    { label: 'fact table', bbox: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } },
    { label: 'the fact table box', bbox: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } },
  ];
  assert.equal(matchAnchor('Fact Table', anchors), anchors[0]);
});

test('matchAnchor: containment matches pick the most specific label', () => {
  const anchors = [
    { label: 'table', bbox: { x: 0, y: 0, w: 0.1, h: 0.1 } },
    { label: 'dimension table (product)', bbox: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } },
  ];
  assert.equal(matchAnchor('the dimension table', anchors), anchors[1]);
});

test('matchAnchor: short/junk targets and unlabeled anchors never match', () => {
  assert.equal(matchAnchor('ab', [{ label: 'ab', bbox: { x: 0, y: 0, w: 1, h: 1 } }]), null);
  assert.equal(matchAnchor('fact table', [{ label: 'fact table' }]), null); // no bbox = useless anchor
  assert.equal(matchAnchor('gradient descent', [{ label: 'fact table', bbox: { x: 0, y: 0, w: 1, h: 1 } }]), null);
  assert.equal(matchAnchor('fact table', undefined), null);
});

// intentsMatchFigure: the wrong-image detector. Live-caught case (2026-07-24): the author
// narrated a 3-table schema but placed the sales line chart — every mark text ("FK:
// Sale.product_id") matched NOTHING in the chart's inventory. Zero matches = wrong image.
test('intentsMatchFigure: schema marks match nothing in a line chart inventory', () => {
  const chart = {
    anchors: [
      { label: 'Alpha line', bbox: { x: 0.1, y: 0.3, w: 0.7, h: 0.2 } },
      { label: 'Yearly sale by team title', bbox: { x: 0.15, y: 0.02, w: 0.7, h: 0.08 } },
    ],
    transcript: 'Yearly sale by team (million taka) 2016 2017 2018 2019 2020 Alpha Beta Gamma',
  };
  const schemaIntents = [
    { verb: 'encircle', text: 'Normalized schema — 3 tables' },
    { verb: 'arrow', text: 'FK: Sale.product_id → Product.id' },
  ];
  const verdict = intentsMatchFigure(schemaIntents, chart);
  assert.equal(verdict.checkable, true);
  assert.equal(verdict.matched, 0);
  // and the right marks DO match their own figure
  const chartIntents = [{ verb: 'encircle', text: 'the Alpha line' }, { verb: 'label', text: 'yearly sale' }];
  assert.equal(intentsMatchFigure(chartIntents, chart).matched, 2);
});

test('intentsMatchFigure: figures without inventory are not checkable (no false rejections)', () => {
  const verdict = intentsMatchFigure([{ verb: 'arrow', text: 'anything' }], { anchors: [], transcript: '' });
  assert.equal(verdict.checkable, false);
});

test('groundAnnotations rejects wrong-image intent sets before any vision call', async () => {
  const result = await groundAnnotations({
    imageBytes: Buffer.alloc(32), mime: 'image/png',
    annotations: [{ verb: 'encircle', text: 'fact table' }, { verb: 'arrow', text: 'foreign key join' }],
    anchors: [{ label: 'Alpha line', bbox: { x: 0.1, y: 0.3, w: 0.5, h: 0.2 } }],
    transcript: 'Yearly sale by team Alpha Beta Gamma',
  });
  assert.equal(result.wrongImage, true);
  assert.equal(result.annotations.length, 0);
  assert.equal(result.dropped.length, 2);
});
