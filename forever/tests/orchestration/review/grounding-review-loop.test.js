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

test('a pedagogy objection also triggers a revision (two critics)', async () => {
  let audits = 0;
  let revised = 0;
  const result = await runGroundingReview({
    sceneId: 'sc_p',
    sourcePack,
    agents: {
      designBoard: async () => goodBoard,
      auditGrounding: async () => ({ objections: [], usage: null }),
      auditPedagogy: async () => {
        audits += 1;
        return { objections: audits === 1 ? [objection('sc_p', 0)] : [], usage: null };
      },
      reviseBoard: async () => {
        revised += 1;
        return goodBoard;
      },
    },
  });
  assert.equal(revised, 1, 'pedagogy objection caused a revision');
  assert.ok(result.transcript.some((m) => m.kind === 'objection'));
});

test('thinking aloud: every society step is narrated through onStep, in order', async () => {
  const steps = [];
  let audits = 0;
  await runGroundingReview({
    sceneId: 'sc_talk',
    sourcePack,
    onStep: (msg) => steps.push(msg),
    agents: {
      designBoard: async () => goodBoard,
      auditGrounding: async () => {
        audits += 1;
        return { objections: audits === 1 ? [objection('sc_talk', 0)] : [], usage: null };
      },
      auditPedagogy: async () => ({ objections: [], usage: null }),
      reviseBoard: async () => goodBoard,
    },
  });
  assert.deepEqual(steps, [
    'The Board Director is designing the board',
    'The Grounding Auditor and Pedagogy Critic are reviewing',
    'The Board Director is repairing 1 objection(s) from the critics',
    'The critics are re-reviewing (round 2)',
    'Approved after 1 repair round(s)',
  ]);
});

test('ARBITRATION: at the round cap, overruled objections ship the scene; sustained ones remove only their objects', async () => {
  const board = { objects: [
    { id: 'title', decorative: true, content: 'T' },
    { id: 'good_analogy', grounding: 'analogy', content: 'ice cream stand' },
    { id: 'bad_fact', sourceRef: { chunkId: 'c1' }, content: 'wrong number' },
  ], usage: null };
  const objectionTo = (objectId) => ({ ...objection('sc_arb', 0), fromRole: 'grounding_auditor', evidenceRefs: [{ objectId }] });
  let audits = 0;
  const result = await runGroundingReview({
    sceneId: 'sc_arb',
    sourcePack,
    maxRounds: 1,
    agents: {
      designBoard: async () => board,
      auditGrounding: async () => {
        audits += 1;
        return { objections: [objectionTo('good_analogy'), objectionTo('bad_fact')], usage: null };
      },
      auditPedagogy: async () => ({ objections: [], usage: null }),
      reviseBoard: async () => board, // revision never satisfies the auditor
      ruleOnObjections: async ({ objections }) => {
        assert.equal(objections.length, 2); // both grounding objections reach the Arbiter
        return { sustained: new Set(['bad_fact']), rulings: [], usage: null };
      },
    },
  });
  // The scene SHIPS (previously: SceneQualityError). Only the sustained object is gone.
  assert.deepEqual(result.objects.map((o) => o.id), ['title', 'good_analogy']);
  assert.ok(result.transcript.some((m) => /Arbiter ruling: 1 objection\(s\) overruled, 1 sustained/.test(m.body)));
});
