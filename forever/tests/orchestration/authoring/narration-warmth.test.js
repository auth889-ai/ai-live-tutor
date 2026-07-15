import assert from 'node:assert/strict';
import test from 'node:test';

import { warmNarration, directVisualRun } from '../../../lib/orchestration/agents/authoring/narration-warmth.js';

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

// --- AI VISUAL DIRECTOR (experiment) ---

const DIRECTOR_TRACE = {
  steps: [
    { explanation: 'Pointer `i` moves to index 5; `j` was popped as 4.', variables: { i: 5, j: 4 } },
    { explanation: '`answer[4]` is filled in.', variables: { i: 5, j: 4, gap: 1 } },
  ],
};

test('the Director speaks, sets beats and spotlight — and DERIVED arithmetic of recorded facts is allowed', async () => {
  const deps = { callQwenJson: async () => ({ json: { directions: [
    { step: 1, voice: 'Here comes the payoff — `i` stands at 5 while the popped `j` waits at 4.', beat: 'tension', spotlight: ['i', 'j'], turningPoint: false },
    { step: 2, voice: 'We pop 4 and write the wait: 5 minus 4 leaves exactly 1 day. That is the whole trick!', beat: 'payoff', spotlight: ['gap'], turningPoint: true },
  ] }, usage: { total: 1 } }) };
  const { trace, rewritten } = await directVisualRun({ trace: DIRECTOR_TRACE, deps });
  assert.equal(rewritten, 2, '"5 minus 4 leaves 1" passes: 5 and 4 are recorded, 1 is their difference');
  assert.equal(trace.steps[0].beat, 'tension');
  assert.deepEqual(trace.steps[1].spotlight, ['gap']);
  assert.equal(trace.steps[1].turningPoint, true);
});

test('the Director cannot invent: a fabricated number ships the template; junk beats/spotlights are dropped', async () => {
  const deps = { callQwenJson: async () => ({ json: { directions: [
    { step: 1, voice: 'Suddenly index 77 appears out of nowhere and the answer is 99!', beat: 'payoff', spotlight: ['i'] },
    { step: 2, voice: 'The gap of 1 is written down — remember `i` at 5 and `j` at 4 made it.', beat: 'INVALID', spotlight: ['ghostVar', 9999, 'gap'] },
  ] }, usage: null }) };
  const { trace, rewritten } = await directVisualRun({ trace: DIRECTOR_TRACE, deps });
  assert.equal(rewritten, 1);
  assert.match(trace.steps[0].explanation, /popped as 4/, 'fabricating step fell back to the fact scaffold');
  assert.equal(trace.steps[0].beat, undefined);
  assert.equal(trace.steps[1].beat, undefined, 'unknown beat name dropped');
  assert.deepEqual(trace.steps[1].spotlight, ['gap'], 'unknown var and out-of-facts index filtered out');
});

test('OpenMAIC-style speed: long runs are directed in PARALLEL segments, and a failed segment only costs itself', async () => {
  const steps = Array.from({ length: 14 }, (_, i) => ({ explanation: `step ${i + 1} fact`, variables: { i } }));
  let calls = 0;
  const deps = { callQwenJson: async ({ user }) => {
    calls += 1;
    const parsed = JSON.parse(user);
    if (calls === 2) throw new Error('segment 2 model outage');
    return { json: { directions: parsed.steps.map((f) => ({ step: f.step, voice: `A warm retelling of step ${f.step} with its value in plain sight.`, beat: 'setup', spotlight: [] })) }, usage: null };
  } };
  const { trace, rewritten } = await directVisualRun({ trace: { steps }, deps });
  assert.equal(calls, 3, '14 steps -> 3 parallel segment calls of <=6');
  assert.equal(rewritten, 8, 'segments 1 and 3 directed; failed segment 2 keeps its 6 templates');
  assert.match(trace.steps[0].explanation, /warm retelling/);
  assert.match(trace.steps[6].explanation, /step 7 fact/, 'outage segment untouched');
});

test('FILLER GATE: a self-correction draft artifact keeps the guaranteed template (live-caught: "Actually, let me correct myself." shipped)', async () => {
  const steps = [
    { line: 1, explanation: 'We enqueue node A and mark it visited.', variables: {}, queue: ['A'] },
    { line: 2, explanation: 'We dequeue A and enqueue B and D.', variables: {}, queue: ['B', 'D'] },
  ];
  const { trace } = await warmNarration({
    trace: { steps, code: 'x', language: 'python' },
    deps: { callQwenJson: async () => ({ json: { narrations: [
      'Actually, let me correct myself. After sinking the second island we continue scanning onward now.',
      'Here is a lovely warm rewrite: we take A out of the queue and invite B and D to wait in line.',
    ] }, usage: null }) },
  });
  assert.equal(trace.steps[0].explanation, 'We enqueue node A and mark it visited.', 'filler rejected -> template kept');
  assert.match(trace.steps[1].explanation, /invite B and D/, 'clean rewrite accepted');
});
