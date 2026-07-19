import assert from 'node:assert/strict';
import test from 'node:test';

import { teacherFor, SPECIALIST_DOMAINS } from '../../lib/orchestration/agents/planning/teachers/registry.js';
import { DOMAINS, DOMAIN_TEACHING, UNIVERSAL_TEACHING_LAW } from '../../lib/orchestration/agents/planning/domain-teaching.js';

// THE PRODUCT PROMISE: a student uploads ANYTHING -> the router classifies -> a specialist
// teacher architects the course, or the Universal Teacher when nothing matches. This test
// is the wiring proof for all 14 course domains + fallback — no input can fall in a crack.

test('every specialist domain routes to a real teacher with the full interface', () => {
  assert.ok(SPECIALIST_DOMAINS.length >= 15, `only ${SPECIALIST_DOMAINS.length} specialists`);
  for (const domain of SPECIALIST_DOMAINS) {
    const teacher = teacherFor(domain);
    assert.equal(teacher.DOMAIN, domain, `teacher for ${domain} declares DOMAIN=${teacher.DOMAIN}`);
    assert.equal(typeof teacher.designLesson, 'function', `${domain} teacher has no designLesson`);
    assert.equal(typeof teacher.REGISTER, 'string', `${domain} teacher has no REGISTER`);
    assert.ok(teacher.REGISTER.length > 200, `${domain} register suspiciously short`);
  }
});

test('unknown/unmatched domains fall back to the Universal Teacher — never a crash, never a gap', () => {
  for (const weird of ['underwater_basket_weaving', '', null, undefined, 'general']) {
    const teacher = teacherFor(weird);
    assert.equal(typeof teacher.designLesson, 'function');
    assert.ok(!SPECIALIST_DOMAINS.includes(teacher.DOMAIN), `"${weird}" should not hit a specialist`);
  }
});

test('every specialist register carries the BEAT-THE-BEST benchmark and its surpass clause', () => {
  for (const domain of SPECIALIST_DOMAINS) {
    const reg = teacherFor(domain).REGISTER;
    assert.ok(/BEAT-THE-BEST/.test(reg), `${domain} register lacks BEAT-THE-BEST`);
    assert.ok(/SURPASS THE BENCHMARK/.test(reg), `${domain} register lacks the surpass clause`);
  }
});

test('the teaching law every planner receives carries the gate-enforced rules', () => {
  assert.ok(/NUMBER HONESTY/.test(UNIVERSAL_TEACHING_LAW), 'number honesty missing from the law');
  assert.ok(/INSPIRE/.test(UNIVERSAL_TEACHING_LAW), 'INSPIRE tutor voice missing from the law');
  // and the router's domain list covers every specialist (else routing can name a domain no teacher owns)
  for (const domain of SPECIALIST_DOMAINS) {
    assert.ok(DOMAINS.includes(domain) || domain in DOMAIN_TEACHING, `router/teaching map misses ${domain}`);
  }
});
