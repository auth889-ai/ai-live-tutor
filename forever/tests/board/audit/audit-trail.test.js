import assert from 'node:assert/strict';
import test from 'node:test';

import { roleOf, refLabel, summarizeTranscript } from '../../../lib/board/audit/audit-trail.js';

test('summarizeTranscript reads the real debate shape the Audit Trail panel shows', () => {
  const transcript = [
    { id: 'm1', kind: 'proposal', fromRole: 'board_director', sceneId: 'sc_04', body: 'Proposed a board of 6 objects.' },
    { id: 'm2', kind: 'objection', fromRole: 'grounding_auditor', sceneId: 'sc_04', body: 'cites chunk c_12 which does not exist', evidenceRefs: [{ objectId: 'o3' }] },
    { id: 'm3', kind: 'objection', fromRole: 'pedagogy_critic', sceneId: 'sc_04', body: 'formula before any visual', evidenceRefs: [{ objectId: 'o5' }] },
    { id: 'm4', kind: 'verdict', fromRole: 'arbiter', sceneId: 'sc_04', body: 'Arbiter ruling: 1 sustained, 1 overruled.', verdict: { decision: 'revise', binding: true } },
    { id: 'm5', kind: 'revision', fromRole: 'board_director', sceneId: 'sc_04', body: 'Revised to address 1 objection.' },
  ];
  const s = summarizeTranscript(transcript);
  assert.deepEqual(s, { steps: 5, objections: 2, revisions: 1, hasVerdict: true, verified: true });
});

test('an empty or missing transcript summarizes to null — the panel renders NOTHING (no fake debate)', () => {
  assert.equal(summarizeTranscript([]), null);
  assert.equal(summarizeTranscript(undefined), null);
  assert.equal(summarizeTranscript(null), null);
});

test('roleOf maps each society role to a stable icon+label, and degrades gracefully for unknowns', () => {
  assert.equal(roleOf('arbiter').label, 'Arbiter');
  assert.equal(roleOf('grounding_auditor').label, 'Grounding Auditor');
  assert.equal(roleOf('pedagogy_critic').icon, '📚');
  assert.deepEqual(roleOf('some_future_role'), { icon: '•', label: 'some_future_role' });
});

test('refLabel turns an evidence pointer into a readable tag, or null when it points at nothing', () => {
  assert.equal(refLabel({ objectId: 'o3' }), 'objectId: o3');
  assert.equal(refLabel({ chunkId: 'c_7' }), 'chunkId: c_7');
  assert.equal(refLabel({}), null);
  assert.equal(refLabel(null), null);
});
