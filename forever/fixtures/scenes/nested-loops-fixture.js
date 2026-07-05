// Hand-written fixture scene (Phase 1: prove the player before spending tokens).
// Kept contract-valid forever — tests/fixtures/nested-loops-fixture.test.js validates it
// against the same gates generated scenes must pass. Also the offline demo fallback.

export const nestedLoopsScene = {
  sceneId: 'fix_nested_loops',
  layout: 'teacher_notebook_code',
  objects: [
    {
      id: 'obj_title',
      objectType: 'lesson_title',
      renderHint: 'text',
      region: 'notebook_area',
      lineNumber: 0,
      content: 'Nested Loops in Patterns',
      sourceRef: { chunkId: 'chunk_0001' },
    },
    {
      id: 'obj_rules',
      objectType: 'nested_loop_rules',
      renderHint: 'list',
      region: 'notebook_area',
      lineNumber: 2,
      content: {
        items: [
          'Outer loop -> number of rows',
          'Inner loop -> number of columns',
          'Print stars, then next line',
        ],
      },
      sourceRef: { chunkId: 'chunk_0001' },
    },
    {
      id: 'obj_code',
      objectType: 'worked_code_example',
      renderHint: 'code',
      region: 'code_panel',
      content: 'for (int i = 1; i <= 4; i++) {\n  for (int j = 1; j <= 4; j++) {\n    cout << "*";\n  }\n  cout << endl;\n}',
      output: '****\n****\n****\n****',
      sourceRef: { chunkId: 'chunk_0001' },
    },
  ],
  voiceLines: [
    { id: 'vl_title', text: 'Today we learn how nested loops draw patterns.', targetObjectId: 'obj_title' },
    { id: 'vl_rules', text: 'Two rules control everything: the outer loop counts rows, the inner loop counts columns.', targetObjectId: 'obj_rules' },
    { id: 'vl_code', text: 'Watch the code: for every row, the inner loop prints four stars, then we move to the next line.', targetObjectId: 'obj_code' },
  ],
};

export const nestedLoopsTimeline = {
  sceneId: 'fix_nested_loops',
  timingSource: 'provisional',
  actions: [
    { id: 'act_point_title', kind: 'point', startMs: 0, durationMs: 600, targetObjectId: 'obj_title' },
    { id: 'act_speak_title', kind: 'speech', startMs: 300, durationMs: 2800, voiceLineId: 'vl_title' },
    { id: 'act_write_title', kind: 'write', startMs: 400, durationMs: 2200, targetObjectId: 'obj_title' },
    { id: 'act_point_rules', kind: 'point', startMs: 3200, durationMs: 600, targetObjectId: 'obj_rules' },
    { id: 'act_speak_rules', kind: 'speech', startMs: 3400, durationMs: 4600, voiceLineId: 'vl_rules' },
    { id: 'act_write_rules', kind: 'write', startMs: 3600, durationMs: 4400, targetObjectId: 'obj_rules' },
    { id: 'act_highlight_rules', kind: 'highlight', startMs: 8200, durationMs: 1200, targetObjectId: 'obj_rules' },
    { id: 'act_point_code', kind: 'point', startMs: 9400, durationMs: 600, targetObjectId: 'obj_code' },
    { id: 'act_speak_code', kind: 'speech', startMs: 9600, durationMs: 5200, voiceLineId: 'vl_code' },
    { id: 'act_reveal_code', kind: 'reveal_code', startMs: 9800, durationMs: 4200, targetObjectId: 'obj_code' },
    { id: 'act_show_output', kind: 'show_output', startMs: 14600, durationMs: 500, targetObjectId: 'obj_code' },
  ],
};

export const nestedLoopsDurationMs = 16000;
