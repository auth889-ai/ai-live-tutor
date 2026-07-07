import assert from 'node:assert/strict';
import test from 'node:test';

import { DOMAINS, teachingFor, DOMAIN_TEACHING } from '../../../lib/orchestration/agents/planning/domain-teaching.js';

test('every domain has distinct teaching conventions', () => {
  for (const d of DOMAINS) {
    assert.ok(typeof DOMAIN_TEACHING[d] === 'string' && DOMAIN_TEACHING[d].length > 40, `${d} has conventions`);
  }
  assert.ok(DOMAIN_TEACHING.dsa.includes('BRUTE'), 'dsa teaches brute->better->optimal');
  assert.ok(DOMAIN_TEACHING.ml_ai.toLowerCase().includes('intuition'), 'ml teaches intuition-first');
});

test('teachingFor falls back to general for an unknown domain', () => {
  assert.equal(teachingFor('quantum_astrology'), DOMAIN_TEACHING.general);
  assert.equal(teachingFor('dsa'), DOMAIN_TEACHING.dsa);
});
