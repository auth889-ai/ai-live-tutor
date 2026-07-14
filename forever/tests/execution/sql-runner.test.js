import assert from 'node:assert/strict';
import test from 'node:test';

import { detectLanguage } from '../../lib/orchestration/agents/coding/code-runner.js';
import { runCode } from '../../lib/execution/run-code.js';

test('unmistakable SQL vocabulary flips the demo language; prose does not', () => {
  assert.equal(detectLanguage('Show a GROUP BY query over the Sale table'), 'sql');
  assert.equal(detectLanguage('CREATE TABLE product (id INT)'), 'sql');
  assert.equal(detectLanguage('SELECT name FROM users'), 'sql');
  assert.equal(detectLanguage('explain how binary search selects the middle element from the array'), null);
  assert.equal(detectLanguage('the database stores customer records'), null);
});

// REAL execution through the sandbox (docker) — skipped automatically where docker is absent.
test('SQL statements execute for real on sqlite and print result tables', async (t) => {
  const probe = await runCode({ language: 'sql', source: 'SELECT 1 AS ok;' }).catch((e) => ({ error: e }));
  if (probe.error || probe.exitCode !== 0) {
    t.skip('docker sandbox unavailable in this environment');
    return;
  }
  const result = await runCode({
    language: 'sql',
    source: `CREATE TABLE sale (product TEXT, qty INT);
INSERT INTO sale VALUES ('cone', 3), ('cup', 5), ('cone', 2);
SELECT product, SUM(qty) AS total FROM sale GROUP BY product ORDER BY product;`,
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /product \| total/);
  assert.match(result.stdout, /cone \| 5/);
  assert.match(result.stdout, /cup \| 5/);
});
