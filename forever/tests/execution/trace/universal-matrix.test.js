import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { assembleUniversalProgram, parseUniversalEvents, validateUniversalRecording } from '../../../lib/execution/trace/universal/recorder.js';
import { detectAdjacencyMatrix, compileAdjacencyMatrix } from '../../../lib/execution/trace/universal/lenses/adjacency-matrix.js';
import { detectLenses } from '../../../lib/execution/trace/universal/detect.js';

const py = (source) => execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15_000 });
const record = ({ code, entry }) =>
  validateUniversalRecording(parseUniversalEvents(py(assembleUniversalProgram({ code, entry }))));

const PROVINCES = [
  'def provinces(isConnected):',
  '    n = len(isConnected)',
  '    visited = []',
  '    def dfs(i):',
  '        visited.append(i)',
  '        for j in range(n):',
  '            if isConnected[i][j] == 1 and j not in visited:',
  '                dfs(j)',
  '    count = 0',
  '    for i in range(n):',
  '        if i not in visited:',
  '            count += 1',
  '            dfs(i)',
  '    return count',
].join('\n');
const ENTRY = 'provinces([[1, 1, 0], [1, 1, 0], [0, 0, 1]])';

test('LC547 with the REAL matrix input: the graph in disguise gets drawn as nodes and edges', () => {
  const rec = record({ code: PROVINCES, entry: ENTRY });
  const plan = detectAdjacencyMatrix(rec, { code: PROVINCES });
  assert.ok(plan, 'the square static double-subscripted matrix is recognized');
  assert.equal(plan.matrixVar, 'isConnected');
  assert.equal(plan.graph.nodes.length, 3);
  assert.deepEqual(plan.graph.edges.map((e) => `${e.from}>${e.to}`), ['0>1', '1>0'], 'edges where m[i][j] is truthy, self-loops dropped');
  assert.equal(plan.graph.directed, false, 'a symmetric matrix renders undirected');
  assert.equal(plan.roles.current, 'i', 'the widest first-subscript walker');
  assert.equal(plan.roles.visited, 'visited');

  const trace = compileAdjacencyMatrix({ recording: rec, plan, code: PROVINCES, entry: ENTRY });
  assert.equal(trace.views.graph.nodes.length, 3, 'the node-edge picture, not the raw matrix');
  const finalized = trace.steps.at(-1).graph.visited;
  assert.deepEqual(finalized, ['0', '1', '2'], 'the walk finalizes every node in real order');
  assert.match(trace.steps.at(-1).explanation, /2/, 'the real province count reaches the close');

  const plans = detectLenses(rec, { code: PROVINCES });
  assert.equal(plans[0]?.lens, 'adjacency-matrix', 'the graph in disguise outranks the recursion tree');
});

test('the four-way 2D boundary holds: mutating, filling, and unwalked matrices all refuse', () => {
  const oranges = record({
    code: [
      'def rot(grid):',
      '    R, C = len(grid), len(grid[0])',
      '    for r in range(R):',
      '        for c in range(C):',
      '            if grid[r][c] == 1:',
      '                grid[r][c] = 2',
      '    return grid',
    ].join('\n'),
    entry: 'rot([[2, 1], [1, 1]])',
  });
  assert.equal(detectAdjacencyMatrix(oranges, { code: 'grid[r][c]' }), null, 'a matrix that MUTATES is a grid, not a graph');

  const unwalked = record({
    code: 'def total(m):\n    s = 0\n    for r in range(len(m)):\n        for c in range(len(m)):\n            s += m[r][c]\n    return s',
    entry: 'total([[0, 1], [1, 0]])',
  });
  assert.equal(detectAdjacencyMatrix(unwalked, { code: 'm[r][c]' }), null, 'a matrix nobody walks (no visited, no node-bounded walker... just counters) is data');
});
