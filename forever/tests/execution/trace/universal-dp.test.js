import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { assembleUniversalProgram, parseUniversalEvents, validateUniversalRecording } from '../../../lib/execution/trace/universal/recorder.js';
import { detectDpTable, compileDpTableLens } from '../../../lib/execution/trace/universal/lenses/dp-table.js';
import { detectLenses } from '../../../lib/execution/trace/universal/detect.js';

const py = (source) => execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15_000 });
const record = ({ code, entry }) =>
  validateUniversalRecording(parseUniversalEvents(py(assembleUniversalProgram({ code, entry }))));

const LCS = [
  'def lcs(a, b):',
  '    dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]',
  '    for i in range(1, len(a) + 1):',
  '        for j in range(1, len(b) + 1):',
  '            if a[i-1] == b[j-1]:',
  '                dp[i][j] = dp[i-1][j-1] + 1',
  '            else:',
  '                dp[i][j] = max(dp[i-1][j], dp[i][j-1])',
  '    return dp[len(a)][len(b)]',
].join('\n');

test('LCS: three fingerprints (scaffold, sweep, no frontier) say FILL — dp-table claims it over grid-walk', () => {
  const rec = record({ code: LCS, entry: 'lcs("ab", "ba")' });
  const plan = detectDpTable(rec);
  assert.ok(plan, 'the fill is recognized');
  assert.equal(plan.name, 'dp');
  assert.deepEqual([plan.rows, plan.cols], [3, 3]);

  const plans = detectLenses(rec, { code: LCS });
  assert.equal(plans[0]?.lens, 'dp-table', 'dp-table outranks grid-walk on a fill');
  assert.ok(plans.some((p) => p.lens === 'grid-walk'), 'grid-walk still fires as runner-up — the data is 2D either way');

  const trace = compileDpTableLens({ recording: rec, plan, code: LCS, entry: 'lcs("ab", "ba")' });
  assert.deepEqual(trace.views.array2d, { rows: 3, cols: 3 });
  assert.match(trace.steps[1]?.explanation ?? trace.steps[0].explanation, /scaffold|table|creat/i, 'the init beat frames the empty table');
  const write = trace.steps.find((s) => s.array2d?.current && /dp\[|cell|\(1, 1\)|row 1/i.test(s.explanation));
  assert.ok(write, 'cell writes are narrated as their own moments');
  assert.match(trace.steps.at(-1).explanation, /1/, 'the real answer (LCS length 1... reaches the close');
});

test('Pascal-style GROWING table (rows appended) is a fill too', () => {
  const code = [
    'def pascal(n):',
    '    tri = []',
    '    for r in range(n):',
    '        row = [1] * (r + 1)',
    '        for c in range(1, r):',
    '            row[c] = tri[r-1][c-1] + tri[r-1][c]',
    '        tri.append(row)',
    '    return tri',
  ].join('\n');
  const rec = record({ code, entry: 'pascal(4)' });
  const plan = detectDpTable(rec);
  assert.ok(plan, 'a growing table is recognized');
  assert.equal(plan.name, 'tri');
  const trace = compileDpTableLens({ recording: rec, plan, code, entry: 'pascal(4)' });
  assert.equal(trace.views.array2d.rows, 4, 'the view sizes to the FINAL dimensions');
});

test('refusals keep the boundary honest: walked grids and frontier-driven fills stay with grid-walk', () => {
  const oranges = [
    'from collections import deque',
    'def rot(grid):',
    '    R, C = len(grid), len(grid[0])',
    '    q = deque()',
    '    for r in range(R):',
    '        for c in range(C):',
    '            if grid[r][c] == 2:',
    '                q.append((r, c))',
    '    while q:',
    '        r, c = q.popleft()',
    '        for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):',
    '            nr, nc = r + dr, c + dc',
    '            if 0 <= nr < R and 0 <= nc < C and grid[nr][nc] == 1:',
    '                grid[nr][nc] = 2',
    '                q.append((nr, nc))',
    '    return grid',
  ].join('\n');
  const rec = record({ code: oranges, entry: 'rot([[2,1],[1,1]])' });
  assert.equal(detectDpTable(rec), null, 'meaningful input + neighborhood order + frontier -> not a fill');
  assert.equal(detectLenses(rec, { code: oranges })[0]?.lens, 'grid-walk', 'the board keeps it');

  // 0/1-Matrix-style: the dist table STARTS as scaffold and fills — but a frontier queue
  // chooses the order, so fingerprint 3 refuses and the walk keeps the run.
  const distBfs = [
    'from collections import deque',
    'def dist01(grid):',
    '    R, C = len(grid), len(grid[0])',
    '    dist = [[-1] * C for _ in range(R)]',
    '    q = deque()',
    '    for r in range(R):',
    '        for c in range(C):',
    '            if grid[r][c] == 0:',
    '                dist[r][c] = 0',
    '                q.append((r, c))',
    '    while q:',
    '        r, c = q.popleft()',
    '        for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):',
    '            nr, nc = r + dr, c + dc',
    '            if 0 <= nr < R and 0 <= nc < C and dist[nr][nc] == -1:',
    '                dist[nr][nc] = dist[r][c] + 1',
    '                q.append((nr, nc))',
    '    return dist',
  ].join('\n');
  const rec2 = record({ code: distBfs, entry: 'dist01([[0,1],[1,1]])' });
  assert.equal(detectDpTable(rec2), null, 'a frontier-driven fill belongs to the walk, not the sweep');
});
