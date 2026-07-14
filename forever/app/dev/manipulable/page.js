'use client';

// Dev preview for the manipulable primitive (same pattern as /dev/chart): three real teaching
// manipulables — ML sigmoid steepness, econ demand-line shift, math parabola — so the
// interaction is verifiable in a browser before any teacher emits it.

import { ManipulableView } from '../../../components/course-player/panels/manipulable-view.js';

const ML_SIGMOID = {
  param: { id: 'k', label: 'Steepness (k)', min: 0.2, max: 4, step: 0.2, default: 1 },
  xAxis: { label: 'spam score', min: -6, max: 6 },
  yAxis: { label: 'P(spam)', min: 0, max: 1 },
  curves: [{ id: 'sig', label: 'Decision curve', formula: 'sigmoid', coeffs: { k: '@param', x0: 0 }, style: 'solid' }],
  readout: { label: 'P at score=1', formula: 'sigmoid', coeffs: { k: '@param', x0: 0 }, at: 1 },
  predict: { prompt: 'As k increases, the S-curve becomes…', choices: ['flatter', 'steeper'], answerIndex: 1 },
};

// The slider drives the demand intercept (income ↑ ⇒ curve shifts up); the pre-shift curve
// stays as a ghost (the MRU move). linear with m fixed and b = @param.
const ECON_DEMAND = {
  param: { id: 'b', label: 'Demand intercept (9 = before; income ↑ ⇒ higher)', min: 5, max: 12, step: 0.5, default: 9 },
  xAxis: { label: 'Quantity (scoops)', min: 0, max: 12 },
  yAxis: { label: 'Price ($)', min: 0, max: 12 },
  curves: [
    { id: 'd0', label: 'Demand (before)', formula: 'linear', coeffs: { m: -0.8, b: 9 }, style: 'ghost' },
    { id: 'd1', label: 'Demand (now)', formula: 'linear', coeffs: { m: -0.8, b: '@param' }, style: 'solid' },
  ],
  readout: { label: 'Price at Q=5', formula: 'linear', coeffs: { m: -0.8, b: '@param' }, at: 5, unit: '$' },
  predict: { prompt: 'If income RISES, the demand curve…', choices: ['shifts right/up', 'shifts left/down', 'stays, movement along it'], answerIndex: 0 },
};

const MATH_PARABOLA = {
  param: { id: 'a', label: 'Coefficient a in y = a·x²', min: -2, max: 2, step: 0.1, default: 1 },
  xAxis: { label: 'x', min: -4, max: 4 },
  yAxis: { label: 'y', min: -8, max: 8 },
  curves: [{ id: 'p', label: 'y = a·x²', formula: 'quadratic', coeffs: { a: '@param', b: 0, c: 0 }, style: 'solid' }],
  readout: { label: 'y at x=2', formula: 'quadratic', coeffs: { a: '@param', b: 0, c: 0 }, at: 2 },
  predict: { prompt: 'When a goes NEGATIVE, the parabola…', choices: ['opens upward', 'flips to open downward', 'becomes a line'], answerIndex: 1 },
};

export default function ManipulableDevPage() {
  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '32px 16px', display: 'grid', gap: 40 }}>
      <h1 style={{ fontSize: 22, color: '#3a3327' }}>Manipulable primitive — dev preview</h1>
      <section><h2 style={{ fontSize: 17, color: '#5a4a2a' }}>ML — sigmoid steepness (predict → drag k)</h2><ManipulableView content={ML_SIGMOID} /></section>
      <section><h2 style={{ fontSize: 17, color: '#5a4a2a' }}>Economics — demand shift (ghost curve stays)</h2><ManipulableView content={ECON_DEMAND} /></section>
      <section><h2 style={{ fontSize: 17, color: '#5a4a2a' }}>Math — parabola coefficient</h2><ManipulableView content={MATH_PARABOLA} /></section>
    </div>
  );
}
