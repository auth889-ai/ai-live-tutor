// TRUE end-to-end test of the human-in-the-loop scene edit (no tokens): drives the REAL
// PATCH route handler against the REAL filesystem lesson store with a REAL session cookie.
// DISABLE_TTS=1 keeps it silent/free — the voicing unit itself is covered by voice-lesson
// tests; what THIS proves is auth, ownership, validation, persistence, and that the edit
// survives a reload exactly as saved.

import assert from 'node:assert/strict';
import test from 'node:test';
import { rm } from 'node:fs/promises';

import { PATCH } from '../../app/api/lessons/[id]/scenes/[sceneId]/route.js';
import { saveLesson, loadLesson } from '../../lib/storage/lesson-store.js';
import { createSessionToken, SESSION_COOKIE } from '../../lib/auth/session.js';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'e2e-test-secret';
process.env.DISABLE_TTS = '1';
const cookieFor = (userId) => `${SESSION_COOKIE}=${encodeURIComponent(createSessionToken({ userId, email: `${userId}@t.co` }))}`;

const LESSON_ID = 'lesson_editE2E0001';
const lesson = {
  sourcePackId: 'sp_editE2E0001',
  lessonTitle: 'Edit me',
  ownerId: 'owner1',
  scenes: [{
    sceneId: 'sc_01',
    audioUrl: '/audio/k/sc_01.mp3',
    objects: [{ id: 'obj_1', renderHint: 'text', content: 'original board text' }],
    voiceLines: [{ id: 'vl_1', text: 'original narration', targetObjectId: 'obj_1' }],
    timeline: { actions: [] },
    durationMs: 1000,
  }],
};

function patchRequest(cookie, body) {
  return new Request(`http://test/api/lessons/${LESSON_ID}/scenes/sc_01`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}
const params = (sceneId = 'sc_01') => ({ params: Promise.resolve({ id: LESSON_ID, sceneId }) });
const EDIT = { voiceLines: [{ id: 'vl_1', text: 'rewritten narration by the student' }], objects: [{ id: 'obj_1', content: 'rewritten board text' }] };

test('edit-and-save end to end: auth, ownership, validation, persistence', async (t) => {
  await saveLesson(LESSON_ID, lesson, { ownerId: 'owner1' });
  t.after(() => rm(`.data/lessons/${LESSON_ID}.json`, { force: true }));

  // 401 without a session
  assert.equal((await PATCH(patchRequest(null, EDIT), params())).status, 401);
  // 404 for a non-owner (owner-scoped load: the lesson is invisible, not just forbidden)
  assert.equal((await PATCH(patchRequest(cookieFor('intruder'), EDIT), params())).status, 404);
  // 404 for a scene that does not exist
  assert.equal((await PATCH(patchRequest(cookieFor('owner1'), EDIT), params('sc_99'))).status, 404);
  // 400 with the validator's reason for a bad edit
  const bad = await PATCH(patchRequest(cookieFor('owner1'), { voiceLines: [{ id: 'vl_1', text: '' }] }), params());
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /non-empty/);

  // Happy path: 200, edits persisted, audioUrl cleared (silent mode), owner preserved
  const ok = await PATCH(patchRequest(cookieFor('owner1'), EDIT), params());
  assert.equal(ok.status, 200);
  const saved = await loadLesson(LESSON_ID, { forUser: 'owner1' });
  assert.equal(saved.scenes[0].voiceLines[0].text, 'rewritten narration by the student');
  assert.equal(saved.scenes[0].objects[0].content, 'rewritten board text');
  assert.equal('audioUrl' in saved.scenes[0], false); // DISABLE_TTS=1 -> cleared, ready to voice
  assert.equal(saved.ownerId, 'owner1'); // saveLesson ownerId re-passed — edit must NOT strip ownership
});
