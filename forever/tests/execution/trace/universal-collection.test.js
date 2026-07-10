import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { assembleUniversalProgram, parseUniversalEvents, validateUniversalRecording } from '../../../lib/execution/trace/universal/recorder.js';
import { detectCollectionLens, compileCollectionOps } from '../../../lib/execution/trace/universal/lenses/collection-ops.js';
import { detectLenses } from '../../../lib/execution/trace/universal/detect.js';

const py = (source) => execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15_000 });
const record = ({ code, entry }) =>
  validateUniversalRecording(parseUniversalEvents(py(assembleUniversalProgram({ code, entry }))));

const VALID_PARENS = [
  'def valid(s):',
  '    st = []',
  '    pairs = {")": "(", "]": "[", "}": "{"}',
  '    for ch in s:',
  '        if ch in pairs:',
  '            if not st or st.pop() != pairs[ch]:',
  '                return False',
  '        else:',
  '            st.append(ch)',
  '    return len(st) == 0',
].join('\n');

test('Valid Parentheses: the stack IS the story — detected, compiled, narrated per op', () => {
  const rec = record({ code: VALID_PARENS, entry: 'valid("([])")' });
  const plan = detectCollectionLens(rec);
  assert.ok(plan, 'the clean LIFO discipline is recognized');
  assert.equal(plan.structure, 'stack');
  assert.equal(plan.varName, 'st');
  assert.equal(plan.ops.length, 4, 'push ( push [ pop pop — recorded, not guessed');

  const trace = compileCollectionOps({ recording: rec, plan, code: VALID_PARENS });
  assert.ok(trace.views.array.values.length >= 2, 'slot row sized by the real high-water mark');
  assert.ok(trace.steps.every((s) => Array.isArray(s.stack)), 'the live stack rides every step');
  assert.match(trace.steps[0].explanation, /push/i, 'ops are narrated as operations');
  const pop = trace.steps.find((s) => /pop/i.test(s.explanation));
  assert.ok(pop, 'pops are their own steps');

  const plans = detectLenses(rec, { code: VALID_PARENS });
  assert.equal(plans[0]?.lens, 'collection-ops', 'no structural lens competes here — the stack wins');
});

test('frequency counter: a growing string-keyed dict becomes the hash-map bucket view', () => {
  const code = [
    'def freq(s):',
    '    counts = {}',
    '    for ch in s:',
    '        if ch in counts:',
    '            counts[ch] = counts[ch] + 1',
    '        else:',
    '            counts[ch] = 1',
    '    return counts',
  ].join('\n');
  const rec = record({ code, entry: 'freq("abcab")' });
  const plan = detectCollectionLens(rec);
  assert.ok(plan, 'the growing dict is recognized');
  assert.equal(plan.structure, 'hash_map');

  const trace = compileCollectionOps({ recording: rec, plan, code });
  assert.ok(trace.views.array2d.rows >= 2, 'buckets render as the grid');
  const update = trace.steps.find((s) => /already lives|updates|overwrit/i.test(s.explanation));
  assert.ok(update, 'the second put of an existing key narrates as an update, not an insert');
});

test('priority holds: boards and trees keep their lenses even when a clean collection rides along', () => {
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
  const plans = detectLenses(record({ code: oranges, entry: 'rot([[2,1],[1,1]])' }), { code: oranges });
  assert.equal(plans[0]?.lens, 'grid-walk', 'the board outranks the queue it uses');
  assert.ok(plans.some((p) => p.lens === 'collection-ops'), 'the queue is still detected as a runner-up lens');

  const kadane = record({
    code: 'def kad(arr):\n    best = arr[0]\n    cur = arr[0]\n    for i in range(1, len(arr)):\n        cur = max(arr[i], cur + arr[i])\n        best = max(best, cur)\n    return best',
    entry: 'kad([-2,1,-3,4])',
  });
  assert.equal(detectCollectionLens(kadane), null, 'no collection discipline -> null, honestly');
});
