import assert from 'node:assert/strict';
import test from 'node:test';

import { chunkText, normalizeText } from '../../lib/source-pack/chunking.js';
import { buildTextSourcePack, validateSourcePack } from '../../lib/source-pack/source-pack.js';

test('text ingestion builds a real source pack with chunks and source refs', () => {
  const sourcePack = buildTextSourcePack(`
CPU + Memory + Bus

CPU আর Memory কথা বলে bus দিয়ে।
Address Bus কোন memory location access করবে।
Data Bus আসল data যায় আসে।
Control Bus read write signal দেয়।

CPU memory location 2020H থেকে data চাইলে Address Bus 2020H পাঠায়,
Control Bus READ signal দেয়, Data Bus actual data CPU-তে আনে।
`);

  assert.equal(sourcePack.inputType, 'text');
  assert.equal(sourcePack.documents.length, 1);
  assert.ok(sourcePack.chunks.length >= 1);
  assert.match(sourcePack.chunks[0].sourceRef, /User text chunk/);
  assert.ok(sourcePack.conceptCandidates.includes('Cpu'));
  validateSourcePack(sourcePack);
});

test('chunking splits long material while preserving order', () => {
  const text = Array.from({ length: 80 }, (_, index) => `Paragraph ${index} explains bus timing and memory transfer.`).join('\n\n');
  const chunks = chunkText(text, { maxChars: 350, overlapChars: 40 });
  assert.ok(chunks.length > 5);
  assert.match(chunks[0], /Paragraph 0/);
  assert.ok(chunks.some((chunk) => chunk.includes('Paragraph 79')));
});

test('normalization collapses repeated blank lines', () => {
  assert.equal(normalizeText('A\n\n\n\nB\r\n\r\nC'), 'A\n\nB\n\nC');
});

test('source pack validation rejects missing source document refs', () => {
  assert.throws(
    () =>
      validateSourcePack({
        id: 'sp_bad',
        title: 'Broken',
        inputType: 'text',
        documents: [{ id: 'src_001', type: 'text', title: 'Broken' }],
        chunks: [
          {
            id: 'chunk_001',
            sourceId: 'missing',
            text: 'Some source text',
            sourceRef: 'User text',
            tokenEstimate: 4,
            orderIndex: 0,
          },
        ],
        conceptCandidates: [],
      }),
    /references missing source/,
  );
});

