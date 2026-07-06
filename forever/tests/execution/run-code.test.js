import assert from 'node:assert/strict';
import test from 'node:test';

import { runCode, selectRunner } from '../../lib/execution/run-code.js';

// These run REAL code via the local node runtime (always present in this test env),
// so they prove the engine captures genuine output — the anti-fake-output guarantee.

test('captures real stdout from executed JavaScript', async () => {
  const result = await runCode({ language: 'javascript', source: 'console.log(2 + 2)' });
  assert.equal(result.stdout, '4');
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
});

test('captures a real multi-line loop trace', async () => {
  const result = await runCode({
    language: 'node',
    source: 'for (let i = 1; i <= 3; i++) console.log("row " + i);',
  });
  assert.equal(result.stdout, 'row 1\nrow 2\nrow 3');
});

test('captures real stderr and non-zero exit on a runtime error', async () => {
  const result = await runCode({ language: 'javascript', source: 'throw new Error("boom")' });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /boom/);
});

test('a runaway infinite loop is killed by the timeout, not hung forever', async () => {
  const result = await runCode({ language: 'javascript', source: 'while (true) {}', timeoutMs: 800 });
  assert.equal(result.timedOut, true);
});

test('an unsupported language fails honestly (no fake output)', async () => {
  await assert.rejects(() => runCode({ language: 'brainfuck', source: '+++.' }), /no local runner/);
});

test('empty source is rejected', async () => {
  await assert.rejects(() => runCode({ language: 'js', source: '   ' }), /source is required/);
});

test('runner tier selection is explicit and prioritized', () => {
  assert.equal(selectRunner({ JUDGE0_URL: 'http://x' }), 'judge0');
  assert.equal(selectRunner({ CODE_SANDBOX: 'docker' }), 'docker');
  assert.equal(selectRunner({}), 'local');
});
