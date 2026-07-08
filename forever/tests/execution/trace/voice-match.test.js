import assert from 'node:assert/strict';
import test from 'node:test';

import { voiceLinesForTrace } from '../../../lib/generation/voice/algo-voice.js';
import { validateVoiceLines } from '../../../lib/generation/voice/voice-lines.js';
import { compileRecursionTrace } from '../../../lib/execution/trace/recursion/compiler.js';
import { compileTraversalTrace } from '../../../lib/execution/trace/traversal/compiler.js';
import { compilePointerWalk } from '../../../lib/execution/trace/pointer-walk/compiler.js';
import { compileOperationsTrace } from '../../../lib/execution/trace/operations/compiler.js';
import { compileLineTrace } from '../../../lib/execution/trace/line-sim/compiler.js';

// THE VOICE-MATCH CONTRACT, proven for EVERY engine: the tutor's line i is byte-identical to
// step i's explanation and carries traceStep=i — the player picks the visual frame FROM the
// active line's traceStep, so what is SAID and what is SHOWN are one datum. If any engine ever
// emits steps whose narration could drift, this suite fails.

const CODE = 'def f(x):\n    return x';

function tracesForEveryEngine() {
  return {
    recursion: compileRecursionTrace({
      code: CODE,
      callTree: {
        fnName: 'fib', result: 2,
        vertices: {
          0: { args: [3], children: [{ id: 1, value: 1 }, { id: 2, value: 1 }], memoized: false },
          1: { args: [2], children: [], memoized: false },
          2: { args: [1], children: [], memoized: true },
        },
      },
    }),
    traversal: compileTraversalTrace({
      code: CODE, kind: 'bfs', start: 'A',
      graph: { nodes: [{ id: 'A' }, { id: 'B' }], edges: [{ from: 'A', to: 'B' }], directed: true },
    }),
    pointerWalk: compilePointerWalk({
      code: CODE, array: [1, 2, 3], pointers: ['i'], result: 3,
      events: [{ line: 2, locals: { i: 0 } }, { line: 2, locals: { i: 2 } }],
    }),
    operations: compileOperationsTrace({
      code: CODE, structure: 'stack',
      ops: [{ op: 'push', value: 1 }, { op: 'pop' }],
    }),
    lineSim: compileLineTrace({
      code: CODE, result: 5,
      events: [{ line: 2, locals: { x: 5 } }],
    }),
  };
}

test('every engine: narration is 1:1 with steps — same words, same index, valid contract', () => {
  for (const [engine, trace] of Object.entries(tracesForEveryEngine())) {
    const algorithmObject = { id: 'obj_algo_trace', content: trace, sourceRef: { chunkId: 'ch_1' } };
    const lines = voiceLinesForTrace(algorithmObject);

    assert.equal(lines.length, trace.steps.length, `${engine}: one spoken line per step`);
    lines.forEach((line, i) => {
      assert.equal(line.text, trace.steps[i].explanation, `${engine} step ${i}: spoken words ARE the step's explanation`);
      assert.equal(line.traceStep, i, `${engine} step ${i}: the player will show frame ${i} while this line plays`);
      assert.equal(line.targetObjectId, algorithmObject.id);
    });
    // And the lines pass the same contract every scene must pass before it ships.
    validateVoiceLines(lines, [algorithmObject]);
  }
});

test('the contract refuses an algorithm object without steps (no silent empty narration)', () => {
  assert.throws(() => voiceLinesForTrace({ id: 'x', content: { steps: [] } }), /trace steps/);
  assert.throws(() => voiceLinesForTrace(null), /trace steps/);
});
