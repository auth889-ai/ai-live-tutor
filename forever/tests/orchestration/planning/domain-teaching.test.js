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

test('BLUEPRINTS: every domain carries a required LESSON FLOW (the 14-course spec, enforced)', () => {
  for (const d of DOMAINS) {
    assert.ok(DOMAIN_TEACHING[d].includes('LESSON FLOW:'), `${d} declares its lesson flow`);
  }
  assert.ok(DOMAIN_TEACHING.systems_swe.includes('tradeoff matrix'), 'architecture walks the tradeoff beat');
  assert.ok(DOMAIN_TEACHING.systems_swe.includes('failure scenario'), 'architecture walks the failure beat');
  assert.ok(DOMAIN_TEACHING.systems_swe.includes('SYN'), 'networking names the handshake highlight');
  assert.ok(DOMAIN_TEACHING.history_humanities.includes('IRAC'), 'law reasons through IRAC');
  assert.ok(DOMAIN_TEACHING.math.includes('ONE transformation per beat'), 'math derives one visible step at a time');
  assert.ok(DOMAIN_TEACHING.science.includes('label'), 'science labels the source figure');
});

test('THE UNIVERSAL LAW exists and demands visible referents + the checkpoint anatomy', async () => {
  const { UNIVERSAL_TEACHING_LAW } = await import('../../../lib/orchestration/agents/planning/domain-teaching.js');
  for (const phrase of ['visible referent', 'concrete example', 'mistake', 'quiz or practice', 'recap']) {
    assert.ok(UNIVERSAL_TEACHING_LAW.includes(phrase), `the law demands: ${phrase}`);
  }
});
