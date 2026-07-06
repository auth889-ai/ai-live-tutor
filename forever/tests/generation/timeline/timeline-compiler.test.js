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
  const speech = timeline.actions.find((action) => action.id === 'act_speak_obj_a_0');
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

test('a code object with real output gets a show_output action after it writes', () => {
  const codeObjects = [{ id: 'obj_code', renderHint: 'code', output: '4' }];
  const codeVoice = [{ id: 'vl_c', text: 'Run the code and see the result printed clearly.', targetObjectId: 'obj_code' }];
  const { timeline } = compileProvisionalTimeline({ sceneId: 'sc_c', objects: codeObjects, voiceLines: codeVoice });
  const output = timeline.actions.find((a) => a.id === 'act_output_obj_code');
  const write = timeline.actions.find((a) => a.id === 'act_write_obj_code');
  assert.ok(output, 'expected a show_output action');
  assert.ok(output.startMs >= write.startMs + write.durationMs, 'output reveals after code finishes writing');
});

test('a code object with no output gets no show_output action', () => {
  const codeObjects = [{ id: 'obj_code', renderHint: 'code' }];
  const codeVoice = [{ id: 'vl_c', text: 'Here is the code that we will study today together.', targetObjectId: 'obj_code' }];
  const { timeline } = compileProvisionalTimeline({ sceneId: 'sc_c', objects: codeObjects, voiceLines: codeVoice });
  assert.ok(!timeline.actions.some((a) => a.kind === 'show_output'));
});

test('multiple narration lines per object still yield a startMs-sorted timeline', () => {
  const objs = [{ id: 'obj_x', renderHint: 'text' }];
  const many = [
    { id: 'l1', text: 'First sentence explaining the idea in some detail here.', targetObjectId: 'obj_x' },
    { id: 'l2', text: 'Second sentence going deeper into why it matters a lot.', targetObjectId: 'obj_x' },
    { id: 'l3', text: 'Third sentence with a concrete example for the learner.', targetObjectId: 'obj_x' },
  ];
  const { timeline } = compileProvisionalTimeline({ sceneId: 'sc_m', objects: objs, voiceLines: many });
  for (let i = 1; i < timeline.actions.length; i += 1) {
    assert.ok(timeline.actions[i].startMs >= timeline.actions[i - 1].startMs, 'actions sorted by startMs');
  }
});
