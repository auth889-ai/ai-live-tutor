import assert from 'node:assert/strict';
import test from 'node:test';

import { generateVariations, calcSpecFromLesson } from '../../lib/generation/practice/variation-engine.js';

// The Econ course's real evidence spec shape.
const SPEC = {
  dataset: { columns: ['price', 'qty'], rows: [[10, 100], [12, 80]] },
  formulas: [
    { id: 'pct_qty', label: 'percent change in quantity', expr: '(qty[1]-qty[0])/qty[0]' },
    { id: 'pct_price', label: 'percent change in price', expr: '(price[1]-price[0])/price[0]' },
    { id: 'elasticity', label: 'price elasticity of demand', expr: 'pct_qty / pct_price' },
    { id: 'revenue_before', label: 'revenue at the old price', expr: 'price[0]*qty[0]' },
  ],
};

test('every variant answer is ENGINE-computed: scaling laws come out true, not asserted', () => {
  const variants = generateVariations(SPEC, { factors: [2] });
  const level1 = variants.find((v) => v.level === 1);
  const level2 = variants.find((v) => v.level === 2 && v.factor === 2);

  // level 1 = the lesson's own executed values
  assert.equal(level1.questions.find((q) => q.id === 'v1_elasticity').answer, -1);
  assert.equal(level1.questions.find((q) => q.id === 'v1_revenue_before').answer, 1000);

  // at 2x data: elasticity is INVARIANT (ratios survive rescaling), revenue is 4x (price and qty both doubled)
  const el2 = level2.questions.find((q) => q.id.endsWith('_elasticity'));
  const rev2 = level2.questions.find((q) => q.id.endsWith('_revenue_before'));
  assert.equal(el2.answer, -1);
  assert.equal(el2.invariant, true);
  assert.equal(rev2.answer, 4000);
  assert.equal(rev2.invariant, false);
});

test('level 3 prompts demand the WHY, split by invariance, with both values named', () => {
  const variants = generateVariations(SPEC, { factors: [2] });
  const level3 = variants.find((v) => v.level === 3);
  const el = level3.questions.find((q) => q.id.endsWith('_elasticity'));
  const rev = level3.questions.find((q) => q.id.endsWith('_revenue_before'));
  assert.ok(/STILL -1/.test(el.prompt) && /unchanged/.test(el.prompt));
  assert.ok(/1000 to 4000/.test(rev.prompt));
});

test('determinism: identical packs on rerun (resume-safe, cacheable)', () => {
  assert.deepEqual(generateVariations(SPEC), generateVariations(SPEC));
});

test('calcSpecFromLesson extracts a runnable spec from a stored computed_evidence object', () => {
  const payload = { scenes: [{ sceneId: 'sc_01', objects: [{
    id: 'computed_evidence', sourceRef: { engine: 'calc-evidence', provenance: 'executed' },
    content: {
      dataset: SPEC.dataset,
      rows: [['price elasticity of demand', 'pct qty / pct price', '-1'], ['MSE after epoch 5 (executed gradient descent, lr=0.01)', 'epoch 5', '189.3']],
    },
  }] }] };
  const spec = calcSpecFromLesson(payload);
  assert.ok(spec);
  assert.equal(spec.formulas.length, 1); // the training ROW is a run, not a re-runnable formula
  assert.equal(spec.formulas[0].label, 'price elasticity of demand');
});

test('a formula that breaks under scaling is skipped, never faked', () => {
  const spec = {
    dataset: { columns: ['x'], rows: [[10]] },
    formulas: [{ id: 'inv', label: 'inverse of shifted x', expr: '1 / (x[0] - 20)' }],
  };
  const variants = generateVariations(spec, { factors: [2] }); // 2x -> x=20 -> division by zero
  assert.ok(variants.find((v) => v.level === 1)); // base still there
  assert.ok(!variants.some((v) => v.level === 2 && v.factor === 2)); // broken variant absent, not invented
});
