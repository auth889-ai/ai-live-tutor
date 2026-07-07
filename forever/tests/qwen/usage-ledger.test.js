import assert from 'node:assert/strict';
import test from 'node:test';

import { recordUsage, resetUsageLedger, readUsageLedger } from '../../lib/qwen/client.js';

test('the usage ledger accumulates per agent and resets clean', () => {
  resetUsageLedger();
  recordUsage('teacher', { prompt_tokens: 100, completion_tokens: 40 });
  recordUsage('teacher', { prompt_tokens: 50, completion_tokens: 10 });
  recordUsage('board_director', { prompt_tokens: 30, completion_tokens: 20 });
  recordUsage('board_director', undefined); // a call whose usage the API omitted

  const ledger = readUsageLedger();
  assert.equal(ledger.calls, 4);
  assert.equal(ledger.inputTokens, 180);
  assert.equal(ledger.outputTokens, 70);
  assert.deepEqual(ledger.byAgent.teacher, { calls: 2, inputTokens: 150, outputTokens: 50 });
  assert.equal(ledger.byAgent.board_director.calls, 2);

  // the read is a snapshot, not a live reference
  ledger.calls = 999;
  assert.equal(readUsageLedger().calls, 4);

  resetUsageLedger();
  assert.deepEqual(readUsageLedger(), { calls: 0, inputTokens: 0, outputTokens: 0, byAgent: {} });
});
