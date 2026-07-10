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

  // STRUCTURAL VIEW (not chips-only): a fixed row of capacity slots that fills and drains,
  // with the top arrow riding the cells and the touched cell highlighted.
  assert.deepEqual(trace.views.array.values, ['', ''], 'capacity = high-water mark of the real simulation');
  assert.deepEqual(trace.steps[1].array.values, [7, 3], 'live slot contents at this step');
  assert.deepEqual(trace.steps[1].array.pointers, { top: 1 }, 'the top arrow rides the newest cell');
  assert.equal(trace.steps[1].array.current, 1, 'the pushed cell is highlighted');
  assert.deepEqual(trace.steps[3].array.values, [7, ''], 'the popped slot visibly empties');
  assert.deepEqual(trace.steps[3].array.pointers, { top: 0 }, 'the top arrow drops down after pop');
  assert.equal(trace.steps[3].array.current, 1, 'the just-emptied slot is the moment of the op');
  assert.deepEqual(trace.steps[5].array.pointers, {}, 'an empty stack has no top to point at');
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
  assert.deepEqual(trace.steps[1].array.pointers, { front: 0, back: 1 }, 'both queue arrows ride the cells');
  assert.deepEqual(trace.steps[2].array.values, ['B', ''], 'everyone shifts toward the front');
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
  // The collision chain is WALKED one visible hop at a time before the op lands ("act"
  // collides with "cat" under djb2 mod 3) — the walk is the lesson about collision cost.
  const walk = trace.steps.find((s) => /bucket \d is chained — slot/.test(s.explanation));
  assert.ok(walk, 'a chain-walk step exists for the colliding key');
  assert.match(walk.explanation, /price of a collision/);
  assert.ok(walk.array2d.current, 'the walked chain slot is highlighted');
  assert.ok(walk.array2d.highlight?.length >= 1, 'visited chain slots stay marked during the walk');
  assert.ok(trace.steps.some((s) => /COLLISION/.test(s.explanation)), 'the collision insert is narrated');
  assert.ok(trace.steps.some((s) => /ALREADY.*update, not an insert/s.test(s.explanation)));
  assert.ok(trace.steps.some((s) => /"cat" = 9/.test(s.explanation)), 'get returns the UPDATED value');
  assert.ok(trace.steps.some((s) => /does not exist/.test(s.explanation)));
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

test('constructor ops (init/create) are a teaching beat, not an error (LRU family)', () => {
  const st = compileOperationsTrace({
    structure: 'stack', code: 'x', lines: {},
    ops: [{ op: 'init', value: 2 }, { op: 'push', value: 1 }],
  });
  assert.match(st.steps[0].explanation, /created with capacity 2/);
  const hm = compileOperationsTrace({
    structure: 'hash_map', code: 'x', lines: {},
    ops: [{ op: 'init' }, { op: 'put', key: 'a', value: 1 }],
  });
  assert.match(hm.steps[0].explanation, /map is created/);
});
