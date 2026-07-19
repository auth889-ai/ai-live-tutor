import assert from 'node:assert/strict';
import test from 'node:test';

import { checkBalance, balanceViolations } from '../../lib/generation/gate/chem-balance.js';
import { gateLesson } from '../../lib/generation/gate/lesson-gate.js';

test('balanced equations pass, including coefficients and groups', () => {
  assert.equal(checkBalance('CH4 + 2 O2 -> CO2 + 2 H2O').ok, true);
  assert.equal(checkBalance('NaOH + HCl -> NaCl + H2O').ok, true);
  assert.equal(checkBalance('2 H2 + O2 -> 2 H2O').ok, true);
  assert.equal(checkBalance('Ca(OH)2 + 2 HCl -> CaCl2 + 2 H2O').ok, true); // parenthesized group
});

test('unbalanced equations are caught with the offending element', () => {
  const r = checkBalance('CH4 + O2 -> CO2 + 2 H2O'); // O: 2 left vs 4 right
  assert.equal(r.ok, false);
  assert.match(r.reason, /O:/);
  assert.equal(checkBalance('H2 + O2 -> H2O').ok, false); // O: 2 vs 1
});

test('the gate enforces balance only for the chemistry domain', () => {
  const bad = { scenes: [{ sceneId: 'sc_01', objects: [], voiceLines: [{ id: 'v', text: 'The reaction H2 + O2 -> H2O releases energy.' }] }] };
  assert.equal(balanceViolations(bad, { domain: 'chemistry' }).length, 1);
  assert.equal(balanceViolations(bad, { domain: 'physics' }).length, 0);
});

test('a chemistry lesson with an unbalanced equation fails the real gate', () => {
  const s = (id, role, text) => ({ sceneId: id, pedagogicalRole: role, objects: [{ id: id + 'o', content: 'x' }], voiceLines: [{ id: id + 'v', text, targetObjectId: id + 'o' }], timeline: { actions: [{ id: id + 'a', voiceLineId: id + 'v', targetObjectId: id + 'o' }] } });
  const lesson = { scenes: [
    s('s1', 'worked_example', 'Consider H2 + O2 -> H2O as our example. What do you predict?'),
    s('s2', 'misconception', 'A common error is to forget coefficients.'),
    s('s3', 'checkpoint', 'Your turn to balance it.'),
    s('s4', 'recap', 'We balanced the equation today.'),
  ] };
  const g = gateLesson(lesson, { sourceText: '', domain: 'chemistry' });
  assert.ok(g.violations.some((v) => v.rule === 'equation-unbalanced'), JSON.stringify(g.violations.map((v) => v.rule)));

  // the balanced version has no balance violation
  const good = { scenes: [
    s('s1', 'worked_example', 'Consider 2 H2 + O2 -> 2 H2O as our example. What do you predict?'),
    s('s2', 'misconception', 'x'), s('s3', 'checkpoint', 'x'), s('s4', 'recap', 'x'),
  ] };
  assert.ok(!gateLesson(good, { sourceText: '', domain: 'chemistry' }).violations.some((v) => v.rule === 'equation-unbalanced'));
});
