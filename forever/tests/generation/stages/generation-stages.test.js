import assert from 'node:assert/strict';
import test from 'node:test';

import { FOREVER_GENERATION_STAGES, createGenerationProgress } from '../../../lib/generation/stages/generation-stages.js';

test('generation stages describe the staged pipeline in order', () => {
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
