// Notebook store contracts: owner scoping in every query, typed-block validation, seq
// assignment, blockCount denormalization, and the pure text assembler for generation.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNotebook, getNotebook, addBlock, removeBlock, deleteNotebook,
  assembleNotebookText, _setNotebookCollectionForTests,
} from '../../lib/storage/notebook-store.js';

function fakeCollection(state = { docs: new Map() }) {
  return {
    state,
    async insertOne(doc) { state.docs.set(doc._id, { ...doc }); },
    async findOne(filter, opts) {
      for (const d of state.docs.values()) if (matches(d, filter)) return { ...d };
      return null;
    },
    find(filter) {
      const rows = [...state.docs.values()].filter((d) => matches(d, filter));
      const chain = {
        sort: () => chain, limit: () => chain,
        toArray: async () => rows.map((d) => ({ ...d })),
      };
      return chain;
    },
    async updateOne(filter, update) {
      for (const d of state.docs.values()) {
        if (matches(d, filter)) {
          for (const [k, v] of Object.entries(update.$set ?? {})) d[k] = v;
          for (const [k, v] of Object.entries(update.$inc ?? {})) d[k] = (d[k] ?? 0) + v;
          return { matchedCount: 1 };
        }
      }
      return { matchedCount: 0 };
    },
    async deleteOne(filter) {
      for (const [id, d] of state.docs) if (matches(d, filter)) { state.docs.delete(id); return { deletedCount: 1 }; }
      return { deletedCount: 0 };
    },
    async deleteMany(filter) {
      let n = 0;
      for (const [id, d] of [...state.docs]) if (matches(d, filter)) { state.docs.delete(id); n += 1; }
      return { deletedCount: n };
    },
  };
}
const matches = (doc, filter) => Object.entries(filter).every(([k, v]) => doc[k] === v);

test('notebook lifecycle: create, add typed blocks with seq, owner-scoped read, delete cascades', async (t) => {
  const fake = fakeCollection();
  _setNotebookCollectionForTests(async () => fake);
  t.after(() => _setNotebookCollectionForTests(null));

  const nb = await createNotebook({ userId: 'u1', title: 'Graph ideas', intent: 'learn bridges' });
  assert.ok(nb._id.startsWith('nbk_'));

  const b1 = await addBlock({ userId: 'u1', notebookId: nb._id, type: 'note', content: 'Tarjan uses disc/low', source: 'typed' });
  const b2 = await addBlock({ userId: 'u1', notebookId: nb._id, type: 'link', url: 'https://x.dev/a', title: 'Bridges intro', content: 'extracted text', source: 'url', trust: 'extracted' });
  assert.equal(b1.seq, 0);
  assert.equal(b2.seq, 1);

  const mine = await getNotebook('u1', nb._id);
  assert.equal(mine.blocks.length, 2);
  assert.equal(mine.notebook.blockCount, 2);
  // privacy in the data layer: another user sees nothing
  assert.equal(await getNotebook('intruder', nb._id), null);

  await removeBlock('u1', nb._id, b1._id);
  assert.equal((await getNotebook('u1', nb._id)).notebook.blockCount, 1);

  assert.equal(await deleteNotebook('u1', nb._id), true);
  assert.equal(await getNotebook('u1', nb._id), null);
  assert.equal(fake.state.docs.size, 0); // blocks cascaded
});

test('addBlock rejects unknown type/source/trust', async (t) => {
  const fake = fakeCollection();
  _setNotebookCollectionForTests(async () => fake);
  t.after(() => _setNotebookCollectionForTests(null));
  await assert.rejects(() => addBlock({ userId: 'u1', notebookId: 'nbk_x', type: 'gif' }), /unknown block type/);
  await assert.rejects(() => addBlock({ userId: 'u1', notebookId: 'nbk_x', type: 'note', source: 'osmosis' }), /unknown block source/);
  await assert.rejects(() => addBlock({ userId: 'u1', notebookId: 'nbk_x', type: 'note', trust: 'vibes' }), /unknown block trust/);
});

test('assembleNotebookText: text-bearing blocks only, voice prefers transcript, titles become headings', () => {
  const text = assembleNotebookText([
    { type: 'note', content: 'plain note' },
    { type: 'image', uploadId: 'up1' },
    { type: 'voice', content: 'raw', transcript: 'spoken words' },
    { type: 'link', title: 'Bridges', content: 'page text' },
  ]);
  assert.match(text, /plain note/);
  assert.match(text, /spoken words/);
  assert.doesNotMatch(text, /raw/);
  assert.match(text, /## Bridges\npage text/);
  assert.doesNotMatch(text, /up1/);
});
