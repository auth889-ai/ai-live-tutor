import assert from 'node:assert/strict';
import test from 'node:test';

import { runTrainEvidence, buildTrainEvidenceProgram } from '../../lib/orchestration/agents/authoring/evidence/train-evidence.js';

// The ML course's own dataset (Rickshaw Fare Predictor).
const RICKSHAW = {
  dataset: { columns: ['distance', 'fare'], rows: [[1, 55], [2, 70], [3, 95], [4, 110], [5, 135], [6, 150], [7, 175], [8, 190], [9, 215], [10, 230]] },
  train: { lr: 0.01, epochs: 200, record: [1, 5, 10, 20, 40, 80, 200] },
};

test('gradient descent REALLY runs: loss strictly decreases and converges toward least squares', () => {
  const ev = runTrainEvidence(RICKSHAW);
  const mses = ev.losses.map((l) => l.mse);
  assert.equal(ev.losses.length, 7);
  for (let i = 1; i < mses.length; i += 1) assert.ok(mses[i] < mses[i - 1], `epoch ${ev.losses[i].epoch} did not improve: ${mses[i]} vs ${mses[i - 1]}`);
  // closed-form least squares for this data: w = 19.848, b = 33.33 — GD heads there, but the
  // bias converges slowly (measured: epoch 200 gives w=21.70, b=20.46) — assert the direction
  assert.ok(Math.abs(ev.final.w - 19.85) < 3, `w=${ev.final.w}`);
  assert.ok(ev.final.mse < 300, `final mse=${ev.final.mse}`);
});

test('determinism: the same spec produces byte-identical results (resume-safe, gate-verifiable)', () => {
  const a = runTrainEvidence(RICKSHAW);
  const b = runTrainEvidence(RICKSHAW);
  assert.deepEqual(a, b);
});

test('a diverging learning rate is still an honest execution — the numbers explode, visibly', () => {
  const ev = runTrainEvidence({ ...RICKSHAW, train: { lr: 0.5, epochs: 10, record: [1, 5, 10] } });
  const mses = ev.losses.map((l) => l.mse);
  assert.ok(mses[2] > mses[0], 'divergence must show growing loss');
});

test('guards: bad specs throw instead of fabricating', () => {
  assert.throws(() => runTrainEvidence({ dataset: { columns: ['x'], rows: [] }, train: { epochs: 10 } }));
  assert.throws(() => runTrainEvidence({ ...RICKSHAW, train: { epochs: 0 } }));
  const src = buildTrainEvidenceProgram(RICKSHAW);
  assert.ok(!/open\(|subprocess|import os/.test(src)); // Pyodide-ready, no I/O
});
