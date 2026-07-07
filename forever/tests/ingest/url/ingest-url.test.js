import assert from 'node:assert/strict';
import test from 'node:test';

import { ingestUrl, extractReadableText } from '../../../lib/ingest/url/ingest-url.js';

const PAGE = `<html><head><title>Binary Search &amp; Friends</title><style>p{color:red}</style></head>
<body><nav><a href="/">Home</a><a href="/about">About</a></nav>
<script>trackEverything();</script>
<article><h1>Binary Search</h1>
<p>Binary search finds a target in a sorted array by halving the search space each step.</p>
<p>Set low and high pointers, compute mid, compare, and move into the correct half. It runs in O(log n).</p>
<p>A common mistake is an off-by-one error in the loop bound or the mid calculation itself.</p></article>
<footer>© site</footer></body></html>`;

test('extractReadableText keeps the article, drops scripts/styles/nav/footer, decodes entities', () => {
  const { title, text } = extractReadableText(PAGE);
  assert.equal(title, 'Binary Search & Friends');
  assert.match(text, /halving the search space/);
  assert.match(text, /off-by-one error/);
  assert.doesNotMatch(text, /trackEverything|color:red|Home|© site/);
});

test('ingestUrl builds a url SourcePack from a real fetch (injected)', async () => {
  const pack = await ingestUrl('https://example.com/binary-search', {
    fetchImpl: async () => new Response(PAGE, { status: 200 }),
  });
  assert.equal(pack.inputType, 'url');
  assert.equal(pack.title, 'Binary Search & Friends');
  assert.ok(pack.chunks.length >= 1);
});

test('ingestUrl fails honestly: bad protocol, HTTP error, empty page', async () => {
  await assert.rejects(ingestUrl('ftp://x.com/file'), /Only http\(s\)/);
  await assert.rejects(
    ingestUrl('https://x.com/missing', { fetchImpl: async () => new Response('nope', { status: 404 }) }),
    /HTTP 404/,
  );
  await assert.rejects(
    ingestUrl('https://x.com/thin', { fetchImpl: async () => new Response('<html><body>hi</body></html>', { status: 200 }) }),
    /too little readable text/,
  );
});
