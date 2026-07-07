import assert from 'node:assert/strict';
import test from 'node:test';

import { reconcileTimeline } from '../../../lib/playback/reconcile/reconcile-timeline.js';
import { validateTimeline } from '../../../lib/generation/timeline/timeline-actions.js';

const objects = [
  { id: 'obj_a', renderHint: 'text' },
  { id: 'obj_b', renderHint: 'code' },
];
const voiceLines = [
  { id: 'vl_a', text: 'Short line.', targetObjectId: 'obj_a' },
  { id: 'vl_b', text: 'A much longer spoken line that would take more real seconds to say.', targetObjectId: 'obj_b' },
];

function reconcile() {
  return reconcileTimeline({
    sceneId: 'sc_r',
    objects,
    voiceLines,
    clips: [
      { voiceLineId: 'vl_a', durationMs: 1800, url: 'oss://a.mp3' },
      { voiceLineId: 'vl_b', durationMs: 6200, url: 'oss://b.mp3' },
    ],
    audioUrl: 'oss://scene.mp3',
  });
}

test('reconciled timeline is contract-valid with reconciled timingSource and audio', () => {
  const { timeline } = reconcile();
  validateTimeline(timeline, { objects, voiceLines });
  assert.equal(timeline.timingSource, 'reconciled');
  assert.equal(timeline.audio.durationMs, 8000); // 1800 + 6200 concatenated
});

test('speech durations become the REAL measured clip durations', () => {
  const { timeline } = reconcile();
  assert.equal(timeline.actions.find((a) => a.id === 'act_speak_obj_a_0').durationMs, 1800);
  assert.equal(timeline.actions.find((a) => a.id === 'act_speak_obj_b_0').durationMs, 6200);
});

test('writing spans the full real speech length', () => {
  const { timeline } = reconcile();
  const write = timeline.actions.find((a) => a.id === 'act_write_obj_b');
  assert.equal(write.durationMs, 6200); // write covers obj_b's entire narration
});

test('a missing clip for any voice line is an honest failure', () => {
  assert.throws(
    () =>
      reconcileTimeline({
        sceneId: 'sc_r',
        objects,
        voiceLines,
        clips: [{ voiceLineId: 'vl_a', durationMs: 1800, url: 'oss://a.mp3' }],
        audioUrl: 'oss://scene.mp3',
      }),
    /no measured clip for voice line vl_b/,
  );
});

test('reconciliation is deterministic', () => {
  assert.deepEqual(reconcile(), reconcile());
});

test('word timings shift to ABSOLUTE clock times per line (karaoke/word-anchor substrate)', () => {
  const objects = [{ id: 'o1', renderHint: 'text' }];
  const voiceLines = [
    { id: 'v1', text: 'first line', targetObjectId: 'o1' },
    { id: 'v2', text: 'second line', targetObjectId: 'o1' },
  ];
  const clips = [
    { voiceLineId: 'v1', durationMs: 2000, wordTimings: [{ word: 'first', startMs: 0, endMs: 800 }, { word: 'line', startMs: 900, endMs: 1900 }] },
    { voiceLineId: 'v2', durationMs: 1500, wordTimings: [{ word: 'second', startMs: 100, endMs: 700 }] },
  ];
  const { voiceLines: enriched } = reconcileTimeline({ sceneId: 'sc', objects, voiceLines, clips, audioUrl: '/a.mp3' });
  assert.deepEqual(enriched[0].words[1], { word: 'line', startMs: 900, endMs: 1900 });
  // second clip starts after the first (offset 2000) -> its words shift by 2000
  assert.deepEqual(enriched[1].words[0], { word: 'second', startMs: 2100, endMs: 2700 });
});
