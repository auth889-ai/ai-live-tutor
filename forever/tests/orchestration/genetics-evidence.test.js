import assert from 'node:assert/strict';
import test from 'node:test';
import { punnettCross, hardyWeinberg, geneticsEvidence } from '../../lib/orchestration/agents/authoring/evidence/genetics-evidence.js';

test('Tt x Tt gives the classic 1:2:1 genotype and 3:1 phenotype — computed, not asserted', () => {
  const c = punnettCross({ parent1: 'Tt', parent2: 'Tt', dominant: 'T' });
  assert.deepEqual(c.genotypeCounts, { TT: 1, Tt: 2, tt: 1 });
  assert.equal(c.phenotypeRatio.dominant, 3);
  assert.equal(c.phenotypeRatio.recessive, 1);
});

test('TT x tt gives all heterozygous, 100% dominant phenotype (test cross)', () => {
  const c = punnettCross({ parent1: 'TT', parent2: 'tt', dominant: 'T' });
  assert.equal(c.phenotypeCounts.dominant, 4);
  assert.equal(c.phenotypeCounts.recessive, 0);
});

test('Hardy-Weinberg at p=0.6 gives 0.36 : 0.48 : 0.16 and sums to exactly 1', () => {
  const h = hardyWeinberg({ p: 0.6 });
  assert.equal(h.homozygousDominant, 0.36);
  assert.equal(h.heterozygous, 0.48);
  assert.equal(h.homozygousRecessive, 0.16);
  assert.equal(h.sum, 1);
});

test('evidence rows are produced for a lesson spec', () => {
  const rows = geneticsEvidence({ punnett: { parent1: 'Tt', parent2: 'Tt', dominant: 'T' }, hardyWeinberg: { p: 0.6 } });
  assert.ok(rows.length >= 2);
  assert.ok(rows.some((r) => String(r[2]).includes('3 dominant : 1 recessive')));
});

test('guards reject malformed genotypes and frequencies', () => {
  assert.throws(() => punnettCross({ parent1: 'T', parent2: 'Tt', dominant: 'T' }));
  assert.throws(() => hardyWeinberg({ p: 1.5 }));
});
