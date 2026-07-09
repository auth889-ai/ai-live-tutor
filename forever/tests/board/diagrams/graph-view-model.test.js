import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTraceStep, nodeStatus, edgeStatus, isGhostNode } from '../../../lib/board/diagrams/graph-view-model.js';

// A small BFS-shaped trace: A -> B, A -> C, C -> D. Each step marks a current node, growing visited.
const BFS = {
  trace: [
    { current: 'A', visited: [] },
    { current: 'B', visited: ['A'], activeEdge: ['A', 'B'] },
    { current: 'C', visited: ['A', 'B'], activeEdge: ['A', 'C'] },
    { current: 'D', visited: ['A', 'B', 'C'], activeEdge: ['C', 'D'] },
  ],
};

test('resolveTraceStep: activeStep picks the exact step; visited accumulates; current excluded from visited', () => {
  const s = resolveTraceStep({ content: BFS, activeStep: 2 });
  assert.equal(s.current, 'C');
  assert.equal(s.stepNum, 3);
  assert.equal(s.stepTotal, 4);
  assert.ok(s.visited.has('A') && s.visited.has('B'), 'earlier currents are visited');
  assert.ok(!s.visited.has('C'), 'the current node is not also visited');
  assert.deepEqual(s.activeEdge, ['A', 'C']);
});

test('resolveTraceStep: progress maps to a step when no explicit activeStep', () => {
  assert.equal(resolveTraceStep({ content: BFS, progress: 0 }).current, 'A');
  assert.equal(resolveTraceStep({ content: BFS, progress: 0.99 }).current, 'D');
});

test('nodeStatus: current/visited/notyet resolve correctly', () => {
  const s = resolveTraceStep({ content: BFS, activeStep: 2 });
  assert.equal(nodeStatus('C', s), 'current');
  assert.equal(nodeStatus('A', s), 'visited');
  assert.equal(nodeStatus('D', s), 'notyet', 'a node not yet reached, in a trace, is notyet');
});

test('edgeStatus: the active edge is traversing; a both-visited edge is active; others idle', () => {
  const s = resolveTraceStep({ content: BFS, activeStep: 2 });
  assert.equal(edgeStatus({ from: 'A', to: 'C' }, s), 'traversing', 'the edge walked this step');
  assert.equal(edgeStatus({ from: 'A', to: 'B' }, s), 'active', 'both endpoints visited');
  assert.equal(edgeStatus({ from: 'C', to: 'D' }, s), 'active', 'touches current C');
});

// A recursion-style trace with growth (revealed), memo hits, returned values, pointers.
const REC = {
  trace: [
    { current: 'r', revealed: ['r'], memo: [], returned: {}, pointers: { call: 'r' } },
    { current: 'a', revealed: ['r', 'a'], memo: [], returned: {}, activeEdge: ['r', 'a'], pointers: { call: 'a' } },
    { current: 'r', revealed: ['r', 'a', 'b'], memo: ['b'], returned: { a: 3 }, pointers: { call: 'r' } },
  ],
};

test('ghost + memo + pointer-on-current dropped', () => {
  const s = resolveTraceStep({ content: REC, activeStep: 0 });
  // b exists in the final tree but is NOT revealed at step 0 -> ghost.
  assert.ok(isGhostNode('b', s), 'unrevealed node is a ghost');
  assert.equal(nodeStatus('b', s), 'ghost');
  assert.equal(nodeStatus('r', s), 'current');
  // The pointer {call: 'r'} sits on the current node -> dropped (redundant with the highlight).
  assert.equal(s.pointerAt.size, 0, 'a pointer on the current node is not drawn');

  const s2 = resolveTraceStep({ content: REC, activeStep: 2 });
  assert.equal(nodeStatus('b', s2), 'memoized', 'a memo hit is purple, not visited');
  assert.deepEqual(s2.returned, { a: 3 }, 'returned values ride through');
});

test('edge into an unrevealed node is a ghost edge', () => {
  const s = resolveTraceStep({ content: REC, activeStep: 0 });
  assert.equal(edgeStatus({ from: 'r', to: 'a' }, s), 'ghost', 'a is not revealed at step 0');
});

test('no-trace fallbacks: highlightSequence and a single active node', () => {
  const seq = resolveTraceStep({ content: { highlightSequence: ['x', 'y', 'z'] }, progress: 0.7 });
  assert.equal(seq.current, 'y');
  assert.ok(seq.visited.has('x'));
  const one = resolveTraceStep({ content: {}, activeNode: 'q' });
  assert.equal(one.current, 'q');
  assert.equal(nodeStatus('q', one), 'current');
  assert.equal(nodeStatus('other', one), 'plain', 'no trace -> plain diagram, not notyet');
});
