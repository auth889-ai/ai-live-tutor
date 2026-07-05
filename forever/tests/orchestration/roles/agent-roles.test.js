import assert from 'node:assert/strict';
import test from 'node:test';

import { FOREVER_AGENT_ROLES, REVIEW_BOARD_ROLES, createAgentTurnSummary } from '../../../lib/orchestration/roles/agent-roles.js';

test('the faculty roster covers planning, production, review, and deterministic roles', () => {
  assert.equal(FOREVER_AGENT_ROLES.dean, 'dean');
  assert.equal(FOREVER_AGENT_ROLES.boardDirector, 'board_director');
  assert.equal(FOREVER_AGENT_ROLES.arbiter, 'arbiter');
  assert.equal(FOREVER_AGENT_ROLES.timelineCompiler, 'timeline_compiler');
});

test('the review board seats exactly four critics', () => {
  assert.equal(REVIEW_BOARD_ROLES.length, 4);
  assert.ok(REVIEW_BOARD_ROLES.includes('grounding_auditor'));
});

test('agent turn summaries reject unknown roles', () => {
  assert.throws(
    () => createAgentTurnSummary({ agentId: 'x', agentName: 'X', role: 'mega_prompt', contentPreview: '' }),
    /Unknown Forever agent role/,
  );
});
