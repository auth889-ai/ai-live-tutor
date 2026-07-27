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

test('dpvis step model end-to-end: LCS write steps carry recorded reads, max writes name their chosen winner, phases sequence base -> fill -> answer', () => {
  // "aab"/"ab" writes DISTINCT values (1 and 2) — a constant-output run would rightly refuse
  // value-flow narration (the informative guard), which is its own adversarial test below.
  const rec = record({ code: LCS, entry: 'lcs("aab", "ab")' });
  const plan = detectDpTable(rec);
  const trace = compileDpTableLens({ recording: rec, plan, code: LCS, entry: 'lcs("aab", "ab")' });

  const withReads = trace.steps.filter((s) => Array.isArray(s.reads) && s.reads.length > 0);
  assert.ok(withReads.length >= 2, 'interior writes carry non-empty recorded reads');
  // Every emitted read is a REAL recorded dp subscript read — nothing invented.
  const recorded = new Set(rec.reads.filter((x) => x.n === 'dp' && x.p.length === 2).map((x) => `${x.p[0]},${x.p[1]}`));
  for (const s of withReads) for (const [a, b] of s.reads) assert.ok(recorded.has(`${a},${b}`), `read [${a},${b}] exists in the recording`);
  assert.ok(withReads.every((s) => s.phase === 'fill'), 'steps with reads are fill phase');

  // max(dp[i-1][j], dp[i][j-1]) executed for real -> chosen names the winner, a subset of reads.
  const chosenStep = trace.steps.find((s) => Array.isArray(s.chosen) && s.chosen.length > 0);
  assert.ok(chosenStep, 'a max write carries chosen (from the RECORDED max op)');
  for (const [a, b] of chosenStep.chosen) {
    assert.ok(chosenStep.reads.some(([rr, cc]) => rr === a && cc === b), 'chosen is a subset of that step\'s reads');
  }
  assert.match(chosenStep.explanation, /take the best among them/, 'Striver grammar on the max write');

  // Striver cell-fill grammar, filled from recorded facts only.
  assert.match(withReads[0].explanation, /To fill dp\[\d+\]\[\d+\] we look at .*So dp\[\d+\]\[\d+\] = /s);
  assert.equal(trace.steps.find((s) => /scaffold/.test(s.explanation))?.phase, 'base', 'the creation beat is base');
  assert.equal(trace.steps.at(-1).phase, 'answer', 'the terminal read-out is answer');
});

test('ADVERSARIAL end-to-end: strip the recorded reads -> every emitted dependency is EMPTY (arrows are never fabricated)', () => {
  const rec = record({ code: LCS, entry: 'lcs("ab", "ba")' });
  const plan = detectDpTable(rec); // plan from the full recording; compile from crippled ones

  // Variant A: reads infrastructure PRESENT but carrying nothing — provenance mode must
  // emit empty reads, no chosen, no highlights, even though the arithmetic would "match".
  const emptied = { ...rec, reads: [], writes: rec.writes.map((w) => ({ ...w, rhs: [], ops: [] })) };
  const traceA = compileDpTableLens({ recording: emptied, plan, code: LCS, entry: 'lcs("ab", "ba")' });
  for (const s of traceA.steps) {
    assert.ok(!Array.isArray(s.reads) || s.reads.length === 0, 'reads stay EMPTY without recorded reads');
    assert.equal(s.chosen, undefined, 'no chosen without a recorded max/min op');
    assert.equal(s.array2d?.highlight, undefined, 'no dependency arrows without recorded reads');
  }

  // Variant B: no reads/writes arrays at all (legacy recording) — the new provenance fields
  // must be ABSENT (undefined), never invented from formulas.
  const legacy = { ...rec };
  delete legacy.reads;
  delete legacy.writes;
  const traceB = compileDpTableLens({ recording: legacy, plan, code: LCS, entry: 'lcs("ab", "ba")' });
  for (const s of traceB.steps) {
    assert.equal(s.reads, undefined, 'a legacy recording emits NO reads field at all');
    assert.equal(s.chosen, undefined, 'and no chosen');
  }
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
