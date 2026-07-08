import assert from 'node:assert/strict';
import test from 'node:test';

import { validateVoiceLines, normalizeVoiceTargets } from '../../../lib/generation/voice/voice-lines.js';

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

test('a voice line may carry a traceStep binding it to a dry-run step', () => {
  validateVoiceLines(
    [
      { id: 'vl_1', text: 'Start at the root.', targetObjectId: 'obj_tree', traceStep: 0 },
      { id: 'vl_2', text: 'Move to its left child.', targetObjectId: 'obj_tree', traceStep: 1 },
    ],
    [{ id: 'obj_tree' }],
  );
});

test('a negative or non-integer traceStep is rejected', () => {
  assert.throws(
    () => validateVoiceLines([{ id: 'vl_1', text: 'x', targetObjectId: 'o', traceStep: -1 }], [{ id: 'o' }]),
    /traceStep must be a non-negative integer/,
  );
  assert.throws(
    () => validateVoiceLines([{ id: 'vl_1', text: 'x', targetObjectId: 'o', traceStep: 1.5 }], [{ id: 'o' }]),
    /traceStep must be a non-negative integer/,
  );
});

test('normalizeVoiceTargets: a line targeting a NODE id is retargeted to the object that holds it', () => {
  const boards = [
    { id: 'obj_tree', content: { nodes: [{ id: 'n5' }, { id: 'n6' }], edges: [] } },
    { id: 'obj_code', content: 'code' },
  ];
  const fixed = normalizeVoiceTargets(
    [
      { id: 'vl_1', text: 'Node five is visited now, watch it turn green.', targetObjectId: 'n5' },
      { id: 'vl_2', text: 'The code line moves on.', targetObjectId: 'obj_code' },
    ],
    boards,
  );
  assert.equal(fixed[0].targetObjectId, 'obj_tree', 'retargeted to the owning diagram');
  assert.equal(fixed[0].focusRef, 'n5', 'the node becomes the pointed-at sub-element');
  assert.equal(fixed[1].targetObjectId, 'obj_code', 'valid targets untouched');
  validateVoiceLines(fixed, boards); // and the repaired lines now pass the contract
  // Ambiguous (node in TWO objects) is NOT guessed — left for loud validation.
  const two = [
    { id: 'a', content: { nodes: [{ id: 'x' }] } },
    { id: 'b', content: { nodes: [{ id: 'x' }] } },
  ];
  const left = normalizeVoiceTargets([{ id: 'vl', text: 'ambiguous target here.', targetObjectId: 'x' }], two);
  assert.equal(left[0].targetObjectId, 'x');
});
