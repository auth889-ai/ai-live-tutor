import assert from 'node:assert/strict';
import test from 'node:test';

import { FOREVER_GENERATION_STAGES, createGenerationProgress } from '../../lib/generation/pipeline-types.js';
import { FOREVER_AGENT_ROLES, createAgentTurnSummary } from '../../lib/orchestration/types.js';

test('generation stages describe staged course-video pipeline', () => {
  assert.deepEqual(FOREVER_GENERATION_STAGES.slice(0, 4), [
    'source_pack',
    'learning_unit_graph',
    'course_planning',
    'episode_planning',
  ]);
  assert.ok(FOREVER_GENERATION_STAGES.includes('tts_alignment'));
  assert.ok(FOREVER_GENERATION_STAGES.includes('timestamp_reconcile'));
});

test('generation progress rejects unknown stages', () => {
  assert.throws(() => createGenerationProgress('one_giant_prompt'), /Unknown generation stage/);
});

test('agent turn summary accepts Forever agent roles', () => {
  const summary = createAgentTurnSummary({
    agentId: 'agent_visual',
    agentName: 'Visual Director',
    role: FOREVER_AGENT_ROLES.visualDirector,
    contentPreview: 'Writes board regions only.',
    actionCount: 3,
  });

  assert.equal(summary.role, 'visual_director');
});

