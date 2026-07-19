import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyFocusSignal } from '../../lib/focus/classify-signal.js';

test('known distraction site is flagged WITHOUT a model call (fast path)', async () => {
  let called = false;
  const call = async () => { called = true; return { json: {} }; };
  const r = await classifyFocusSignal({ page: { url: 'https://www.tiktok.com/foryou', title: 'For You' }, behavior: {} }, { goal: 'learn SQL', call });
  assert.equal(r.type, 'non-study');
  assert.equal(called, false, 'obvious distraction should not spend a token');
  assert.ok(r.chatMessage.length > 0 && r.suggestedAction.length > 0);
});

test('known study resource passes WITHOUT a model call', async () => {
  let called = false;
  const call = async () => { called = true; return { json: {} }; };
  const r = await classifyFocusSignal({ page: { url: 'https://stackoverflow.com/questions/123', title: 'SQL join' }, behavior: { isHidden: false } }, { goal: 'learn SQL', call });
  assert.equal(r.type, 'study');
  assert.equal(called, false);
});

test('ambiguous page consults the model and returns a nudge on drift', async () => {
  const call = async ({ system, user }) => {
    assert.ok(/STUDY.*NON-STUDY/s.test(system));
    assert.ok(user.includes('learn SQL'));
    return { json: { type: 'non-study', voiceText: 'Back to SQL!', chatMessage: 'This blog is off your SQL goal — reopen your notes.', suggestedAction: 'reopen notes', reason: 'off goal' } };
  };
  const r = await classifyFocusSignal({ page: { url: 'https://some-random-blog.com/travel', title: 'Bali trip', visibleText: 'beaches and hotels' }, behavior: { idleMs: 40000 } }, { goal: 'learn SQL', call });
  assert.equal(r.type, 'non-study');
  assert.equal(r.chatMessage, 'This blog is off your SQL goal — reopen your notes.');
});

test('model returning study yields an empty (silent) decision', async () => {
  const call = async () => ({ json: { type: 'study', reason: 'tutorial matches goal' } });
  const r = await classifyFocusSignal({ page: { url: 'https://blog.example.com/sql-tutorial', title: 'SQL tutorial', visibleText: 'SELECT FROM WHERE joins' }, behavior: {} }, { goal: 'learn SQL', call });
  assert.equal(r.type, 'study');
  assert.equal(r.chatMessage, '');
});

test('model unreachable -> deterministic fallback, never throws', async () => {
  const call = async () => { throw new Error('offline'); };
  const r = await classifyFocusSignal({ page: { url: 'https://unknown.com/x', title: 'x' }, behavior: {} }, { goal: 'study', call });
  assert.ok(r.type === 'non-study' || r.type === 'study');
  assert.ok('chatMessage' in r);
});
