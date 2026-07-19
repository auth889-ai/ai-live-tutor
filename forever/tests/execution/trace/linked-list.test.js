import assert from 'node:assert/strict';
import test from 'node:test';

import { compileLinkedListTrace } from '../../../lib/execution/trace/linked-list/compiler.js';
import { assembleListProgram, parseListEvents } from '../../../lib/execution/trace/linked-list/tracker.js';

const CODE = 'class Node:\n    def __init__(self, val):\n        self.val = val\n        self.next = None\ndef reverse(head):\n    prev = None\n    curr = head\n    while curr:\n        nxt = curr.next\n        curr.next = prev\n        prev = curr\n        curr = nxt\n    return prev';

// Real tracker-shaped events of reverse() on 1 -> 2 -> 3: prev/curr walk, arrows flip one by one.
const EVENTS = [
  { line: 6, state: { pointers: { head: 'n1' }, nodes: { n1: { value: 1, next: 'n2' }, n2: { value: 2, next: 'n3' }, n3: { value: 3, next: null } } }, variables: {} },
  { line: 8, state: { pointers: { head: 'n1', prev: null, curr: 'n1' }, nodes: { n1: { value: 1, next: 'n2' }, n2: { value: 2, next: 'n3' }, n3: { value: 3, next: null } } }, variables: {} },
  { line: 10, state: { pointers: { head: 'n1', prev: null, curr: 'n1', nxt: 'n2' }, nodes: { n1: { value: 1, next: 'n2' }, n2: { value: 2, next: 'n3' }, n3: { value: 3, next: null } } }, variables: {} },
  // curr.next = prev  ->  n1's arrow is CUT (points at None); n2/n3 now reachable only via nxt.
  { line: 11, state: { pointers: { head: 'n1', prev: null, curr: 'n1', nxt: 'n2' }, nodes: { n1: { value: 1, next: null }, n2: { value: 2, next: 'n3' }, n3: { value: 3, next: null } } }, variables: {} },
  { line: 8, state: { pointers: { head: 'n1', prev: 'n1', curr: 'n2', nxt: 'n2' }, nodes: { n1: { value: 1, next: null }, n2: { value: 2, next: 'n3' }, n3: { value: 3, next: null } } }, variables: {} },
  // n2's arrow FLIPS from n3 back to n1 — the reversal moment.
  { line: 11, state: { pointers: { head: 'n1', prev: 'n1', curr: 'n2', nxt: 'n3' }, nodes: { n1: { value: 1, next: null }, n2: { value: 2, next: 'n1' }, n3: { value: 3, next: null } } }, variables: {} },
  { line: 8, state: { pointers: { head: 'n1', prev: 'n2', curr: 'n3', nxt: 'n3' }, nodes: { n1: { value: 1, next: null }, n2: { value: 2, next: 'n1' }, n3: { value: 3, next: null } } }, variables: {} },
  { line: 11, state: { pointers: { head: 'n1', prev: 'n2', curr: 'n3', nxt: null }, nodes: { n1: { value: 1, next: null }, n2: { value: 2, next: 'n1' }, n3: { value: 3, next: 'n2' } } }, variables: {} },
  { line: 13, state: { pointers: { head: 'n1', prev: 'n3', curr: null, nxt: null }, nodes: { n1: { value: 1, next: null }, n2: { value: 2, next: 'n1' }, n3: { value: 3, next: 'n2' } } }, variables: {} },
];

test('reversal through the lens: pointers walk, arrows flip, boxes never move', () => {
  const trace = compileLinkedListTrace({
    events: EVENTS, result: 'n3', code: CODE, entry: 'reverse(build([1,2,3]))',
  });

  assert.match(trace.steps[0].explanation, /We run reverse.*Boxes never move/s, 'frame beat first');

  // POSITIONAL INVARIANCE: node order in every step is first-appearance order, n1 n2 n3.
  for (const s of trace.steps) {
    if (s.list?.nodes?.length === 3) assert.deepEqual(s.list.nodes.map((n) => n.id), ['n1', 'n2', 'n3']);
  }

  // The rewire beats: the cut, then the flip — narrated with real values, marked on the node.
  const cut = trace.steps.find((s) => /arrow out of the node holding 1 is CUT/.test(s.explanation));
  assert.ok(cut, 'the first reversal write (curr.next = None) is its own beat');
  assert.ok(cut.list.nodes.find((n) => n.id === 'n1').rewired, 'the rewired node is marked for the flash');

  const flip = trace.steps.find((s) => /REWIRE: the arrow out of the node holding 2 flips from the node holding 3 to the node holding 1/.test(s.explanation));
  assert.ok(flip, 'the flip is narrated old -> new with real values');
  assert.equal(flip.list.nodes.find((n) => n.id === 'n2').next, 'n1', 'the arrow now points backward');

  // Pointer walk narrated, including walking off the end.
  assert.ok(trace.steps.some((s) => /curr advances to the node holding 2/.test(s.explanation)));
  assert.ok(trace.steps.some((s) => /curr is now None.*null-checks/s.test(s.explanation)));

  // Terminal beat reads the FINAL chain off the arrows: 3 -> 2 -> 1.
  assert.match(trace.steps.at(-1).explanation, /3 → 2 → 1.*rewired in front of you/s);

  for (const s of trace.steps) assert.ok(s.explanation.length > 60, 'tutor voice, never stubs');
});

test('detach: a node that becomes unreachable is taught as the garbage moment', () => {
  const trace = compileLinkedListTrace({
    events: [
      { line: 2, state: { pointers: { head: 'n1' }, nodes: { n1: { value: 1, next: 'n2' }, n2: { value: 2, next: null } } }, variables: {} },
      // head.next = None — n2 vanishes from every root's chain.
      { line: 3, state: { pointers: { head: 'n1' }, nodes: { n1: { value: 1, next: null } } }, variables: {} },
    ],
    result: null, code: 'a\nb\nc',
  });
  const detach = trace.steps.find((s) => /node holding 2 is now UNREACHABLE.*memory leak/s.test(s.explanation));
  assert.ok(detach, 'the orphan moment is narrated');
  const orphan = detach.list.nodes.find((n) => n.id === 'n2');
  assert.ok(orphan.orphan, 'the orphan stays visible (faded), it does not vanish');
  assert.equal(orphan.value, 2, 'the orphan keeps its last real state');
});

test('harness assembly is hardened: roots/attrs validated, entry must be one expression', () => {
  const ok = assembleListProgram({ code: 'def f():\n    return None', entry: 'f()', roots: ['head', 'curr'] });
  assert.ok(ok.includes('ROOTS = ["head", "curr"]'));
  assert.ok(ok.includes("compile(_maybe_tree, '<student>', 'exec')"), 'student code traced under its own filename');
  assert.throws(() => assembleListProgram({ code: 'x', entry: 'f();g()', roots: ['head'] }), /single expression/);
  assert.throws(() => assembleListProgram({ code: 'x', entry: 'f()', roots: [] }), /pointer root names/);
  assert.throws(() => assembleListProgram({ code: 'x', entry: 'f()', roots: ['he ad'] }), /pointer root names/);
  assert.throws(() => assembleListProgram({ code: 'x', entry: 'f()', roots: ['head'], nextAttr: 'a.b' }), /simple identifiers/);
});

test('honest failures: no events, junk stdout, no chain activity', () => {
  assert.throws(() => compileLinkedListTrace({ events: [], result: 1, code: 'x' }), /no events/);
  assert.equal(parseListEvents('no marker here'), null);
  assert.throws(
    () => compileLinkedListTrace({ events: [{ line: 99, state: { pointers: {}, nodes: {} }, variables: {} }], result: 1, code: 'a\nb' }),
    /no chain activity/,
  );
});
