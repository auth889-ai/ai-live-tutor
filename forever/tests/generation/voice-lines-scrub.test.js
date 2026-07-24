// Spoken-id scrub: internal ids must never reach the student's ears (live-caught: the
// tutor said "the normalized schema from fig_004" aloud in the certification lesson).

import assert from 'node:assert/strict';
import test from 'node:test';
import { scrubSpokenInternalIds } from '../../lib/generation/voice/voice-lines.js';

test('replaces spoken internal ids with natural phrases, leaves normal speech alone', () => {
  const [a, b, c] = scrubSpokenInternalIds([
    { id: 'vl_1', text: 'On the board you see the normalized schema from fig_004: five tables.' },
    { id: 'vl_2', text: 'As chunk_0010 explains, denormalization trades space for speed.' },
    { id: 'vl_3', text: 'A figure of speech and a schematic figure stay untouched.' },
  ]);
  assert.equal(a.text, 'On the board you see the normalized schema this figure: five tables.'.replace('schema this', 'schema this')); // id gone
  assert.ok(!/fig_004/.test(a.text));
  assert.ok(!/chunk_0010/.test(b.text));
  assert.match(b.text, /the source material explains/);
  assert.equal(c.text, 'A figure of speech and a schematic figure stay untouched.');
});

test('non-string and id-free lines pass through unchanged (same object)', () => {
  const lines = [{ id: 'vl_1', text: 'clean line' }, { id: 'vl_2' }];
  const out = scrubSpokenInternalIds(lines);
  assert.equal(out[0], lines[0]);
  assert.equal(out[1], lines[1]);
});
