import assert from 'node:assert/strict';
import test from 'node:test';

import { compileTrieTrace } from '../../../lib/execution/trace/trie/compiler.js';
import { assembleTrieProgram, parseTrieEvents } from '../../../lib/execution/trace/trie/tracker.js';

const CODE = 'class TrieNode:\n    def __init__(self):\n        self.children = {}\n        self.is_end = False';

// Real tracker-shaped events: insert "at", then insert "an" (reuses the 'a' node — the fork).
const EVENTS = [
  { line: 2, state: { nodes: { t1: { end: false, children: {} } }, cursor: 't1', cursorName: 'node' }, variables: { word: 'at' } },
  { line: 3, state: { nodes: { t1: { end: false, children: { a: 't2' } }, t2: { end: false, children: {} } }, cursor: 't2', cursorName: 'node' }, variables: { word: 'at', ch: 'a' } },
  { line: 3, state: { nodes: { t1: { end: false, children: { a: 't2' } }, t2: { end: false, children: { t: 't3' } }, t3: { end: false, children: {} } }, cursor: 't3', cursorName: 'node' }, variables: { word: 'at', ch: 't' } },
  { line: 4, state: { nodes: { t1: { end: false, children: { a: 't2' } }, t2: { end: false, children: { t: 't3' } }, t3: { end: true, children: {} } }, cursor: 't3', cursorName: 'node' }, variables: { word: 'at' } },
  // Second insert: "an" — the cursor RETURNS to root, then REUSES the 'a' child.
  { line: 2, state: { nodes: { t1: { end: false, children: { a: 't2' } }, t2: { end: false, children: { t: 't3' } }, t3: { end: true, children: {} } }, cursor: 't1', cursorName: 'node' }, variables: { word: 'an' } },
  { line: 3, state: { nodes: { t1: { end: false, children: { a: 't2' } }, t2: { end: false, children: { t: 't3' } }, t3: { end: true, children: {} } }, cursor: 't2', cursorName: 'node' }, variables: { word: 'an', ch: 'a' } },
  { line: 3, state: { nodes: { t1: { end: false, children: { a: 't2' } }, t2: { end: false, children: { t: 't3', n: 't4' } }, t3: { end: true, children: {} }, t4: { end: false, children: {} } }, cursor: 't4', cursorName: 'node' }, variables: { word: 'an', ch: 'n' } },
  { line: 4, state: { nodes: { t1: { end: false, children: { a: 't2' } }, t2: { end: false, children: { t: 't3', n: 't4' } }, t3: { end: true, children: {} }, t4: { end: true, children: {} } }, cursor: 't4', cursorName: 'node' }, variables: { word: 'an' } },
];

test('insert twice through the lens: create-vs-reuse fork, end flags, shared prefix stored once', () => {
  const trace = compileTrieTrace({ events: EVENTS, result: null, code: CODE, entry: 'demo()' });

  assert.match(trace.steps[0].explanation, /watch the trie build itself.*shared prefixes stored ONCE/s, 'frame beat');

  // The tree view: chars on nodes, root labeled ∅, edges carry the chars alphabetically.
  assert.deepEqual(trace.views.graph.nodes.map((n) => n.label), ['∅', 'a', 't', 'n']);
  assert.deepEqual(trace.views.graph.edges.map((e) => e.label), ['a', 'n', 't'], 'edges sorted per parent, textbook style');

  // CREATE beats narrate the real path down to the new node.
  const createT = trace.steps.find((s) => /branching moment.*'t' edge.*spells 'at'/s.test(s.explanation));
  assert.ok(createT, 'creating the t node names the full prefix "at"');
  assert.deepEqual(createT.activeEdge, ['t2', 't3'], 'the created edge lights up');

  // END-FLAG beat carries the app-vs-apple lesson.
  const flag = trace.steps.find((s) => /end flag flips ON.*classic trap.*'app'.*'apple'/s.test(s.explanation));
  assert.ok(flag, 'the flag flip teaches word-vs-prefix');
  assert.ok(flag.graph.visited.includes('t3'), 'the flagged node is green');

  // REUSE beat: inserting "an" walks the EXISTING 'a' child — nothing created.
  const reuse = trace.steps.find((s) => /'a' already has a child.*Nothing is created.*whole point of a trie/s.test(s.explanation));
  assert.ok(reuse, 'the shared-prefix reuse is its own beat');
  assert.deepEqual(reuse.graph.pointers, { node: 't2' }, "the cursor rides under the student's variable name");

  // Returning to the root is narrated as the O(L) restart.
  assert.ok(trace.steps.some((s) => /returns to the root.*one step per character/s.test(s.explanation)));

  // Terminal read-back lists the stored words from the real final snapshot.
  assert.match(trace.steps.at(-1).explanation, /trie now stores: an, at.*O\(L\)/s);
  for (const s of trace.steps) assert.ok(s.explanation.length > 60, 'tutor voice, never stubs');
});

test('delete: end-flag clears and unused nodes prune (fade back to ghost)', () => {
  const base = { t1: { end: false, children: { a: 't2' } }, t2: { end: false, children: { t: 't3' } }, t3: { end: true, children: {} } };
  const trace = compileTrieTrace({
    events: [
      { line: 2, state: { nodes: base, cursor: 't3', cursorName: 'cur' }, variables: {} },
      { line: 3, state: { nodes: { ...base, t3: { end: false, children: {} } }, cursor: 't3', cursorName: 'cur' }, variables: {} },
      { line: 4, state: { nodes: { t1: { end: false, children: { a: 't2' } }, t2: { end: false, children: {} } }, cursor: 't2', cursorName: 'cur' }, variables: {} },
    ],
    result: true, code: 'a\nb\nc\nd',
  });
  assert.ok(trace.steps.some((s) => /UNMARKING: 'at'.*fades from green/s.test(s.explanation)), 'delete starts as an unmark');
  const prune = trace.steps.find((s) => /serves no one.*link is cut/s.test(s.explanation));
  assert.ok(prune, 'the prune beat fires');
  assert.ok(!prune.graph.revealed.includes('t3'), 'the pruned node fades back to ghost');
});

test('harness assembly is hardened; honest failures reject junk', () => {
  const ok = assembleTrieProgram({ code: 'trie = None\ndef demo():\n    return 1', entry: 'demo()', root: 'trie' });
  assert.ok(ok.includes('ROOT_VAR = "trie"'));
  assert.ok(ok.includes("compile(_maybe_tree, '<student>', 'exec')"));
  assert.throws(() => assembleTrieProgram({ code: 'x', entry: 'a();b()', root: 'trie' }), /single expression/);
  assert.throws(() => assembleTrieProgram({ code: 'x', entry: 'a()', root: 'my trie' }), /simple identifier/);
  assert.equal(parseTrieEvents('junk'), null);
  assert.throws(() => compileTrieTrace({ events: [], result: 1, code: 'x' }), /no events/);
  assert.throws(
    () => compileTrieTrace({ events: [{ line: 99, state: { nodes: {}, cursor: null }, variables: {} }], result: 1, code: 'a\nb' }),
    /no trie activity/,
  );
});
