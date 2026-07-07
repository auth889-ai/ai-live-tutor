import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSourcePackFromInput, INPUT_TYPES } from '../../../lib/source-pack/build/dispatch-source-pack.js';

test('every input type routes to its own ingest module with the right arguments', async () => {
  const calls = [];
  const deps = {
    text: (text, opts) => { calls.push(['text', text, opts.title]); return 'PACK_TEXT'; },
    pdf: (path) => { calls.push(['pdf', path]); return 'PACK_PDF'; },
    url: (url) => { calls.push(['url', url]); return 'PACK_URL'; },
    image: (path, opts) => { calls.push(['image', path, opts.contextText]); return 'PACK_IMG'; },
  };

  assert.equal(await buildSourcePackFromInput({ type: 'text', text: 'hello notes', title: 'T' }, { deps }), 'PACK_TEXT');
  assert.equal(await buildSourcePackFromInput({ type: 'pdf', path: '/up/a.pdf' }, { deps }), 'PACK_PDF');
  assert.equal(await buildSourcePackFromInput({ type: 'url', url: 'https://x.com/a' }, { deps }), 'PACK_URL');
  assert.equal(await buildSourcePackFromInput({ type: 'image', path: '/up/b.png', text: 'ctx' }, { deps }), 'PACK_IMG');
  assert.deepEqual(calls, [
    ['text', 'hello notes', 'T'],
    ['pdf', '/up/a.pdf'],
    ['url', 'https://x.com/a'],
    ['image', '/up/b.png', 'ctx'],
  ]);
});

test('unknown input types are refused with the supported list', async () => {
  await assert.rejects(buildSourcePackFromInput({ type: 'hologram' }), /Unknown input type: hologram/);
  assert.deepEqual([...INPUT_TYPES], ['text', 'pdf', 'url', 'image']);
});
