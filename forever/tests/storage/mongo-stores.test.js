// The MongoDB backends, unit-tested with injected fake collections (no live cluster):
// verifies the store contracts — owner scoping IN the query (privacy in the data layer),
// upsert idempotency, denormalized card facts, duplicate-email 11000 mapping.

import assert from 'node:assert/strict';
import test from 'node:test';

import { saveLesson, loadLesson, listLessons } from '../../lib/storage/lesson-store.js';
import { registerUser, authenticateUser } from '../../lib/auth/user-store.js';
import { hashPassword } from '../../lib/auth/password.js';

process.env.MONGODB_URI = 'mongodb://unit-test-fake'; // routes stores to the DB backend; collections injected

const lesson = {
  lessonTitle: 'Binary Search',
  voiced: true,
  scenes: [{ sceneId: 'sc_01', durationMs: 60_000 }, { sceneId: 'sc_02', durationMs: 30_000 }],
};

test('saveLesson upserts the document with denormalized card facts and the owner', async () => {
  const calls = [];
  const fake = { replaceOne: async (...args) => calls.push(args) };
  await saveLesson('lesson_x', lesson, { ownerId: 'user_a', collection: async () => fake });

  const [filter, doc, opts] = calls[0];
  assert.deepEqual(filter, { _id: 'lesson_x' });
  assert.deepEqual(opts, { upsert: true }); // idempotent on job retry
  assert.equal(doc.ownerId, 'user_a');
  assert.equal(doc.title, 'Binary Search');
  assert.equal(doc.scenes, 2);
  assert.equal(doc.durationMs, 90_000);
  assert.equal(doc.voiced, true);
  assert.equal(doc.payload.ownerId, 'user_a'); // payload carries the owner too
});

test('loadLesson scopes by owner IN the query — privacy is the filter, not a later check', async () => {
  const queries = [];
  const fake = { findOne: async (q) => { queries.push(q); return { payload: { lessonTitle: 'Binary Search' } }; } };
  const loaded = await loadLesson('lesson_x', { forUser: 'user_a', collection: async () => fake });
  assert.equal(loaded.lessonTitle, 'Binary Search');
  assert.deepEqual(queries[0], { _id: 'lesson_x', $or: [{ ownerId: null }, { ownerId: 'user_a' }] });

  const miss = { findOne: async () => null };
  assert.equal(await loadLesson('lesson_x', { forUser: 'user_b', collection: async () => miss }), null);
});

test('listLessons returns cards from denormalized fields, owner-scoped, no payloads', async () => {
  let filter, projection;
  const fake = {
    find: (f, opts) => {
      filter = f;
      projection = opts.projection;
      return { sort: () => ({ toArray: async () => [{ _id: 'lesson_x', title: 'T', scenes: 2, durationMs: 90_000, voiced: false }] }) };
    },
  };
  const cards = await listLessons({ forUser: 'user_a', collection: async () => fake });
  assert.deepEqual(cards, [{ id: 'lesson_x', title: 'T', scenes: 2, voiced: false, durationMs: 90_000 }]);
  assert.deepEqual(filter, { $or: [{ ownerId: null }, { ownerId: 'user_a' }] });
  assert.equal(projection.payload, undefined); // library listing never drags full payloads
});

test('registerUser maps duplicate-key 11000 to the friendly duplicate-email error', async () => {
  const dup = { insertOne: async () => { const e = new Error('E11000 duplicate key'); e.code = 11000; throw e; } };
  await assert.rejects(registerUser({ email: 'a@b.co', password: 'pw12345678' }, { collection: async () => dup }), /already exists/);

  const docs = [];
  const ok = { insertOne: async (doc) => docs.push(doc) };
  const user = await registerUser({ email: 'New@B.co', password: 'pw12345678' }, { collection: async () => ok });
  assert.match(user.userId, /^user_/);
  assert.equal(docs[0].email, 'new@b.co'); // normalized email stored
  assert.ok(docs[0].passwordHash && !docs[0].password); // hash only, never plaintext
});

test('authenticateUser verifies the stored hash and is null on unknown email', async () => {
  const hash = hashPassword('right-password');
  const found = { findOne: async () => ({ _id: 'user_a', email: 'a@b.co', passwordHash: hash }) };
  assert.deepEqual(
    await authenticateUser({ email: 'a@b.co', password: 'right-password' }, { collection: async () => found }),
    { userId: 'user_a', email: 'a@b.co' },
  );
  assert.equal(await authenticateUser({ email: 'a@b.co', password: 'wrong' }, { collection: async () => found }), null);
  const empty = { findOne: async () => null };
  assert.equal(await authenticateUser({ email: 'ghost@b.co', password: 'x' }, { collection: async () => empty }), null);
});
