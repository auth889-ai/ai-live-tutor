import assert from 'node:assert/strict';
import test from 'node:test';

import { compileOperationsTrace } from '../../../lib/execution/trace/operations/compiler.js';

const CODE = 's = []\ns.append(x)\ns.pop()\ns[-1]';

test('stack: one frame per op, LIFO narrated, underflow taught instead of crashing', () => {
  const trace = compileOperationsTrace({
    structure: 'stack',
    code: CODE,
    lines: { push: 2, pop: 3, peek: 4 },
    ops: [
      { op: 'push', value: 7 }, { op: 'push', value: 3 }, { op: 'peek' },
      { op: 'pop' }, { op: 'pop' }, { op: 'pop' },
    ],
  });
  assert.equal(trace.steps.length, 6);
  assert.deepEqual(trace.steps[1].stack, [7, 3]);
  assert.equal(trace.steps[1].line, 2);
  assert.match(trace.steps[1].explanation, /TOP.*Last In, First Out/s);
  assert.match(trace.steps[2].explanation, /WITHOUT removing/);
  assert.deepEqual(trace.steps[3].stack, [7], 'pop removes the most recent');
  assert.match(trace.steps[5].explanation, /EMPTY stack.*underflow/s, 'the classic bug becomes a lesson');
  for (const s of trace.steps) assert.ok(s.explanation.length > 80);
});

test('queue: FIFO order with shifting front', () => {
  const trace = compileOperationsTrace({
    structure: 'queue',
    code: CODE,
    ops: [{ op: 'enqueue', value: 'A' }, { op: 'enqueue', value: 'B' }, { op: 'dequeue' }],
  });
  assert.deepEqual(trace.steps[1].queue, ['A', 'B']);
  assert.deepEqual(trace.steps[2].queue, ['B'], 'A left from the FRONT');
  assert.match(trace.steps[2].explanation, /FRONT.*waited longest/s);
});

test('hash map: real hashes, collision chaining, update-in-place, O(1) teaching', () => {
  const trace = compileOperationsTrace({
    structure: 'hash_map',
    code: CODE,
    buckets: 3,
    ops: [
      { op: 'put', key: 'cat', value: 1 },
      { op: 'put', key: 'dog', value: 2 },
      { op: 'put', key: 'act', value: 3 },
      { op: 'put', key: 'cat', value: 9 },
      { op: 'get', key: 'cat' },
      { op: 'get', key: 'ghost' },
      { op: 'remove', key: 'dog' },
    ],
  });
  assert.equal(trace.views.array2d.rows, 3);
  assert.match(trace.steps[0].explanation, /hash\("cat"\) = \d.*O\(1\)/s);
  assert.match(trace.steps[3].explanation, /ALREADY.*update, not an insert/s);
  assert.match(trace.steps[4].explanation, /"cat" = 9/, 'get returns the UPDATED value');
  assert.match(trace.steps[5].explanation, /does not exist/);
  // Deterministic: same keys always hash to the same buckets across runs.
  const again = compileOperationsTrace({ structure: 'hash_map', code: CODE, buckets: 3, ops: [{ op: 'put', key: 'cat', value: 1 }] });
  assert.equal(again.steps[0].variables.bucket, trace.steps[0].variables.bucket);
});

test('honest failures: unknown structure/op, empty or runaway ops', () => {
  assert.throws(() => compileOperationsTrace({ structure: 'wheelbarrow', code: CODE, ops: [{ op: 'push' }] }), /structure must be one of/);
  assert.throws(() => compileOperationsTrace({ structure: 'stack', code: CODE, ops: [] }), /non-empty ops/);
  assert.throws(() => compileOperationsTrace({ structure: 'stack', code: CODE, ops: [{ op: 'yeet', value: 1 }] }), /unknown stack operation/);
  assert.throws(() => compileOperationsTrace({ structure: 'queue', code: CODE, ops: Array.from({ length: 41 }, () => ({ op: 'enqueue', value: 1 })) }), /capped at 40/);
});
