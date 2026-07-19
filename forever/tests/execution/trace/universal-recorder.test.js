import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import {
  assembleUniversalProgram,
  parseUniversalEvents,
  validateUniversalRecording,
  UNIVERSAL_TRACKER_PY,
} from '../../../lib/execution/trace/universal/recorder.js';

const py = (source) => execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15_000 });

const record = ({ code, entry }) => {
  const payload = parseUniversalEvents(py(assembleUniversalProgram({ code, entry })));
  assert.ok(payload, 'the run printed a parseable @@UNIREC payload');
  return validateUniversalRecording(payload);
};

test('assembleUniversalProgram: student code compiled under <student>, entry hardened', () => {
  const program = assembleUniversalProgram({ code: 'def f(x):\n    return x', entry: 'f(1)' });
  for (const marker of ['sys.settrace(_tracer)', "compile(_maybe_tree, '<student>', 'exec')", '@@UNIREC', 'MAX_EVENTS']) {
    assert.ok(program.includes(marker), `program carries ${marker}`);
  }
  assert.throws(() => assembleUniversalProgram({ code: 'def f(x):\n    return x', entry: 'x = 1\nimport os' }), /single expression/);
  assert.throws(() => assembleUniversalProgram({ code: '', entry: 'f()' }), /needs the algorithm code/);
  assert.ok(UNIVERSAL_TRACKER_PY.includes("f_code.co_filename != '<student>'"), 'harness lines never leak into the recording');
});

// Rotten Oranges — the shape that needs grid + queue + counter TOGETHER (Striver G-10). Today
// this requires the graph-walk tracker; the universal recorder captures it with zero declaration.
test('grid BFS: one run records the mutating grid, the live deque, and the minute counter', () => {
  const code = [
    'from collections import deque',
    'def orangesRotting(grid):',
    '    rows, cols = len(grid), len(grid[0])',
    '    q = deque()',
    '    for r in range(rows):',
    '        for c in range(cols):',
    '            if grid[r][c] == 2:',
    '                q.append((r, c))',
    '    minutes = 0',
    '    while q:',
    '        for _ in range(len(q)):',
    '            r, c = q.popleft()',
    '            for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):',
    '                nr, nc = r + dr, c + dc',
    '                if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] == 1:',
    '                    grid[nr][nc] = 2',
    '                    q.append((nr, nc))',
    '        if q:',
    '            minutes += 1',
    '    return minutes',
  ].join('\n');
  const rec = record({ code, entry: 'orangesRotting([[2,1,1],[1,1,0],[0,1,1]])' });

  const lines = rec.events.filter((e) => e.ev === 'line');
  assert.ok(lines.length > 10, 'the real run produced line events');
  assert.ok(lines.every((e) => e.locals && typeof e.locals === 'object'), 'every line event carries locals');

  const withQueue = lines.filter((e) => Array.isArray(e.locals.q));
  assert.ok(withQueue.length > 0, 'the deque is serialized as a list, not a repr blob');
  assert.ok(withQueue.some((e) => e.locals.q.length > 0), 'the queue is seen non-empty mid-run');

  const grids = lines.filter((e) => Array.isArray(e.locals.grid)).map((e) => JSON.stringify(e.locals.grid));
  assert.ok(new Set(grids).size > 1, 'the grid is seen MUTATING across the run (cells 1 -> 2)');

  assert.ok(lines.some((e) => Number.isInteger(e.locals.minutes) && e.locals.minutes > 0), 'the minute counter is recorded ticking');

  const ret = rec.events.filter((e) => e.ev === 'return').at(-1);
  assert.ok(ret, 'the outer return is recorded');
  assert.equal(rec.result, 4, 'the recorded result is the real answer');
});

// Linked-list reversal — identity is everything: arrows only draw truthfully if each node keeps
// ONE id across the whole run while its .next flips. Today this needs the dedicated list tracker.
test('linked list: heap snapshots carry stable node identities and flipping next-links', () => {
  const code = [
    'class ListNode:',
    '    def __init__(self, val):',
    '        self.val = val',
    '        self.next = None',
    'def build(vals):',
    '    head = ListNode(vals[0])',
    '    node = head',
    '    for v in vals[1:]:',
    '        node.next = ListNode(v)',
    '        node = node.next',
    '    return head',
    'def reverseList(head):',
    '    prev = None',
    '    curr = head',
    '    while curr:',
    '        nxt = curr.next',
    '        curr.next = prev',
    '        prev = curr',
    '        curr = nxt',
    '    return prev',
    'lst = build([1, 2, 3])',
  ].join('\n');
  const rec = record({ code, entry: 'reverseList(lst)' });

  const heaps = rec.events.filter((e) => e.ev === 'line' && e.heap);
  assert.ok(heaps.length >= 2, 'heap snapshots recorded, and ONLY when the object graph changed');

  const first = heaps[0].heap;
  const nodes = Object.values(first).filter((o) => o.type === 'ListNode');
  assert.equal(nodes.length, 3, 'all three real nodes are captured');
  assert.ok(nodes.every((o) => 'val' in o), 'each node carries its value');

  const ids = new Set(Object.keys(first));
  const last = heaps.at(-1).heap;
  for (const id of Object.keys(last)) assert.ok(ids.has(id), `node ${id} kept its identity across the run`);

  const nextOf = (heap, val) => Object.values(heap).find((o) => o.val === val)?.next ?? null;
  const idOf = (heap, val) => Object.entries(heap).find(([, o]) => o.val === val)?.[0];
  assert.equal(nextOf(first, 1), idOf(first, 2), 'before: 1 -> 2');
  assert.equal(nextOf(last, 2), idOf(last, 1), 'after: 2 -> 1 (the arrow really flipped)');

  const refs = rec.events.filter((e) => e.ev === 'line' && e.locals.curr && e.locals.curr['@ref']);
  assert.ok(refs.length > 0, 'locals point INTO the heap via @ref, so pointers can ride the boxes');
});

// Recursion — the call tree that the dedicated recursion tracker records is fully reconstructible
// from call/return events with depth: that is what feeds the recursion-tree lens later.
test('recursion: call/return events carry args, values, and nesting depth', () => {
  const code = 'def fib(n):\n    if n <= 1:\n        return n\n    return fib(n - 1) + fib(n - 2)';
  const rec = record({ code, entry: 'fib(4)' });

  const calls = rec.events.filter((e) => e.ev === 'call' && e.fn === 'fib');
  const rets = rec.events.filter((e) => e.ev === 'return' && e.fn === 'fib');
  assert.equal(calls.length, 9, 'fib(4) really makes 9 calls');
  assert.equal(rets.length, 9, 'every call returns');
  assert.deepEqual(calls[0].args, { n: 4 }, 'arguments are recorded per call');
  assert.ok(calls.some((e) => e.depth >= 3), 'depth tracks the real nesting');
  assert.equal(rec.result, 3, 'fib(4) = 3 recorded from the real run');
});

// The cap is a first-class event, never a silent cut (same posture as every tracker).
test('hot loops hit the cap as an explicit truncated sentinel', () => {
  const code = 'def spin():\n    total = 0\n    for i in range(100000):\n        total += i\n    return total';
  const rec = record({ code, entry: 'spin()' });
  assert.equal(rec.events.at(-1).truncated, true, 'the recording says out loud that it stopped');
  assert.ok(rec.events.length <= 1201, 'the cap actually caps (1200 events ≈ a 300-600 step lesson — deep problems NEED that)');
});

test('validateUniversalRecording: malformed recordings fail loudly with the event named', () => {
  assert.throws(() => validateUniversalRecording({ events: [] }), /non-empty events/);
  assert.throws(() => validateUniversalRecording({ events: [{ ev: 'dance', line: 1, fn: 'f', depth: 1 }] }), /event 0.*line\|call\|return/);
  assert.throws(() => validateUniversalRecording({ events: [{ ev: 'line', line: 1, fn: 'f', depth: 1 }] }), /needs a locals object/);
  assert.throws(
    () => validateUniversalRecording({ events: [{ ev: 'line', line: 1, fn: 'f', depth: 1, locals: {}, heap: { 9: {} } }] }),
    /heap object 9 needs its type/,
  );
});
