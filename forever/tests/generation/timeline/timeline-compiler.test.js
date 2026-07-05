import assert from 'node:assert/strict';
import test from 'node:test';

import { compileProvisionalTimeline } from '../../../lib/generation/timeline/timeline-compiler.js';

const objects = [
  { id: 'obj_a', renderHint: 'text' },
  { id: 'obj_b', renderHint: 'code' },
];
const voiceLines = [
  { id: 'vl_a', text: 'First we look at the idea behind the topic in a simple way.', targetObjectId: 'obj_a' },
  { id: 'vl_b', text: 'Now the code shows exactly how this works in practice for you.', targetObjectId: 'obj_b' },
];

test('compiled timeline is contract-valid with focus leading speech', () => {
  const { timeline } = compileProvisionalTimeline({ sceneId: 'sc_x', objects, voiceLines });
  const point = timeline.actions.find((action) => action.id === 'act_point_obj_a');
  const speech = timeline.actions.find((action) => action.id === 'act_speak_obj_a');
  assert.ok(point.startMs < speech.startMs);
});

test('code objects get reveal_code instead of write', () => {
  const { timeline } = compileProvisionalTimeline({ sceneId: 'sc_x', objects, voiceLines });
  assert.equal(timeline.actions.find((action) => action.id === 'act_write_obj_b').kind, 'reveal_code');
});

test('speech blocks are sequential — never overlapping', () => {
  const { timeline } = compileProvisionalTimeline({ sceneId: 'sc_x', objects, voiceLines });
  const speeches = timeline.actions.filter((action) => action.kind === 'speech');
  assert.ok(speeches[0].startMs + speeches[0].durationMs <= speeches[1].startMs);
});

test('compilation is deterministic', () => {
  const first = compileProvisionalTimeline({ sceneId: 'sc_x', objects, voiceLines });
  const second = compileProvisionalTimeline({ sceneId: 'sc_x', objects, voiceLines });
  assert.deepEqual(first, second);
});
