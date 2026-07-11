import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { assembleUniversalProgram, parseUniversalEvents, validateUniversalRecording } from '../../../lib/execution/trace/universal/recorder.js';
import { detectDivideConquer, compileDivideConquerLens } from '../../../lib/execution/trace/universal/lenses/divide-conquer.js';
import { detectIntervals, compileIntervalsLens } from '../../../lib/execution/trace/universal/lenses/intervals.js';
import { detectLenses } from '../../../lib/execution/trace/universal/detect.js';

const py = (source) => execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15_000 });
const record = ({ code, entry }) =>
  validateUniversalRecording(parseUniversalEvents(py(assembleUniversalProgram({ code, entry }))));

const MERGE_SORT = [
  'def merge_sort(arr, lo, hi):',
  '    if hi - lo <= 1:',
  '        return',
  '    mid = (lo + hi) // 2',
  '    merge_sort(arr, lo, mid)',
  '    merge_sort(arr, mid, hi)',
  '    tmp = []',
  '    i, j = lo, mid',
  '    while i < mid and j < hi:',
  '        if arr[i] <= arr[j]:',
  '            tmp.append(arr[i]); i += 1',
  '        else:',
  '            tmp.append(arr[j]); j += 1',
  '    tmp.extend(arr[i:mid]); tmp.extend(arr[j:hi])',
  '    arr[lo:hi] = tmp',
].join('\n');

test('merge sort: the nested-segments fingerprint claims it — band + segment tree in lock-step', () => {
  const rec = record({ code: MERGE_SORT, entry: 'merge_sort([5, 2, 8, 1], 0, 4)' });
  const plan = detectDivideConquer(rec, { code: MERGE_SORT });
  assert.ok(plan, 'the divide fingerprint is recognized');
  assert.equal(plan.fn, 'merge_sort');
  assert.deepEqual([plan.loArg, plan.hiArg], ['lo', 'hi']);
  assert.equal(plan.hiAdjust, -1, 'hi == len at the root -> exclusive-hi convention, detected from evidence');
  assert.ok(plan.pointers.includes('i') && plan.pointers.includes('j'), 'the merge fingers ride the array');

  const trace = compileDivideConquerLens({ recording: rec, plan, code: MERGE_SORT, entry: 'merge_sort([5, 2, 8, 1], 0, 4)' });
  assert.ok(trace.views.graph.nodes.some((n) => /merge_sort\(0\.\.3\)/.test(n.label)), 'segment nodes labeled with INCLUSIVE real bounds');
  assert.ok(trace.steps.some((s) => s.array?.dimmed?.length > 0), 'the focus band dims cells outside the active segment');
  assert.deepEqual(trace.steps.at(-1).array.values, [1, 2, 5, 8], 'the final cells are the really-sorted array');

  const plans = detectLenses(rec, { code: MERGE_SORT });
  assert.equal(plans[0]?.lens, 'divide-conquer', 'the split view outranks the plain recursion tree');
});

test('the second signal is the WRITE: recursive binary search nests but never mutates — refused', () => {
  const bs = [
    'def bs(arr, lo, hi, t):',
    '    if lo > hi:',
    '        return -1',
    '    mid = (lo + hi) // 2',
    '    if arr[mid] == t:',
    '        return mid',
    '    if arr[mid] < t:',
    '        return bs(arr, mid + 1, hi, t)',
    '    return bs(arr, lo, mid - 1, t)',
  ].join('\n');
  const rec = record({ code: bs, entry: 'bs([1, 3, 5, 7, 9], 0, 4, 7)' });
  assert.equal(detectDivideConquer(rec, { code: bs }), null, 'a splitter that never writes is a searcher');
});

const MERGE_INTERVALS = [
  'def merge(intervals):',
  '    intervals.sort()',
  '    merged = []',
  '    for iv in intervals:',
  '        if merged and iv[0] <= merged[-1][1]:',
  '            if iv[1] > merged[-1][1]:',
  '                merged[-1][1] = iv[1]',
  '        else:',
  '            merged.append(list(iv))',
  '    return merged',
].join('\n');

test('merge intervals: fusion is the signature — islands on the number line, real bounds narrated', () => {
  const entry = 'merge([[1, 3], [8, 10], [2, 6], [15, 18]])';
  const rec = record({ code: MERGE_INTERVALS, entry });
  const plan = detectIntervals(rec);
  assert.ok(plan, 'stable input + fusing accumulator = the number-line family');
  assert.equal(plan.intervalsVar, 'intervals');
  assert.equal(plan.mergedVar, 'merged');

  const trace = compileIntervalsLens({ recording: rec, plan, code: MERGE_INTERVALS });
  assert.ok(trace.views.intervals, 'the number-line view is declared');
  const fuse = trace.steps.find((s) => /touch|fuse|overlap/i.test(s.explanation));
  assert.ok(fuse, 'the fusion verdict is narrated');
  assert.deepEqual(trace.steps.at(-1).intervals.merged, [[1, 6], [8, 10], [15, 18]], 'the final islands are the real answer');

  const plans = detectLenses(rec, { code: MERGE_INTERVALS });
  assert.equal(plans[0]?.lens, 'intervals', 'the islands outrank any flat reading of the pair list');
});

test('no fusion, no claim: a literal pair-collector (Kruskal-shaped) is not the intervals lesson', () => {
  const collector = [
    'def take_small(pairs):',
    '    chosen = []',
    '    for a, b in pairs:',
    '        if b - a <= 3:',
    '            chosen.append([a, b])',
    '    return chosen',
  ].join('\n');
  const rec = record({ code: collector, entry: 'take_small([[1, 3], [2, 9], [4, 6]])' });
  assert.equal(detectIntervals(rec), null, 'every chosen element is a literal input member and nothing ever fused');
});
