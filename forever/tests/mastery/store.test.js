// Mastery store: BKT wired to persistence — per (userId, skillId) state via injected
// fake collections (no live Mongo, same pattern as the storage tests), deterministic
// routing bands, graceful no-DB behavior. Expected mastery numbers computed by hand from
// the vendored BKT equations (pInit .3, pT .15, pG .25, pS .1).

import assert from 'node:assert/strict';
import test from 'node:test';

import { recordAnswer, getMastery, listMastery, routeForMastery } from '../../lib/mastery/store.js';

function fakeCollection() {
  const docs = new Map();
  return {
    docs,
    findOne: async (query) => docs.get(query._id) ?? null,
    updateOne: async (query, update, options) => {
      const prev = docs.get(query._id) ?? (options?.upsert ? { _id: query._id, ...(update.$setOnInsert ?? {}) } : null);
      if (!prev) return { matchedCount: 0 };
      docs.set(query._id, { ...prev, ...(update.$set ?? {}) });
      return { matchedCount: 1 };
    },
    find: (query) => ({ sort: () => ({ limit: () => ({ toArray: async () => [...docs.values()].filter((d) => d.userId === query.userId) }) }) }),
  };
}

test('routing bands are exact at the boundaries: <0.40 reteach, 0.40-0.70 guided, 0.70-0.90 faded, >=0.90 transfer', () => {
  assert.equal(routeForMastery(0.0), 'reteach');
  assert.equal(routeForMastery(0.399), 'reteach');
  assert.equal(routeForMastery(0.4), 'guided_practice');
  assert.equal(routeForMastery(0.699), 'guided_practice');
  assert.equal(routeForMastery(0.7), 'faded_practice');
  assert.equal(routeForMastery(0.899), 'faded_practice');
  assert.equal(routeForMastery(0.9), 'transfer');
  assert.equal(routeForMastery(1.0), 'transfer');
  assert.throws(() => routeForMastery('high'), /numeric mastery/);
});

test('first correct answer: prior 0.3 -> mastery ~0.6657 -> guided_practice, persisted per (user, skill)', async () => {
  const col = fakeCollection();
  const result = await recordAnswer(
    { userId: 'user_a', lessonId: 'lesson_1', questionId: 'obj_quiz', skillId: 'chunk_0002', correct: true },
    { collection: async () => col, now: () => 'T0' },
  );
  assert.ok(Math.abs(result.mastery - 0.66573) < 1e-4, `mastery ${result.mastery}`);
  assert.equal(result.route, 'guided_practice');
  assert.equal(result.attempts, 1);
  assert.equal(result.persisted, true);

  const doc = col.docs.get('bkt_user_a_chunk_0002');
  assert.equal(doc.kind, 'mastery');
  assert.equal(doc.userId, 'user_a');
  assert.equal(doc.skillId, 'chunk_0002');
  assert.equal(doc.lastCorrect, true);
  assert.equal(doc.lastLessonId, 'lesson_1');
  assert.equal(doc.lastQuestionId, 'obj_quiz');
  assert.ok(Math.abs(doc.probMastery - result.mastery) < 1e-12);
  assert.equal(doc.createdAt, 'T0');
});

test('first wrong answer: prior 0.3 -> mastery ~0.1959 -> reteach', async () => {
  const col = fakeCollection();
  const result = await recordAnswer(
    { userId: 'user_a', skillId: 'chunk_0001', correct: false },
    { collection: async () => col },
  );
  assert.ok(Math.abs(result.mastery - 0.19595) < 1e-4, `mastery ${result.mastery}`);
  assert.equal(result.route, 'reteach');
});

test('sequential answers accumulate on the STORED state: correct x3 walks guided -> faded -> transfer', async () => {
  const col = fakeCollection();
  const deps = { collection: async () => col };
  const first = await recordAnswer({ userId: 'user_a', skillId: 'chunk_0003', correct: true }, deps);
  const second = await recordAnswer({ userId: 'user_a', skillId: 'chunk_0003', correct: true }, deps);
  const third = await recordAnswer({ userId: 'user_a', skillId: 'chunk_0003', correct: true }, deps);
  assert.equal(first.route, 'guided_practice');
  assert.equal(second.route, 'faded_practice');
  assert.ok(Math.abs(second.mastery - 0.89596) < 1e-4, `mastery ${second.mastery}`);
  assert.equal(third.route, 'transfer');
  assert.deepEqual([first.attempts, second.attempts, third.attempts], [1, 2, 3]);
  assert.equal(third.correctCount, 3);
});

test('skills are independent: the same user starts fresh on a different chunk', async () => {
  const col = fakeCollection();
  const deps = { collection: async () => col };
  await recordAnswer({ userId: 'user_a', skillId: 'chunk_0001', correct: true }, deps);
  const other = await recordAnswer({ userId: 'user_a', skillId: 'chunk_0009', correct: true }, deps);
  assert.equal(other.attempts, 1);
  assert.ok(Math.abs(other.mastery - 0.66573) < 1e-4);
  assert.ok(col.docs.has('bkt_user_a_chunk_0001') && col.docs.has('bkt_user_a_chunk_0009'));
});

test('no DB: the answer still gets a BKT-routed response from the prior, persisted=false, and reads return empty', async () => {
  const deps = { collection: async () => null };
  const result = await recordAnswer({ userId: 'user_a', skillId: 'chunk_0001', correct: true }, deps);
  assert.equal(result.persisted, false);
  assert.equal(result.route, 'guided_practice');
  assert.equal(await getMastery('user_a', 'chunk_0001', deps), null);
  assert.deepEqual(await listMastery('user_a', deps), []);
});

test('missing userId or skillId is rejected loudly — mastery is never recorded against nothing', async () => {
  const deps = { collection: async () => fakeCollection() };
  await assert.rejects(recordAnswer({ skillId: 'chunk_0001', correct: true }, deps), /needs userId/);
  await assert.rejects(recordAnswer({ userId: 'user_a', correct: true }, deps), /needs skillId/);
});
