import assert from 'node:assert/strict';
import test from 'node:test';
import { iracPresence, iracViolations } from '../../lib/generation/gate/irac-check.js';

test('a conclusion with no application step is flagged (law only)', () => {
  const bad = { scenes: [
    { sceneId: 's1', pedagogicalRole: 'worked_example', objects: [], voiceLines: [
      { id: 'v1', text: 'The rule is that a party may terminate for material breach.' },
      { id: 'v2', text: 'Therefore Karim is entitled to terminate the contract.' } ]},
  ] };
  const v = iracViolations(bad, { domain: 'law' });
  assert.equal(v.length, 1);
  assert.equal(v[0].rule, 'irac-no-application');
  // non-law domains are never checked
  assert.equal(iracViolations(bad, { domain: 'srs' }).length, 0);
});

test('a full IRAC (rule + application + conclusion) passes', () => {
  const good = { scenes: [
    { sceneId: 's1', pedagogicalRole: 'worked_example', objects: [], voiceLines: [
      { id: 'v1', text: 'The rule is that a party may terminate for material breach.' },
      { id: 'v2', text: 'Applying it here, the repeated three-hour delay maps to the deprivation element because the timing was the essence.' },
      { id: 'v3', text: 'Therefore this likely constitutes a material breach.' } ]},
  ] };
  assert.equal(iracViolations(good, { domain: 'law' }).length, 0);
});

test('marker detection identifies the four moves', () => {
  const h = iracPresence('The issue is whether. The rule provides X. Applying here, the facts map. Therefore liable.');
  assert.ok(h.issue && h.rule && h.application && h.conclusion);
});
