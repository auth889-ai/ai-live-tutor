import assert from 'node:assert/strict';
import test from 'node:test';

import { boardStateAt } from '../../../lib/playback/engine/action-engine.js';
import { validateTimeline } from '../../../lib/generation/timeline/timeline-actions.js';

const objects = [{ id: 'obj_rules' }, { id: 'obj_code' }];
const voiceLines = [
  { id: 'vl_1', text: 'Rules first.', targetObjectId: 'obj_rules' },
  { id: 'vl_2', text: 'Now the code.', targetObjectId: 'obj_code' },
];

function timeline() {
  const built = {
    sceneId: 'sc_001',
    timingSource: 'provisional',
    actions: [
      { id: 'a1', kind: 'point', startMs: 0, durationMs: 800, targetObjectId: 'obj_rules' },
      { id: 'a2', kind: 'speech', startMs: 200, durationMs: 3000, voiceLineId: 'vl_1' },
      { id: 'a3', kind: 'write', startMs: 400, durationMs: 2000, targetObjectId: 'obj_rules' },
      { id: 'a4', kind: 'highlight', startMs: 3300, durationMs: 600, targetObjectId: 'obj_code' },
      { id: 'a5', kind: 'speech', startMs: 3400, durationMs: 2600, voiceLineId: 'vl_2' },
      { id: 'a6', kind: 'reveal_code', startMs: 3500, durationMs: 1000, targetObjectId: 'obj_code' },
      { id: 'a7', kind: 'show_output', startMs: 5000, durationMs: 400, targetObjectId: 'obj_code' },
    ],
  };
  validateTimeline(built, { objects, voiceLines }); // engine input is always contract-valid
  return built;
}

test('before anything starts the board is empty', () => {
  const state = boardStateAt(timeline(), 0);
  assert.equal(state.writing.size, 0);
  assert.equal(state.pointer, 'obj_rules'); // a1 fires at 0: pointer leads
  assert.equal(state.activeSpeech, null);
});

test('mid-write the stroke reveal progress tracks the clock', () => {
  const state = boardStateAt(timeline(), 1400);
  assert.equal(state.writing.get('obj_rules').progress, 0.5); // 1000ms into a 2000ms write
  assert.equal(state.activeSpeech, 'vl_1');
});

test('after a write completes the object stays fully drawn', () => {
  const state = boardStateAt(timeline(), 3000);
  assert.equal(state.writing.get('obj_rules').progress, 1);
});

test('highlight is active only inside its window', () => {
  assert.ok(boardStateAt(timeline(), 3500).highlights.has('obj_code'));
  assert.ok(!boardStateAt(timeline(), 4500).highlights.has('obj_code'));
});

test('speech drives the subtitle and ends cleanly', () => {
  assert.equal(boardStateAt(timeline(), 3500).activeSpeech, 'vl_2');
  assert.equal(boardStateAt(timeline(), 6100).activeSpeech, null);
});

test('real output stays on screen once shown', () => {
  assert.ok(boardStateAt(timeline(), 5100).outputShown.has('obj_code'));
  assert.ok(boardStateAt(timeline(), 9000).outputShown.has('obj_code'));
});

test('seeking is deterministic: state at t never depends on the path taken', () => {
  const line = timeline();
  const forward = boardStateAt(line, 3500);
  boardStateAt(line, 9000); // wander far ahead...
  boardStateAt(line, 100); // ...then far back
  const again = boardStateAt(line, 3500);
  assert.deepEqual(
    { ...again, writing: [...again.writing], highlights: [...again.highlights] },
    { ...forward, writing: [...forward.writing], highlights: [...forward.highlights] },
  );
});

test('a wipe clears everything written before it', () => {
  const line = timeline();
  line.actions.push({ id: 'a8', kind: 'wipe', startMs: 6000, durationMs: 300 });
  validateTimeline(line, { objects, voiceLines });
  const state = boardStateAt(line, 6500);
  assert.equal(state.writing.size, 0);
  assert.equal(state.pointer, null);
  assert.equal(state.outputShown.size, 0);
});

test('negative or invalid clock time is rejected', () => {
  assert.throws(() => boardStateAt(timeline(), -5), /non-negative time/);
});
