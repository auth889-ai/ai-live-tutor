import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { dryRunQualityIssue } from '../../../lib/orchestration/agents/coding/execution-tracer.js';
import { assembleUniversalProgram, parseUniversalEvents, validateUniversalRecording } from '../../../lib/execution/trace/universal/recorder.js';
import { detectGridWalk, compileGridWalk } from '../../../lib/execution/trace/universal/lenses/grid-walk.js';
import { detectLenses } from '../../../lib/execution/trace/universal/detect.js';

const py = (source) => execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15_000 });
const record = ({ code, entry }) =>
  validateUniversalRecording(parseUniversalEvents(py(assembleUniversalProgram({ code, entry }))));

// Rotten Oranges (Striver G-10) — the multi-lens bar: grid + queue + round counter, one run.
const ORANGES = [
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
const ORANGES_ENTRY = 'orangesRotting([[2,1,1],[1,1,0],[0,1,1]])';

test('detectGridWalk: finds the grid, the coordinate queue, and the round counter — blind', () => {
  const rec = record({ code: ORANGES, entry: ORANGES_ENTRY });
  const plan = detectGridWalk(rec, { code: ORANGES });
  assert.ok(plan, 'the family is recognized from the recording alone');
  assert.equal(plan.grid.name, 'grid');
  assert.deepEqual([plan.grid.rows, plan.grid.cols], [3, 3]);
  assert.deepEqual(plan.queue, { name: 'q', kind: 'queue' }, 'popleft in the code marks q as FIFO');
  assert.ok(plan.counters.includes('minutes'), 'minutes only ever ticks up -> a round counter');
  assert.ok(!plan.counters.includes('r') && !plan.counters.includes('nr'), 'grid indices are NOT counters');
  assert.equal(plan.confidence, 0.9);
});

test('detectGridWalk says NO honestly: recursion, 1D arrays, and static grids are not grid walks', () => {
  const fib = record({ code: 'def fib(n):\n    if n <= 1:\n        return n\n    return fib(n - 1) + fib(n - 2)', entry: 'fib(4)' });
  assert.equal(detectGridWalk(fib, { code: '' }), null, 'no 2D structure -> null');

  const search = record({
    code: 'def linear_search(arr, target):\n    for i in range(len(arr)):\n        if arr[i] == target:\n            return i\n    return -1',
    entry: 'linear_search([4, 7, 9], 9)',
  });
  assert.equal(detectGridWalk(search, { code: '' }), null, 'a 1D array -> null');

  const readOnly = record({
    code: 'def count_ones(grid):\n    total = 0\n    for row in grid:\n        for v in row:\n            if v == 1:\n                total += 1\n    return total',
    entry: 'count_ones([[1,0,1],[0,1,1]])',
  });
  assert.equal(detectGridWalk(readOnly, { code: '' }), null, 'a grid nobody writes to is scenery, not a walk');
});

test('compileGridWalk: a validated multi-panel trace — board + queue + variables on EVERY step', () => {
  const rec = record({ code: ORANGES, entry: ORANGES_ENTRY });
  const plan = detectGridWalk(rec, { code: ORANGES });
  const trace = compileGridWalk({ recording: rec, plan, code: ORANGES, entry: ORANGES_ENTRY });

  assert.deepEqual(trace.views.array2d, { rows: 3, cols: 3 }, 'the lens is declared once and never flickers');
  assert.ok(trace.steps.length >= 15 && trace.steps.length <= 60, `logical steps, not raw events (got ${trace.steps.length})`);
  assert.ok(trace.steps.every((s) => s.array2d && Array.isArray(s.queue) && s.variables), 'every step drives all three panels in sync');

  assert.match(trace.steps[0].explanation, /3×3 grid.*queue of coordinates.*`minutes` counting/s, 'the opening frames what to watch');
  const write = trace.steps.find((s) => /changes from 1 to 2/.test(s.explanation));
  assert.ok(write, 'cell rewrites are narrated with the REAL old -> new values');
  assert.deepEqual(write.array2d.current, [1, 0], 'the changed cell is the highlighted current cell');
  const pop = trace.steps.find((s) => /leaves the front of the queue/.test(s.explanation));
  assert.ok(pop, 'dequeues are narrated as the rhythm of the walk');
  const round = trace.steps.find((s) => /`minutes` ticks up to 1/.test(s.explanation));
  assert.ok(round, 'the round counter is narrated as a level boundary');
  assert.match(trace.steps.at(-1).explanation, /returns 4/, 'the closing step carries the real answer');

  const finalCells = Object.fromEntries(trace.steps.at(-1).array2d.values.map(([r, c, v]) => [`${r},${c}`, v]));
  assert.equal(finalCells['2,2'], 2, 'the final board state is the fully-rotten real grid');
  assert.equal(finalCells['1,2'], 0, 'the empty cell stayed empty — recorded, not invented');
});

test('the universal-path trace passes the SAME elite gate every hand-built mode must pass', () => {
  const rec = record({ code: ORANGES, entry: ORANGES_ENTRY });
  const plan = detectGridWalk(rec, { code: ORANGES });
  const trace = compileGridWalk({ recording: rec, plan, code: ORANGES, entry: ORANGES_ENTRY });
  const issue = dryRunQualityIssue({
    steps: trace.steps,
    directive: 'Rotten Oranges: multi-source BFS flood over the grid using a queue',
    code: ORANGES,
  });
  assert.equal(issue, null, `the gate is clean (got: ${issue})`);
});

test('detectLenses registry: best plan first, carrying its compiler', () => {
  const rec = record({ code: ORANGES, entry: ORANGES_ENTRY });
  const plans = detectLenses(rec, { code: ORANGES });
  assert.equal(plans.length, 1);
  assert.equal(plans[0].lens, 'grid-walk');
  assert.equal(typeof plans[0].compile, 'function');
  assert.deepEqual(detectLenses(record({ code: 'def f(x):\n    return x + 1', entry: 'f(1)' }), { code: '' }), [], 'no family -> empty, honestly');
});
