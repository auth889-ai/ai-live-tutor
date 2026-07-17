import assert from 'node:assert/strict';
import test from 'node:test';

import { resultMatchesExpect, oracleIssue } from '../../../lib/execution/trace/oracle.js';

test('oracle: matches tolerant forms, rejects wrong answers with a code-fix demand', () => {
  assert.equal(resultMatchesExpect([[1, 3]], [[1, 3]]), true);
  assert.equal(resultMatchesExpect('[[1,3]]', [[1, 3]]), true, 'stringified results match structured expects');
  assert.equal(resultMatchesExpect(6, 6), true);
  assert.equal(resultMatchesExpect(undefined, undefined), true, 'no expect declared -> no oracle');
  assert.equal(resultMatchesExpect([[1, 3]], [[3, 1]]), false, 'order matters');
  const issue = oracleIssue(5, 6);
  assert.match(issue, /returned 5.*expects 6/s);
  assert.match(issue, /never adjust "expect"/);
  assert.equal(oracleIssue([[1, 3]], undefined), null);
});

test('oracle v2: parses ALL stated LC examples from source text, raw literals preserved', async () => {
  const { parseStatedExamples, verifySolution } = await import('../../../lib/execution/trace/oracle.js');
  const SRC = `Given an integer array nums, rotate the array to the right by k steps.
Example 1:
Input: nums = [1,2,3,4,5,6,7], k = 3
Output: [5,6,7,1,2,3,4]
Example 2:
Input: nums = [-1,-100,3,99], k = 2
Output: [3,99,-1,-100]`;
  const ex = parseStatedExamples(SRC);
  assert.equal(ex.length, 2);
  assert.equal(ex[0].argsRaw, '[1,2,3,4,5,6,7], 3');
  assert.equal(ex[1].expected, '[3,99,-1,-100]');

  const { execFileSync } = await import('node:child_process');
  const exec = async ({ source }) => {
    try { return { stdout: execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15000 }) }; }
    catch (e) { return { stdout: String(e.stdout ?? '') }; }
  };
  const GOOD = 'def rotate(nums, k):\n    k %= len(nums)\n    return nums[-k:] + nums[:-k]';
  const BAD = 'def rotate(nums, k):\n    return nums';
  const good = await verifySolution({ code: GOOD, entry: 'rotate([1,2,3], 1)', sourceText: SRC, exec });
  assert.equal(good.level, 'verified_examples', JSON.stringify(good.failures));
  const bad = await verifySolution({ code: BAD, entry: 'rotate([1,2,3], 1)', sourceText: SRC, exec });
  assert.equal(bad.level, 'failed');
  assert.equal(bad.failures.length, 2, 'BOTH stated examples fail, both named');
  const none = await verifySolution({ code: GOOD, entry: 'rotate([1], 1)', sourceText: 'no examples here', exec });
  assert.equal(none.level, 'unverified', 'no stated examples -> honest unverified, never fake-verified');
});
