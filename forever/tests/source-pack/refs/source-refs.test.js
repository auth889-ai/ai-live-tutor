import assert from 'node:assert/strict';
import test from 'node:test';

import { validateSourceRef, resolveSourceRef } from '../../../lib/source-pack/refs/source-refs.js';
import { buildTextSourcePack } from '../../../lib/source-pack/build/source-pack.js';

test('minimal sourceRef with chunkId passes', () => {
  validateSourceRef({ chunkId: 'chunk_0001' });
});

test('sourceRef bbox must use normalized page coordinates', () => {
  assert.throws(() => validateSourceRef({ chunkId: 'chunk_0001', bbox: { x: 0.2, y: 0.1, w: 2, h: 0.1 } }), /\[0,1\]/);
});

test('sourceRef bbox must stay inside the page', () => {
  assert.throws(() => validateSourceRef({ chunkId: 'chunk_0001', bbox: { x: 0.8, y: 0.1, w: 0.4, h: 0.1 } }), /inside the page/);
});

test('sourceRef page must be a positive integer', () => {
  assert.throws(() => validateSourceRef({ chunkId: 'chunk_0001', page: 0 }), /positive integer/);
});

test('resolveSourceRef returns the cited chunk from a real SourcePack', () => {
  const sourcePack = buildTextSourcePack('A star schema has one central fact table connected to multiple dimension tables around it.');
  const chunk = resolveSourceRef({ chunkId: sourcePack.chunks[0].id }, sourcePack);
  assert.equal(chunk.id, sourcePack.chunks[0].id);
});

test('resolveSourceRef rejects a citation to a missing chunk', () => {
  const sourcePack = buildTextSourcePack('A star schema has one central fact table connected to multiple dimension tables around it.');
  assert.throws(() => resolveSourceRef({ chunkId: 'chunk_9999' }, sourcePack), /missing chunk/);
});
