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
