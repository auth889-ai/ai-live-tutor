import assert from 'node:assert/strict';
import test from 'node:test';

import { warmNarration } from '../../../lib/orchestration/agents/authoring/narration-warmth.js';

const TRACE = {
  steps: [
    { explanation: '`mid` starts at index 1, where the value is 7.', variables: { lo: 0, hi: 2, mid: 1 } },
    { explanation: 'Everything outside 2..2 is ELIMINATED — 2 of 3 cells dimmed.', variables: { lo: 2, hi: 2 } },
  ],
};

test('AI retells the steps in a warmer voice — accepted when every number is already a recorded fact', async () => {
  const deps = { callQwenJson: async () => ({ json: { narrations: [
    'Here we go — `mid` lands on index 1 and finds a 7 waiting there. Keep that 7 in mind.',
    'And just like that, everything outside 2..2 is gone — 2 of our 3 cells are out of the game.',
  ] }, usage: null }) };
  const { trace, rewritten } = await warmNarration({ trace: TRACE, deps });
  assert.equal(rewritten, 2, 'both steps warmed');
  assert.match(trace.steps[0].explanation, /Here we go/, 'the AI voice ships');
});

test('THE IRON RULE: a rewrite that invents a number is rejected — that step keeps the guaranteed template', async () => {
  const deps = { callQwenJson: async () => ({ json: { narrations: [
    'mid jumps to index 4 where the value is 99 — magnificent!', // 4 and 99 were never recorded
    'Everything outside 2..2 is gone — 2 of our 3 cells are eliminated now.',
  ] }, usage: null }) };
  const { trace, rewritten } = await warmNarration({ trace: TRACE, deps });
  assert.equal(rewritten, 1, 'only the honest rewrite ships');
  assert.match(trace.steps[0].explanation, /`mid` starts at index 1/, 'the fabricating step fell back to the template');
  assert.match(trace.steps[1].explanation, /eliminated now/, 'the honest step got its warmth');
});

test('wrong step count or thin output never degrades anything — templates ship untouched', async () => {
  const short = { callQwenJson: async () => ({ json: { narrations: ['only one'] }, usage: null }) };
  const { trace, rewritten } = await warmNarration({ trace: TRACE, deps: short });
  assert.equal(rewritten, 0);
  assert.equal(trace.steps[0].explanation, TRACE.steps[0].explanation);
  assert.equal(trace.steps[1].explanation, TRACE.steps[1].explanation);
});
