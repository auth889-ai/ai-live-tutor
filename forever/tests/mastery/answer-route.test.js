// POST /api/mastery/answer — the BKT runtime endpoint, tested like the other API routes
// (real handler, session cookie, no live Mongo: with MONGODB_URI unset the store computes
// the routed response from the prior without persisting).

import assert from 'node:assert/strict';
import test from 'node:test';

import { POST } from '../../app/api/mastery/answer/route.js';
import { createSessionToken, SESSION_COOKIE } from '../../lib/auth/session.js';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'mastery-route-test-secret';
delete process.env.MONGODB_URI; // no-DB path: routed response, nothing persisted

const cookie = `${SESSION_COOKIE}=${encodeURIComponent(createSessionToken({ userId: 'user_test', email: 't@t.co' }))}`;

function jsonRequest(body, { signedIn = true } = {}) {
  return new Request('http://test/api/mastery/answer', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: signedIn ? { cookie } : {},
  });
}

test('401 without a session — mastery belongs to the signed-in student', async () => {
  const res = await POST(jsonRequest({ skillId: 'chunk_0001', correct: true }, { signedIn: false }));
  assert.equal(res.status, 401);
});

test('400 without skillId (the chunk the question targets) or a boolean correct', async () => {
  const noSkill = await POST(jsonRequest({ correct: true }));
  assert.equal(noSkill.status, 400);
  assert.match((await noSkill.json()).error, /skillId/);

  const badCorrect = await POST(jsonRequest({ skillId: 'chunk_0001', correct: 'yes' }));
  assert.equal(badCorrect.status, 400);
  assert.match((await badCorrect.json()).error, /correct must be a boolean/);
});

test('a judged correct answer responds { mastery, route } — BKT prior updated, guided_practice band', async () => {
  const res = await POST(jsonRequest({ lessonId: 'lesson_1', questionId: 'obj_quiz', skillId: 'chunk_0001', correct: true }));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(Math.abs(json.mastery - 0.66573) < 1e-4, `mastery ${json.mastery}`);
  assert.equal(json.route, 'guided_practice');
  assert.equal(json.attempts, 1);
});

test('a judged wrong answer routes to reteach', async () => {
  const res = await POST(jsonRequest({ skillId: 'chunk_0001', correct: false }));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.route, 'reteach');
  assert.ok(json.mastery < 0.4);
});
