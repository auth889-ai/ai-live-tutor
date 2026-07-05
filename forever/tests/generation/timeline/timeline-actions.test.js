import assert from 'node:assert/strict';
import test from 'node:test';

import { validateTimeline } from '../../../lib/generation/timeline/timeline-actions.js';

const objects = [{ id: 'obj_rules' }, { id: 'obj_code' }];
const voiceLines = [
  { id: 'vl_1', text: 'Rules first.', targetObjectId: 'obj_rules' },
  { id: 'vl_2', text: 'Now the code.', targetObjectId: 'obj_code' },
];

function validTimeline() {
  return {
    sceneId: 'sc_001',
    timingSource: 'provisional',
    actions: [
      { id: 'a1', kind: 'point', startMs: 0, durationMs: 800, targetObjectId: 'obj_rules' },
      { id: 'a2', kind: 'speech', startMs: 200, durationMs: 3000, voiceLineId: 'vl_1' },
      { id: 'a3', kind: 'write', startMs: 400, durationMs: 2500, targetObjectId: 'obj_rules' },
      { id: 'a4', kind: 'highlight', startMs: 3300, durationMs: 600, targetObjectId: 'obj_code' },
      { id: 'a5', kind: 'speech', startMs: 3400, durationMs: 2600, voiceLineId: 'vl_2' },
    ],
  };
}

test('a sorted, bound, focus-led timeline passes', () => {
  validateTimeline(validTimeline(), { objects, voiceLines });
});

test('actions out of clock order are rejected', () => {
  const timeline = validTimeline();
  [timeline.actions[0], timeline.actions[1]] = [timeline.actions[1], timeline.actions[0]];
  assert.throws(() => validateTimeline(timeline, { objects, voiceLines }), /sorted by ascending startMs/);
});

test('overlapping speech is rejected — speech is synchronous on the one clock', () => {
  const timeline = validTimeline();
  // First speech runs 200-3200ms; starting the second at 3100ms overlaps it.
  timeline.actions[3].startMs = 3000;
  timeline.actions[4].startMs = 3100;
  assert.throws(() => validateTimeline(timeline, { objects, voiceLines }), /overlaps previous speech/);
});

test('speaking about an object before ever focusing it is rejected', () => {
  const timeline = validTimeline();
  timeline.actions[3].startMs = 3500;
  timeline.actions[3].durationMs = 400;
  timeline.actions = timeline.actions.sort((a, b) => a.startMs - b.startMs);
  assert.throws(() => validateTimeline(timeline, { objects, voiceLines }), /focus must lead speech/);
});

test('a reconciled timeline without measured audio is rejected', () => {
  const timeline = { ...validTimeline(), timingSource: 'reconciled' };
  assert.throws(() => validateTimeline(timeline, { objects, voiceLines }), /requires audio\.url/);
});

test('a write action without a board target is rejected', () => {
  const timeline = validTimeline();
  delete timeline.actions[2].targetObjectId;
  assert.throws(() => validateTimeline(timeline, { objects, voiceLines }), /requires targetObjectId/);
});

test('an action targeting a missing board object is rejected', () => {
  const timeline = validTimeline();
  timeline.actions[2].targetObjectId = 'obj_ghost';
  assert.throws(() => validateTimeline(timeline, { objects, voiceLines }), /missing board object/);
});
