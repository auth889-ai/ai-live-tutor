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
