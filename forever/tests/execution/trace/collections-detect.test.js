import assert from 'node:assert/strict';
import test from 'node:test';

import { detectCollectionOps } from '../../../lib/execution/trace/collections/detect.js';

// Events shaped like the line-sim tracker's output (line + locals per executed line).
const ev = (line, locals) => ({ line, locals });

test('STACK: a list with tail append/pop is detected as a stack (Valid Parentheses class)', () => {
  // st = []; append '('; append '['; pop (matches ']'); pop (matches ')') ...
  const events = [
    ev(2, { st: [] }),
    ev(6, { st: ['('], c: '(' }),
    ev(6, { st: ['(', '['], c: '[' }),
    ev(4, { st: ['('], c: ']' }), // tail pop
    ev(4, { st: [], c: ')' }), // tail pop
  ];
  const got = detectCollectionOps(events);
  assert.ok(got, 'a collection was detected');
  assert.equal(got.varName, 'st');
  assert.equal(got.structure, 'stack');
  assert.deepEqual(got.ops, [
    { op: 'push', value: '(' },
    { op: 'push', value: '[' },
    { op: 'pop' },
    { op: 'pop' },
  ]);
  assert.equal(got.lines.push, 6, 'the push code line is captured from the run');
  assert.equal(got.lines.pop, 4);
});

test('QUEUE: a list with tail append + FRONT pop is detected as a queue (BFS with a list)', () => {
  const events = [
    ev(2, { q: [] }),
    ev(5, { q: ['A'] }),
    ev(5, { q: ['A', 'B'] }),
    ev(5, { q: ['A', 'B', 'C'] }),
    ev(4, { q: ['B', 'C'] }), // front pop -> queue
    ev(4, { q: ['C'] }),
  ];
  const got = detectCollectionOps(events);
  assert.equal(got.structure, 'queue');
  assert.deepEqual(got.ops.map((o) => o.op), ['enqueue', 'enqueue', 'enqueue', 'dequeue', 'dequeue']);
});

test('HASH MAP: a dict growing with string keys is detected', () => {
  const events = [
    ev(2, { seen: {} }),
    ev(3, { seen: { cat: 1 } }),
    ev(3, { seen: { cat: 1, dog: 2 } }),
    ev(3, { seen: { cat: 1, dog: 2, act: 3 } }),
  ];
  const got = detectCollectionOps(events);
  assert.equal(got.structure, 'hash_map');
  assert.deepEqual(got.ops.map((o) => o.key), ['cat', 'dog', 'act']);
});

test('NOT upgraded: an in-place-mutated array (sorting) stays on the floor', () => {
  // A bubble-sort-style array: same length, index writes -> "dirty", never a stack/queue.
  const events = [
    ev(1, { a: [3, 1, 2] }),
    ev(2, { a: [1, 3, 2] }),
    ev(2, { a: [1, 2, 3] }),
  ];
  assert.equal(detectCollectionOps(events), null);
});

test('a drained queue is NOT mixed ends: the last pop (1 element -> empty) is ambiguous and follows the discipline', () => {
  // BFS queues always drain to empty — the final pop empties the list from BOTH ends at once,
  // and mislabeling it a tail removal used to reject every queue that finished its work.
  const drained = [
    ev(1, { x: [] }), ev(1, { x: [1] }), ev(1, { x: [1, 2] }),
    ev(1, { x: [2] }), // front pop -> FIFO
    ev(1, { x: [] }), // ambiguous (singleton -> empty) -> resolves to the FIFO discipline
  ];
  assert.equal(detectCollectionOps(drained)?.structure, 'queue');
});

test('NOT upgraded: genuinely mixed-end removals are ambiguous; too-few ops stay on the floor', () => {
  const mixed = [
    ev(1, { x: [1, 2, 3] }),
    ev(1, { x: [1, 2] }), // tail pop (unambiguous: 3 -> 2 elements)
    ev(1, { x: [2] }), // front pop (unambiguous: 2 -> 1) -> mixed ends for real
    ev(1, { x: [2, 4] }),
  ];
  assert.equal(detectCollectionOps(mixed), null);
  const tooFew = [ev(1, { y: [] }), ev(1, { y: [1] })];
  assert.equal(detectCollectionOps(tooFew), null);
});

test('picks the collection with the most operations when several exist', () => {
  const events = [
    ev(1, { s: [], seen: {} }),
    ev(2, { s: [1], seen: { a: 1 } }),
    ev(2, { s: [1, 2], seen: { a: 1 } }),
    ev(3, { s: [1], seen: { a: 1 } }),
    ev(3, { s: [], seen: { a: 1 } }),
  ];
  const got = detectCollectionOps(events);
  assert.equal(got.varName, 's', 'the stack has more clean ops than the 1-put dict');
  assert.equal(got.structure, 'stack');
});
