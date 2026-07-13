// Universal quality gate: "wrong primitive chosen". The Code Runner demo belongs to CODING
// scenes only — live-caught: a Supply & Demand (economics) worked_example shipped with a
// Python print() demo on the board. Non-coding domains must never get code objects.

import assert from 'node:assert/strict';
import test from 'node:test';

import { generateSceneFromSourcePack } from '../../../lib/generation/scene/generate-scene.js';
import { buildTextSourcePack } from '../../../lib/source-pack/build/source-pack.js';

const pack = () => buildTextSourcePack('Demand slopes down and supply slopes up; they cross at equilibrium price.');

const stubAgents = (calls) => ({
  runGroundingReview: async () => ({
    objects: [{ id: 'o1', objectType: 'text', renderHint: 'text', region: 'notebook', content: 'Equilibrium', sourceRef: { chunkId: 'chunk_0001' } }],
    transcript: [], rounds: 1, usages: [],
  }),
  generateExecutedCode: async () => { calls.push('code-runner'); return { code: 'print(1)', output: '1' }; },
  writeVoice: async () => ({ voiceLines: [{ id: 'v1', text: 'Here is equilibrium.', objectId: 'o1' }], usage: null }),
});

test('a non-coding worked_example NEVER runs the Code Runner (wrong-primitive gate)', async () => {
  const calls = [];
  const result = await generateSceneFromSourcePack(pack(), {
    sceneId: 'sc_econ',
    brief: { title: 'Heat wave', pedagogicalRole: 'worked_example', directive: 'show the shift' },
    domain: 'economics',
    agents: stubAgents(calls),
  });
  assert.deepEqual(calls, []); // the Code Runner was never consulted
  assert.ok(result.scene.objects.every((o) => o.renderHint !== 'code'));
});

test('a coding worked_example still gets its executed demo', async () => {
  const calls = [];
  const result = await generateSceneFromSourcePack(pack(), {
    sceneId: 'sc_algo',
    brief: { title: 'Binary search', pedagogicalRole: 'worked_example', directive: 'run it' },
    domain: 'dsa',
    agents: stubAgents(calls),
  });
  assert.deepEqual(calls, ['code-runner']);
  assert.ok(result.scene.objects.some((o) => o.renderHint === 'code'));
});

test('a non-coding dry_run becomes a normal board scene — never routed to the Execution Tracer', async () => {
  const calls = [];
  const agents = stubAgents(calls);
  agents.traceExecution = async () => { calls.push('tracer'); return { trace: null }; };
  const result = await generateSceneFromSourcePack(pack(), {
    sceneId: 'sc_council',
    brief: { title: 'You are the City Council', pedagogicalRole: 'dry_run', directive: 'decide the ceiling' },
    domain: 'economics',
    agents,
  });
  assert.ok(!calls.includes('tracer'), 'tracer must not run for non-coding subjects');
  assert.ok(result.scene.objects.length > 0); // the scene ships as a board scene instead of dropping
});
