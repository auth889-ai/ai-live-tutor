import assert from 'node:assert/strict';
import test from 'node:test';

import { charsToWordTimings } from '../../lib/tts/providers/elevenlabs.js';

// ElevenLabs returns per-character timings; we aggregate them into word timings that the
// reconciler uses to sync board writing to the spoken words. Pure -> deterministic test.

test('aggregates character timings into word timings', () => {
  // "Hi you" -> H,i,space,y,o,u
  const alignment = {
    characters: ['H', 'i', ' ', 'y', 'o', 'u'],
    character_start_times_seconds: [0.0, 0.1, 0.2, 0.3, 0.4, 0.5],
    character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
  };
  const words = charsToWordTimings(alignment);
  assert.deepEqual(words, [
    { word: 'Hi', startMs: 0, endMs: 200 },
    { word: 'you', startMs: 300, endMs: 600 },
  ]);
});

test('handles empty alignment', () => {
  assert.deepEqual(charsToWordTimings({}), []);
  assert.deepEqual(charsToWordTimings({ characters: [] }), []);
});

test('collapses multiple spaces without emitting empty words', () => {
  const alignment = {
    characters: ['a', ' ', ' ', 'b'],
    character_start_times_seconds: [0, 0.1, 0.2, 0.3],
    character_end_times_seconds: [0.1, 0.2, 0.3, 0.4],
  };
  const words = charsToWordTimings(alignment);
  assert.equal(words.length, 2);
  assert.equal(words[1].word, 'b');
});
