import assert from 'node:assert/strict';
import test from 'node:test';

import { validateBoardObject, validateBoardObjects, RENDER_HINTS } from '../../../lib/board/objects/board-objects.js';

function validObject() {
  return {
    id: 'obj_rules',
    objectType: 'nested_loop_rules',
    renderHint: 'list',
    region: 'notebook_body',
    lineNumber: 1,
    content: { items: ['Outer loop controls rows'] },
    sourceRef: { chunkId: 'chunk_0001' },
  };
}

test('a region-addressed, source-cited board object passes', () => {
  validateBoardObject(validObject(), 'teacher_notebook');
});

test('objectType is a free string so agents can invent subject-specific objects', () => {
  const object = { ...validObject(), objectType: 'reaction_mechanism_arrows' };
  validateBoardObject(object, 'teacher_notebook');
  assert.ok(!RENDER_HINTS.includes(object.objectType));
});

test('an "algorithm" board object carrying a valid ExecutionTrace passes; an invalid trace is rejected', () => {
  const trace = {
    language: 'python',
    code: 'def f(a,t):\n  lo,hi=0,len(a)-1',
    views: { array: { values: [1, 3, 5] } },
    steps: [{ line: 2, explanation: 'start', array: { current: 0 } }],
  };
  const obj = { ...validObject(), objectType: 'binary_search_dry_run', renderHint: 'algorithm', content: trace };
  validateBoardObject(obj, 'teacher_notebook');
  // a trace whose step points at a non-existent array index must be rejected at the board level
  const bad = { ...obj, content: { ...trace, steps: [{ line: 2, explanation: 'x', array: { current: 9 } }] } };
  assert.throws(() => validateBoardObject(bad, 'teacher_notebook'), /out of bounds/);
});

test('raw x/y coordinates are rejected — the non-negotiable rule is enforced in code', () => {
  assert.throws(() => validateBoardObject({ ...validObject(), x: 120, y: 300 }, 'teacher_notebook'), /must not carry raw x\/y/);
});

test('a factual object without sourceRef is rejected', () => {
  const object = { ...validObject() };
  delete object.sourceRef;
  assert.throws(() => validateBoardObject(object, 'teacher_notebook'), /needs a sourceRef/);
});

test('a decorative object may omit sourceRef', () => {
  const object = { ...validObject(), decorative: true };
  delete object.sourceRef;
  validateBoardObject(object, 'teacher_notebook');
});

test('unknown renderHint is rejected', () => {
  assert.throws(() => validateBoardObject({ ...validObject(), renderHint: 'hologram' }, 'teacher_notebook'), /renderHint/);
});

test('unknown region is rejected', () => {
  assert.throws(() => validateBoardObject({ ...validObject(), region: 'secret_panel' }, 'teacher_notebook'), /Unknown board region/);
});

test('line overflow beyond the region is rejected', () => {
  assert.throws(() => validateBoardObject({ ...validObject(), lineNumber: 99 }, 'teacher_notebook'), /exceeds maxLines/);
});

test('duplicate board object ids are rejected', () => {
  assert.throws(() => validateBoardObjects([validObject(), validObject()], 'teacher_notebook'), /Duplicate board object id/);
});

test('manipulable objects validate through the board contract (the "manipulate it" spine step)', () => {
  const manipulable = {
    id: 'm1', objectType: 'threshold_explorer', renderHint: 'manipulable', region: 'notebook_body',
    grounding: 'analogy', // the interaction itself is a teaching device; its FORMULA is engine-owned
    content: {
      param: { id: 'k', label: 'Steepness (k)', min: 0.2, max: 4, step: 0.2, default: 1 },
      xAxis: { label: 'score', min: -6, max: 6 },
      yAxis: { label: 'P(spam)', min: 0, max: 1 },
      curves: [{ id: 'sig', label: 'Decision curve', formula: 'sigmoid', coeffs: { k: '@param', x0: 0 } }],
      predict: { prompt: 'As k increases, the curve becomes…', choices: ['flatter', 'steeper'], answerIndex: 1 },
    },
  };
  validateBoardObject(manipulable, 'teacher_notebook');
  // A non-whitelisted formula is rejected at the board gate — the engine only computes its own math.
  const evil = { ...manipulable, content: { ...manipulable.content, curves: [{ id: 'e', label: 'E', formula: 'eval_me', coeffs: { k: '@param' } }] } };
  assert.throws(() => validateBoardObject(evil, 'teacher_notebook'), /formula must be one of/);
});
