import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FORMULAS, resolveCoeffs, computeCurvePoints, computeReadout, toChartContent, validateManipulableContent,
} from '../../../lib/board/manipulable/manipulable-content.js';

// An ML decision-threshold manipulable: the student drags the sigmoid steepness k and watches the
// decision curve sharpen — the SpatialMath "manipulate it" interaction, computed by the engine.
const ML = {
  param: { id: 'k', label: 'Steepness (k)', min: 0.2, max: 4, step: 0.2, default: 1, unit: '' },
  xAxis: { label: 'score', min: -6, max: 6 },
  yAxis: { label: 'P(spam)', min: 0, max: 1 },
  curves: [{ id: 'sig', label: 'Logistic', formula: 'sigmoid', coeffs: { k: '@param', x0: 0 }, style: 'solid' }],
  readout: { label: 'P at score=1', formula: 'sigmoid', coeffs: { k: '@param', x0: 0 }, at: 1, unit: '' },
  predict: { prompt: 'As k increases, the S-curve becomes…', choices: ['flatter', 'steeper'], answerIndex: 1 },
};

test('the whitelisted formulas are pure and deterministic — the number on screen is REAL', () => {
  assert.equal(FORMULAS.linear(2, { m: 3, b: 1 }), 7);
  assert.equal(FORMULAS.quadratic(2, { a: 1, b: 0, c: 0 }), 4);
  assert.equal(Number(FORMULAS.sigmoid(0, { k: 1, x0: 0 }).toFixed(3)), 0.5);
  assert.equal(Number(FORMULAS.expDecay(0, { A: 5, k: 0.3 }).toFixed(3)), 5);
});

test('resolveCoeffs substitutes the live slider value for @param, leaves fixed coeffs alone', () => {
  assert.deepEqual(resolveCoeffs({ k: '@param', x0: 0 }, 2.5), { k: 2.5, x0: 0 });
});

test('moving the parameter RECOMPUTES the curve — a steeper k gives a sharper transition', () => {
  const flat = computeCurvePoints(ML.curves[0], ML.xAxis, ML.yAxis, 0.5);
  const steep = computeCurvePoints(ML.curves[0], ML.xAxis, ML.yAxis, 4);
  // At the same positive score, a steeper k pushes probability closer to 1.
  const at3 = (pts) => pts.find(([x]) => Math.abs(x - 3) < 0.2)[1];
  assert.ok(at3(steep) > at3(flat), 'steeper k => higher P(spam) at score=3');
  // Every point stays inside the declared axes (clamped) — never an off-scale lie.
  assert.ok(steep.every(([, y]) => y >= ML.yAxis.min && y <= ML.yAxis.max));
});

test('the scalar readout is computed live from the parameter', () => {
  const r = computeReadout(ML.readout, 1);
  assert.equal(r.label, 'P at score=1');
  assert.equal(r.value, Number((1 / (1 + Math.exp(-1))).toFixed(4)));
});

test('toChartContent recomputes into the existing chart shape so the tested renderer is reused', () => {
  const chart = toChartContent(ML, 2);
  assert.deepEqual(Object.keys(chart).sort(), ['annotations', 'series', 'xAxis', 'yAxis']);
  assert.equal(chart.series.length, 1);
  assert.ok(chart.series[0].points.length > 10, 'sampled into a smooth curve');
});

test('validate accepts a real manipulable', () => {
  assert.equal(validateManipulableContent(ML), ML);
});

test('validate REJECTS a decorative slider that drives nothing', () => {
  const dead = { ...ML, readout: undefined, curves: [{ id: 'c', label: 'L', formula: 'linear', coeffs: { m: 1, b: 0 } }], predict: undefined };
  assert.throws(() => validateManipulableContent(dead), /drives nothing/);
});

test('validate REJECTS an unknown formula (the engine only computes the whitelist)', () => {
  const bad = { ...ML, curves: [{ id: 'c', label: 'L', formula: 'eval_this', coeffs: { k: '@param' } }] };
  assert.throws(() => validateManipulableContent(bad), /formula must be one of/);
});

test('validate REJECTS a param whose default is out of range', () => {
  const bad = { ...ML, param: { ...ML.param, default: 99 } };
  assert.throws(() => validateManipulableContent(bad), /default must be a number within/);
});
