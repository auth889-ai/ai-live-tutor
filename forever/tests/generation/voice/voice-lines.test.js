import assert from 'node:assert/strict';
import test from 'node:test';

import { validateVoiceLines } from '../../../lib/generation/voice/voice-lines.js';

const objects = [{ id: 'obj_rules' }, { id: 'obj_code' }];

test('voice lines bound to board objects pass', () => {
  validateVoiceLines(
    [
      { id: 'vl_1', text: 'The outer loop controls the number of rows.', targetObjectId: 'obj_rules' },
      { id: 'vl_2', text: 'Now watch the code print the pattern.', targetObjectId: 'obj_code' },
    ],
    objects,
  );
});

test('a narration line without a board target is rejected', () => {
  assert.throws(
    () => validateVoiceLines([{ id: 'vl_1', text: 'Floating narration.' }], objects),
    /must be bound to a board object/,
  );
});

test('a narration line targeting a missing object is rejected', () => {
  assert.throws(
    () => validateVoiceLines([{ id: 'vl_1', text: 'Points at nothing.', targetObjectId: 'obj_ghost' }], objects),
    /missing board object/,
  );
});

test('duplicate voice line ids are rejected', () => {
  const line = { id: 'vl_1', text: 'Repeated line.', targetObjectId: 'obj_rules' };
  assert.throws(() => validateVoiceLines([line, { ...line }], objects), /Duplicate voice line id/);
});

test('a voice line may carry a focusRef (sub-element to highlight while spoken)', () => {
  validateVoiceLines(
    [
      { id: 'vl_1', text: 'We compare node 8 to the target.', targetObjectId: 'obj_tree', focusRef: '8' },
      { id: 'vl_2', text: 'Line 5 computes the middle index.', targetObjectId: 'obj_code', focusRef: 5 },
    ],
    [{ id: 'obj_tree' }, { id: 'obj_code' }],
  );
});

test('a non-string/number focusRef is rejected', () => {
  assert.throws(
    () => validateVoiceLines([{ id: 'vl_1', text: 'x', targetObjectId: 'o', focusRef: { bad: true } }], [{ id: 'o' }]),
    /focusRef must be a string or number/,
  );
});
