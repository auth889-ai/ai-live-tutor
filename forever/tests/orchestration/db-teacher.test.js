import assert from 'node:assert/strict';
import test from 'node:test';

import { teacherFor } from '../../lib/orchestration/agents/planning/teachers/registry.js';
import { DOMAINS, DOMAIN_TEACHING, domainRejectRules } from '../../lib/orchestration/agents/planning/domain-teaching.js';

// Course 1 (Database) specialist — model-free scaffolding tests (doc law: test the
// wiring and the contract, never the model).

test('data_db is a first-class domain with its own specialist teacher', () => {
  assert.ok(DOMAINS.includes('data_db'));
  const t = teacherFor('data_db');
  assert.equal(t.DOMAIN, 'data_db');
  assert.equal(typeof t.designLesson, 'function');
});

test('the register enforces measured evidence, predict-before-reveal and same-answer proofs', () => {
  const reg = DOMAIN_TEACHING.data_db;
  assert.match(reg, /sql-evidence/);
  assert.match(reg, /PREDICT beat/);
  assert.match(reg, /same-answer proof/);
  assert.match(reg, /never a generated image/);
  assert.match(reg, /NEVER: numbers the engine did not produce/);
});

test('reject rules for data_db carry the measured-evidence law for the critic', () => {
  const rules = domainRejectRules('data_db');
  assert.match(String(rules), /executed evidence|REJECT THIS LESSON WHEN/i);
});
