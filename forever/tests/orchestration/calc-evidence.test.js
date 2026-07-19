import assert from 'node:assert/strict';
import test from 'node:test';

import { runCalcEvidence, buildCalcEvidenceProgram } from '../../lib/orchestration/agents/authoring/evidence/calc-evidence.js';

// The econ register's canonical case: elasticity from a two-point mini-dataset.
const ECON = {
  dataset: { columns: ['price', 'qty'], rows: [[10, 100], [12, 80]] },
  formulas: [
    { id: 'pct_qty', label: '% change in quantity', expr: '(qty[1]-qty[0])/qty[0]' },
    { id: 'pct_price', label: '% change in price', expr: '(price[1]-price[0])/price[0]' },
    { id: 'elasticity', label: 'price elasticity of demand', expr: 'pct_qty / pct_price' },
    { id: 'revenue_before', label: 'revenue at old price', expr: 'price[0]*qty[0]' },
    { id: 'revenue_after', label: 'revenue at new price', expr: 'price[1]*qty[1]' },
  ],
};

test('econ elasticity chain: every value computed, later formulas see earlier results by id', () => {
  const ev = runCalcEvidence(ECON);
  const val = (id) => ev.results.find((r) => r.id === id).value;
  assert.equal(val('pct_qty'), -0.2);
  assert.equal(val('pct_price'), 0.2);
  assert.equal(val('elasticity'), -1);
  assert.equal(val('revenue_before'), 1000);
  assert.equal(val('revenue_after'), 960);
});

test('a broken formula throws — the engine never returns invented values', () => {
  assert.throws(() => runCalcEvidence({
    dataset: { columns: ['x'], rows: [[1]] },
    formulas: [{ id: 'bad', expr: 'x[0] / nope' }],
  }), /calc evidence failed/);
});

test('no builtins escape: imports and file access are impossible inside a formula', () => {
  assert.throws(() => runCalcEvidence({
    dataset: { columns: ['x'], rows: [[1]] },
    formulas: [{ id: 'evil', expr: '__import__("os").getcwd()' }],
  }), /calc evidence failed/);
});

test('program string is self-contained (Pyodide-ready, no fs, no subprocess)', () => {
  const src = buildCalcEvidenceProgram(ECON);
  assert.ok(src.includes('@@CALCEV'));
  assert.ok(!/open\(|subprocess|import os/.test(src));
});
