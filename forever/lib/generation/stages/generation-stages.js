export const FOREVER_GENERATION_STAGES = Object.freeze([
  'source_pack',
  'learning_unit_graph',
  'course_planning',
  'episode_planning',
  'pedagogy_plan',
  'voice_lines',
  'visual_plan',
  'timeline_actions',
  'tts_alignment',
  'timestamp_reconcile',
  'review',
  'manifest_ready',
]);

export function createGenerationProgress(stage, detail = {}) {
  if (!FOREVER_GENERATION_STAGES.includes(stage)) {
    throw new Error(`Unknown generation stage: ${stage}`);
  }
  return {
    stage,
    detail,
    updatedAt: new Date().toISOString(),
  };
}
