// The brpapa-grade call-lifecycle step model + choose→recurse→undo detection, verified on
// REAL runs (same fixture style as universal-recursion.test.js): every claim below is about
// fields the compiler may only fill from recorded events — callId/parentCallId/args/phase/
// returned/stackDepth on every step, explicit backtrack beats with recorded before/after
// state, and the hard law that edges exist only for proven caller→callee pairs.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { assembleUniversalProgram, parseUniversalEvents, validateUniversalRecording } from '../../../lib/execution/trace/universal/recorder.js';
import { detectRecursionTree, compileRecursionTree } from '../../../lib/execution/trace/universal/lenses/recursion-tree.js';
import { buildTreeFromEvents } from '../../../vendor/recursion-tree-visualizer/tree-builder.js';

const py = (source) => execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15_000 });
const record = ({ code, entry }) =>
  validateUniversalRecording(parseUniversalEvents(py(assembleUniversalProgram({ code, entry }))));
const compile = ({ code, entry }) => {
  const rec = record({ code, entry });
  const plan = detectRecursionTree(rec);
  assert.ok(plan, 'recursion detected');
  return compileRecursionTree({ recording: rec, plan, code });
};

const FIB = 'def fib(n):\n    if n <= 1:\n        return n\n    return fib(n - 1) + fib(n - 2)';

const SUBSETS = `def subsets(nums):
    result = []
    path = []

    def search(index):
        result.append(path[:])
        for i in range(index, len(nums)):
            path.append(nums[i])
            search(i + 1)
            path.pop()

    search(0)
    return result`;

test('every step carries the call-lifecycle fields, all provable from the recording', () => {
  const trace = compile({ code: FIB, entry: 'fib(4)' });

  const PHASES = new Set(['enter', 'compute', 'return', 'backtrack']);
  const nodeIds = new Set(trace.views.graph.nodes.map((n) => n.id));
  for (const s of trace.steps) {
    assert.equal(typeof s.callId, 'string', 'every step names its call');
    assert.ok(nodeIds.has(s.callId), 'callId is a real vertex of the declared tree');
    assert.ok(PHASES.has(s.phase), `phase is from the closed call vocabulary (got ${s.phase})`);
    assert.ok(Array.isArray(s.args), 'every step carries the recorded args of its call');
    assert.ok(Number.isInteger(s.stackDepth) && s.stackDepth >= 0, 'stackDepth is the live call-path depth');
  }

  // The root enters with no parent; descents name their parent; returns carry the value.
  assert.equal(trace.steps[0].phase, 'enter');
  assert.equal(trace.steps[0].parentCallId, null);
  assert.equal(trace.steps[0].stackDepth, 1);
  const descents = trace.steps.filter((s) => s.phase === 'enter' && s.parentCallId !== null);
  assert.ok(descents.length >= 8, 'fib(4) descends into 8 child calls');
  const computes = trace.steps.filter((s) => s.phase === 'compute');
  assert.ok(computes.length > 0 && computes.every((s) => s.returned !== undefined), 'compute steps carry the recorded returned value');
  const leafReturns = trace.steps.filter((s) => s.phase === 'return');
  assert.ok(leafReturns.every((s) => s.returned !== undefined), 'return steps carry the recorded returned value');

  // HARD LAW: parentCallId only along DECLARED edges (which exist only for recorded
  // caller→callee pairs) — never an invented relationship.
  const edgeSet = new Set(trace.views.graph.edges.map((e) => `${e.from}>${e.to}`));
  for (const s of descents) assert.ok(edgeSet.has(`${s.parentCallId}>${s.callId}`), `enter edge ${s.parentCallId}->${s.callId} is declared`);

  // Plain recursion has no proven undo — no backtrack beat may appear.
  assert.equal(trace.steps.filter((s) => s.phase === 'backtrack').length, 0, 'fib mutates nothing — no backtrack steps');

  // Vendored Reingold-Tilford layout rides along as optional node coordinates.
  assert.ok(trace.views.graph.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)), 'every node carries reference layout coords');
});

test('choose→recurse→undo is detected from recorded collection ops, with both states shown', () => {
  const trace = compile({ code: SUBSETS, entry: 'subsets([1, 2, 3])' });

  const undos = trace.steps.filter((s) => s.phase === 'backtrack');
  assert.equal(undos.length, 7, 'subsets([1,2,3]) makes 7 picks and undoes every one');
  for (const s of undos) {
    assert.equal(s.undo.name, 'path', 'the undone collection is named from the recorded op');
    assert.ok(Array.isArray(s.undo.stateBefore) && Array.isArray(s.undo.stateAfter), 'both states are recorded, not reconstructed');
    assert.equal(s.undo.stateBefore.length, s.undo.stateAfter.length + 1, 'the undo removes exactly one element');
    assert.deepEqual(s.undo.stateBefore.at(-1), s.undo.value, 'the removed value is the chosen value');
    assert.deepEqual(s.undo.stateBefore.slice(0, -1), s.undo.stateAfter, 'the state is restored to exactly the pre-pick state');
    assert.match(s.explanation, /backtrack.*remove/i, 'the undo is narrated in the mined grammar');
  }

  // The matching choose narrates the pick on the descent into that child.
  const pickEnters = trace.steps.filter((s) => s.phase === 'enter' && /picks/.test(s.explanation));
  assert.equal(pickEnters.length, 7, 'every proven choose narrates its pick');
});

test('a mutation that is NOT reverted is never claimed as backtracking', () => {
  // An accumulator grows across the recursion and stays grown — append with no pop.
  const code = [
    'def collect(i, acc):',
    '    if i == 0:',
    '        return acc',
    '    acc.append(i)',
    '    collect(i - 1, acc)',
    '    return acc',
  ].join('\n');
  const trace = compile({ code, entry: 'collect(4, [])' });
  assert.equal(trace.steps.filter((s) => s.phase === 'backtrack').length, 0, 'no recorded inverse op -> no backtrack claim');
});

test('N-Queens: every placement is undone, and the undo states are board rows', () => {
  const code = `def solve(n):
    cols = set()
    d1 = set()
    d2 = set()
    placed = []
    found = []

    def place(r):
        if r == n:
            found.append(list(placed))
            return
        for c in range(n):
            if c in cols or (r + c) in d1 or (r - c) in d2:
                continue
            cols.add(c)
            d1.add(r + c)
            d2.add(r - c)
            placed.append(c)
            place(r + 1)
            placed.pop()
            cols.remove(c)
            d1.remove(r + c)
            d2.remove(r - c)

    place(0)
    return len(found)`;
  const trace = compile({ code, entry: 'solve(4)' });
  const undos = trace.steps.filter((s) => s.phase === 'backtrack');
  assert.ok(undos.length >= 10, `4-queens explores and retracts many placements (got ${undos.length})`);
  assert.ok(undos.every((s) => s.undo.name === 'placed'), 'the narrated collection is the queen path');
  assert.ok(undos.every((s) => Number.isInteger(s.undo.value)), 'each undo names the recorded column it removes');
});

test('vendored builder: edges only for recorded caller→callee pairs, helper calls excluded', () => {
  // The recursive fn calls a NON-recursive helper before recursing; the helper's frames are
  // recorded too, but the tree may only link fnName calls that nested inside fnName calls.
  const code = [
    'def double(x):',
    '    return 2 * x',
    'def walk(n):',
    '    if n == 0:',
    '        return 0',
    '    d = double(n)',
    '    return d + walk(n - 1)',
  ].join('\n');
  const rec = record({ code, entry: 'walk(3)' });
  const built = buildTreeFromEvents({ events: rec.events, fnName: 'walk', result: rec.result });

  assert.equal(Object.keys(built.vertices).length, 4, 'walk(3) opens exactly 4 walk frames — helper frames mint no vertex');
  const edges = Object.values(built.vertices).flatMap((v) => v.adjList);
  assert.equal(edges.length, 3, 'exactly one edge per real recursive descent');
  for (const [id, v] of Object.entries(built.vertices)) {
    for (const a of v.adjList) {
      assert.ok(built.callEventIndex.get(a.childId) > built.callEventIndex.get(Number(id)), `child ${a.childId} opened after parent ${id}`);
      assert.ok(built.returnEventIndex.get(a.childId) < built.returnEventIndex.get(Number(id)), `child ${a.childId} closed before parent ${id}`);
    }
  }
  assert.equal(built.openIds.length, 0, 'a finished run leaves no call open');
});
