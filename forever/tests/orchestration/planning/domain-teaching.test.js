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

test('domainRejectRules extracts THIS subject\'s non-negotiable rules for the Pedagogy Critic to ENFORCE', async () => {
  const { domainRejectRules } = await import('../../../lib/orchestration/agents/planning/domain-teaching.js');
  // The rules a world-class teacher of each subject never breaks — pulled from the register so
  // the critic can reject a lesson that violates them (a prompt is a hope; a rejecting critic is
  // a guarantee). Each domain's rules genuinely DIFFER — that is what makes the 14 specialists real.
  const math = domainRejectRules('math');
  assert.match(math, /NEVER: formula-first/, 'math forbids formula-first');
  assert.match(math, /REJECT THIS LESSON WHEN/, 'math carries reject rules');
  const physics = domainRejectRules('physics');
  assert.match(physics, /staked prediction/, 'physics demands a staked prediction');
  const law = domainRejectRules('law');
  assert.match(law, /conclusion appears before adversarial application/, 'law forbids conclusion-before-application');
  // The rules are subject-SPECIFIC, not one generic block reused everywhere.
  assert.notEqual(math, physics);
  assert.notEqual(physics, law);
  // Only the enforceable lines are extracted (LEARNER ACTIONS / REJECT / NEVER), not the whole register.
  assert.ok(!math.includes('LESSON FLOW:'), 'the extractor keeps only the enforceable rules, not the flow');
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

test('THE UNIVERSAL LAW (refined): synchronized referents for spatial/quantitative/procedural/evidence claims + the full spine', async () => {
  const { UNIVERSAL_TEACHING_LAW } = await import('../../../lib/orchestration/agents/planning/domain-teaching.js');
  // Refined per the world-class-teaching research: warmth/transition sentences are exempt;
  // SPATIAL/QUANTITATIVE/PROCEDURAL/EVIDENCE claims require a synchronized referent, and the
  // spine adds learner action, transfer, and a DESCRIPTIVE checkpoint.
  for (const phrase of ['QUANTITATIVE', 'SYNCHRONIZED visible or inspectable referent', 'concrete anchor', 'misconception', 'TRANSFER', 'DESCRIPTIVE scenario question', 'recap', 'PREDICTION or action']) {
    assert.ok(UNIVERSAL_TEACHING_LAW.includes(phrase), `the law demands: ${phrase}`);
  }
  // The canonical spine (specialist-teachers-spec.md): See it -> predict it -> MANIPULATE it ->
  // explain it -> transfer it -> retrieve it later. The MANIPULATE beat (change one condition,
  // show the changed result) and CHALLENGED-with-evidence misconception are non-negotiable.
  assert.ok(UNIVERSAL_TEACHING_LAW.includes('MANIPULATE IT'), 'the spine includes the manipulate beat');
  assert.ok(UNIVERSAL_TEACHING_LAW.includes('RETRIEVE IT LATER'), 'the spine ends in later retrieval');
  assert.ok(/CHALLENGED with evidence/.test(UNIVERSAL_TEACHING_LAW), 'a misconception must be challenged, not merely stated');
});
