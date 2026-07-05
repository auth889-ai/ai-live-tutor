import assert from 'node:assert/strict';
import test from 'node:test';

import { createSocietyMessage } from '../../../lib/orchestration/messages/society-messages.js';

test('a proposal on a scene blackboard passes', () => {
  const message = createSocietyMessage({
    id: 'msg_001',
    kind: 'proposal',
    fromRole: 'board_director',
    sceneId: 'sc_001',
    body: 'Use the code layout with a dry-run table in the output panel.',
  });
  assert.ok(Object.isFrozen(message));
});

test('an objection without evidence is rejected — no evidence, no objection', () => {
  assert.throws(
    () =>
      createSocietyMessage({
        id: 'msg_002',
        kind: 'objection',
        fromRole: 'grounding_auditor',
        sceneId: 'sc_001',
        body: 'This claim feels wrong.',
      }),
    /no evidence, no objection/,
  );
});

test('an objection with evidence pointers passes', () => {
  createSocietyMessage({
    id: 'msg_003',
    kind: 'objection',
    fromRole: 'grounding_auditor',
    sceneId: 'sc_001',
    body: 'The fact table claim does not match the cited chunk.',
    evidenceRefs: [{ chunkId: 'chunk_0002' }, { objectId: 'obj_fact_table' }],
  });
});

test('only the arbiter may issue verdicts', () => {
  assert.throws(
    () =>
      createSocietyMessage({
        id: 'msg_004',
        kind: 'verdict',
        fromRole: 'teacher',
        sceneId: 'sc_001',
        body: 'I rule in my own favor.',
        verdict: { decision: 'accept', binding: true },
      }),
    /only the arbiter issues verdicts/,
  );
});

test('arbiter verdicts must be binding with a known decision', () => {
  assert.throws(
    () =>
      createSocietyMessage({
        id: 'msg_005',
        kind: 'verdict',
        fromRole: 'arbiter',
        sceneId: 'sc_001',
        body: 'Revise the second screen.',
        verdict: { decision: 'revise', binding: false },
      }),
    /binding/,
  );
});
