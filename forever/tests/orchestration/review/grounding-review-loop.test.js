import assert from 'node:assert/strict';
import test from 'node:test';

import { runGroundingReview, SceneQualityError } from '../../../lib/orchestration/review/grounding-review-loop.js';
import { createSocietyMessage } from '../../../lib/orchestration/messages/society-messages.js';

const sourcePack = { chunks: [{ id: 'chunk_0001', text: 'x' }] };
const goodBoard = {
  objects: [{ id: 'obj_1', objectType: 't', renderHint: 'text', region: 'notebook_area', content: 'ok', sourceRef: { chunkId: 'chunk_0001' } }],
  usage: null,
};

function objection(sceneId, index) {
  return createSocietyMessage({
    id: `obj_${sceneId}_${index}`,
    kind: 'objection',
    fromRole: 'grounding_auditor',
    sceneId,
    body: 'Unsupported claim.',
    evidenceRefs: [{ objectId: 'obj_1' }, { chunkId: 'chunk_0001' }],
  });
}

test('a board grounded on the first audit passes with a binding accept verdict', async () => {
  const result = await runGroundingReview({
    sceneId: 'sc_a',
    sourcePack,
    agents: {
      designBoard: async () => goodBoard,
      auditGrounding: async () => ({ objections: [], usage: null }),
      reviseBoard: async () => goodBoard,
    },
  });
  assert.equal(result.rounds, 0);
  assert.ok(result.transcript.some((m) => m.kind === 'verdict' && m.verdict.decision === 'accept'));
});

test('objections trigger a revision, then acceptance — the conflict is resolved', async () => {
  let audits = 0;
  const revised = [];
  const result = await runGroundingReview({
    sceneId: 'sc_b',
    sourcePack,
    agents: {
      designBoard: async () => goodBoard,
      auditGrounding: async () => {
        audits += 1;
        return { objections: audits === 1 ? [objection('sc_b', 0)] : [], usage: null };
      },
      reviseBoard: async () => {
        revised.push(1);
        return goodBoard;
      },
    },
  });
  assert.equal(result.rounds, 1);
  assert.equal(revised.length, 1);
  assert.ok(result.transcript.some((m) => m.kind === 'objection'));
  assert.ok(result.transcript.some((m) => m.kind === 'revision'));
  assert.ok(result.transcript.some((m) => m.kind === 'verdict'));
});

test('persistent ungrounded content raises rather than shipping', async () => {
  await assert.rejects(
    () =>
      runGroundingReview({
        sceneId: 'sc_c',
        sourcePack,
        maxRounds: 2,
        agents: {
          designBoard: async () => goodBoard,
          auditGrounding: async () => ({ objections: [objection('sc_c', 0)], usage: null }),
          reviseBoard: async () => goodBoard,
        },
      }),
    SceneQualityError,
  );
});
