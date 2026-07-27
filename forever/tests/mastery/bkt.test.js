import assert from 'node:assert/strict';
import test from 'node:test';

import { BKT_DEFAULTS, createBktModel, updateBkt } from '../../lib/mastery/bkt.js';

test('defaults match the documented parameterization', () => {
  const model = createBktModel();
  assert.deepEqual(model, {
    probMastery: 0.3,
    probTransit: 0.15,
    probGuess: 0.25,
    probSlip: 0.1,
  });
});

test('a correct answer raises mastery', () => {
  const model = createBktModel();
  const next = updateBkt(model, true);
  assert.ok(next.probMastery > model.probMastery, `expected ${next.probMastery} > ${model.probMastery}`);
});

test('a wrong answer lowers mastery from the default prior', () => {
  const model = createBktModel();
  const next = updateBkt(model, false);
  assert.ok(next.probMastery < model.probMastery, `expected ${next.probMastery} < ${model.probMastery}`);
});

test('guess/slip bounds hold: one observation never yields certainty from a non-degenerate prior', () => {
  for (const params of [
    {},
    { probMastery: 0.999, probGuess: 0.4, probSlip: 0.3 },
    { probMastery: 0.001, probGuess: 0.05, probSlip: 0.05 },
  ]) {
    const model = createBktModel(params);
    for (const isCorrect of [true, false]) {
      const next = updateBkt(model, isCorrect);
      assert.ok(next.probMastery > 0 && next.probMastery < 1, `mastery ${next.probMastery} escaped (0, 1)`);
    }
  }
});

test('long streaks never escape [0, 1] or go non-finite', () => {
  for (const params of [{}, { probMastery: 0.999, probGuess: 0.4, probSlip: 0.3 }]) {
    let model = createBktModel(params);
    const answers = [true, true, false, true, false, false, true, ...Array(30).fill(false), ...Array(30).fill(true)];
    for (const isCorrect of answers) {
      model = updateBkt(model, isCorrect);
      assert.ok(Number.isFinite(model.probMastery), `mastery went non-finite: ${model.probMastery}`);
      assert.ok(model.probMastery >= 0 && model.probMastery <= 1, `mastery ${model.probMastery} escaped [0, 1]`);
    }
  }
});

test('evidence keeps its meaning: correct beats wrong from the same state', () => {
  const model = createBktModel();
  assert.ok(updateBkt(model, true).probMastery > updateBkt(model, false).probMastery);
});

test('repeated correct answers converge above 0.95', () => {
  let model = createBktModel();
  for (let i = 0; i < 20; i += 1) model = updateBkt(model, true);
  assert.ok(model.probMastery > 0.95, `after 20 correct answers mastery is ${model.probMastery}`);
});

test('update is pure: input model untouched, other params carried over, same input same output', () => {
  const model = createBktModel();
  const frozen = Object.freeze({ ...model });
  const a = updateBkt(frozen, true); // throws in strict mode if updateBkt mutated its input
  const b = updateBkt(frozen, true);
  assert.deepEqual(frozen, model);
  assert.deepEqual(a, b);
  assert.notEqual(a, frozen);
  assert.equal(a.probTransit, model.probTransit);
  assert.equal(a.probGuess, model.probGuess);
  assert.equal(a.probSlip, model.probSlip);
});

test('createBktModel rejects out-of-range and degenerate parameters', () => {
  assert.throws(() => createBktModel({ probMastery: 0 }));
  assert.throws(() => createBktModel({ probSlip: 1 }));
  assert.throws(() => createBktModel({ probGuess: 'high' }));
  assert.throws(() => createBktModel({ probGuess: 0.6, probSlip: 0.4 })); // guess + slip >= 1
  assert.equal(BKT_DEFAULTS.probGuess + BKT_DEFAULTS.probSlip < 1, true);
});
