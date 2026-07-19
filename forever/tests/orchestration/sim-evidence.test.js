import assert from 'node:assert/strict';
import test from 'node:test';

import { runSimEvidence, buildSimEvidenceProgram } from '../../lib/orchestration/agents/authoring/evidence/sim-evidence.js';

test('1D kinematics REALLY integrates: constant accel matches v = v0 + a t closely', () => {
  // bus from rest at a=2 m/s^2 — after ~5s should be near 10 m/s (Euler with dt=0.01)
  const ev = runSimEvidence({ model: 'kinematics_1d', params: { v0: 0, a: 2, dt: 0.01, steps: 500 }, record: [0, 250, 500] });
  const at = (step) => ev.rows.find((r) => r.step === step);
  assert.equal(at(0).v, 0);
  assert.ok(Math.abs(at(500).v - 10) < 0.05, `v at 5s = ${at(500).v}`);
  assert.ok(at(500).x > at(250).x, 'position increases');
});

test('2D projectile: 45° gives the analytic range, apex time is v0 sin/g', () => {
  const ev = runSimEvidence({ model: 'projectile_2d', params: { v0: 20, angleDeg: 45, g: 9.8, dt: 0.001, steps: 3000 }, record: [0] });
  // analytic range = v0^2 sin(2a)/g = 400*1/9.8 ≈ 40.8
  assert.ok(Math.abs(ev.summary.range - 40.8) < 0.2, `range=${ev.summary.range}`);
  assert.ok(Math.abs(ev.summary.peak_time - 1.443) < 0.05, `peak=${ev.summary.peak_time}`);
});

test('determinism: identical runs (fixed dt, no randomness)', () => {
  const a = runSimEvidence({ model: 'kinematics_1d', params: { v0: 5, a: -4, dt: 0.01, steps: 100 } });
  const b = runSimEvidence({ model: 'kinematics_1d', params: { v0: 5, a: -4, dt: 0.01, steps: 100 } });
  assert.deepEqual(a, b);
});

test('guards + Pyodide-ready program (no fs/subprocess in the string)', () => {
  assert.throws(() => runSimEvidence({ model: 'warp_drive', params: { steps: 10 } }));
  assert.throws(() => runSimEvidence({ model: 'kinematics_1d', params: { steps: 0 } }));
  const src = buildSimEvidenceProgram({ model: 'kinematics_1d', params: { v0: 0, a: 1, dt: 0.1, steps: 5 } });
  assert.ok(!/open\(|subprocess|import os/.test(src));
});
