import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { assembleUniversalProgram, parseUniversalEvents, validateUniversalRecording } from '../../../lib/execution/trace/universal/recorder.js';
import { detectPointerArray, compilePointerArray } from '../../../lib/execution/trace/universal/lenses/pointer-array.js';
import { detectLenses } from '../../../lib/execution/trace/universal/detect.js';

const py = (source) => execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15_000 });
const record = ({ code, entry }) =>
  validateUniversalRecording(parseUniversalEvents(py(assembleUniversalProgram({ code, entry }))));

const BINARY_SEARCH = [
  'def binary_search(arr, target):',
  '    low, high = 0, len(arr) - 1',
  '    while low <= high:',
  '        mid = (low + high) // 2',
  '        if arr[mid] == target:',
  '            return mid',
  '        if arr[mid] < target:',
  '            low = mid + 1',
  '        else:',
  '            high = mid - 1',
  '    return -1',
].join('\n');

test('binary search: mid found by subscripting, low/high found as monotonic BRACKETS', () => {
  const rec = record({ code: BINARY_SEARCH, entry: 'binary_search([2, 5, 8, 12, 16, 23, 38, 56, 72], 23)' });
  const plan = detectPointerArray(rec, { code: BINARY_SEARCH });
  assert.ok(plan, 'the family is recognized');
  assert.equal(plan.array.name, 'arr');
  assert.ok(plan.pointers.includes('mid'), 'mid subscripts arr -> primary pointer');
  assert.ok(plan.pointers.includes('low') && plan.pointers.includes('high'), 'low/high never subscript, but they bracket mid');
  assert.deepEqual(plan.eliminatedOutside, ['low', 'high'], 'converging pair -> the ruled-out half dims');
  assert.equal(plan.arrayVar, null, 'read-only walk, no in-place values');

  const trace = compilePointerArray({ recording: rec, plan, code: BINARY_SEARCH });
  assert.deepEqual(trace.views.array.values, [2, 5, 8, 12, 16, 23, 38, 56, 72]);
  const elim = trace.steps.find((s) => s.array?.eliminated?.length > 0);
  assert.ok(elim, 'eliminated cells appear once the range shrinks');
  assert.ok(trace.steps.every((s) => !s.array || s.array.pointers), 'pointers ride the array on every stateful step');
  assert.match(trace.steps.at(-1).explanation, /5/, 'the found index 5 reaches the close');
});

test('two-pointer converging + sliding window get their true roles from monotonicity', () => {
  const twoSum = [
    'def two_sum_sorted(arr, target):',
    '    l, r = 0, len(arr) - 1',
    '    while l < r:',
    '        s = arr[l] + arr[r]',
    '        if s == target:',
    '            return [l, r]',
    '        if s < target:',
    '            l += 1',
    '        else:',
    '            r -= 1',
    '    return []',
  ].join('\n');
  const p1 = detectPointerArray(record({ code: twoSum, entry: 'two_sum_sorted([1, 3, 4, 6, 8, 11], 10)' }), { code: twoSum });
  assert.deepEqual(p1.eliminatedOutside, ['l', 'r'], 'l up + r down = converging');
  assert.equal(p1.window, null);

  const minWin = [
    'def min_subarray_len(arr, target):',
    '    l = 0',
    '    total = 0',
    '    best = 0',
    '    for r in range(len(arr)):',
    '        total += arr[r]',
    '        while total >= target:',
    '            width = r - l + 1',
    '            if best == 0 or width < best:',
    '                best = width',
    '            total -= arr[l]',
    '            l += 1',
    '    return best',
  ].join('\n');
  const p2 = detectPointerArray(record({ code: minWin, entry: 'min_subarray_len([2, 3, 1, 2, 4, 3], 7)' }), { code: minWin });
  assert.deepEqual(p2.window, ['l', 'r'], 'both advancing = a window');
  assert.equal(p2.eliminatedOutside, null);
});

test('in-place reversal: the hero is its own arrayVar and swaps flash as real cell writes', () => {
  const rev = [
    'def reverse(arr):',
    '    l, r = 0, len(arr) - 1',
    '    while l < r:',
    '        arr[l], arr[r] = arr[r], arr[l]',
    '        l += 1',
    '        r -= 1',
    '    return arr',
  ].join('\n');
  const rec = record({ code: rev, entry: 'reverse([1, 2, 3, 4, 5])' });
  const plan = detectPointerArray(rec, { code: rev });
  assert.equal(plan.arrayVar, 'arr', 'in-place mutation detected');
  const trace = compilePointerArray({ recording: rec, plan, code: rev });
  const swap = trace.steps.find((s) => s.array?.swapped?.length === 2);
  assert.ok(swap, 'a swap step exists');
  const finalValues = trace.steps.at(-1).array.values;
  assert.deepEqual(finalValues, [5, 4, 3, 2, 1], 'the final cells are the really-reversed array');
});

test('COMPOSITION: Two Sum shows the array AND its memory — the seen map rides as a live table', () => {
  const twoSum = [
    'def two_sum(arr, t):',
    '    seen = {}',
    '    for i in range(len(arr)):',
    '        need = t - arr[i]',
    '        if need in seen:',
    '            return [seen[need], i]',
    '        seen[arr[i]] = i',
    '    return []',
  ].join('\n');
  const rec = record({ code: twoSum, entry: 'two_sum([2, 7, 11, 15], 18)' });
  const plan = detectPointerArray(rec, { code: twoSum });
  assert.equal(plan.mapVar, 'seen', "the growing scalar-valued dict is the walk's memory — int keys count");

  const trace = compilePointerArray({ recording: rec, plan, code: twoSum });
  const put = trace.steps.find((s) => /seen\[2\] = 0 lands in the map/.test(s.explanation));
  assert.ok(put, 'a map put is narrated with its REAL key and value');
  const tabled = trace.steps.filter((s) => s.traceRow);
  assert.ok(tabled.length >= 3, 'the live map rides steps as the trace table');
  assert.deepEqual(tabled.at(-1).traceRow, { 2: 0, 7: 1 }, 'the final table is the real recorded map');
});

test('honest refusals + registry routing', () => {
  const fib = record({ code: 'def fib(n):\n    if n <= 1:\n        return n\n    return fib(n - 1) + fib(n - 2)', entry: 'fib(4)' });
  assert.equal(detectPointerArray(fib, { code: '' }), null, 'no array -> null');

  const noIndex = record({
    code: 'def total(arr):\n    s = 0\n    for x in arr:\n        s += x\n    return s',
    entry: 'total([1, 2, 3])',
  });
  assert.equal(detectPointerArray(noIndex, { code: 'def total(arr):\n    s = 0\n    for x in arr:\n        s += x\n    return s' }), null, 'iteration without index pointers -> null (another lens can still take it)');

  const plans = detectLenses(record({ code: BINARY_SEARCH, entry: 'binary_search([2, 5, 8, 12, 16], 16)' }), { code: BINARY_SEARCH });
  assert.equal(plans[0]?.lens, 'pointer-array', 'binary search routes to the array lens');
});
