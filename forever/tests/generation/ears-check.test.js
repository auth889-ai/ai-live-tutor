import assert from 'node:assert/strict';
import test from 'node:test';

import { checkEarsRequirement, isRequirementText, earsViolations } from '../../lib/generation/gate/ears-check.js';
import { gateLesson } from '../../lib/generation/gate/lesson-gate.js';

test('well-formed EARS requirements pass all five patterns', () => {
  const ok = [
    'The system shall encrypt all stored passwords.',                        // ubiquitous
    'When the user submits the form, the system shall validate every field.', // event-driven
    'While the connection is active, the system shall send a heartbeat.',     // state-driven
    'If the payment fails, then the system shall notify the user.',           // unwanted
    'Where the premium feature is enabled, the system shall show analytics.', // optional
  ];
  for (const r of ok) assert.equal(checkEarsRequirement(r).ok, true, `should pass: ${r}`);
});

test('malformed requirements are caught with a specific reason', () => {
  assert.equal(checkEarsRequirement('The system shall be fast and shall be secure.').ok, false); // two shalls
  assert.equal(checkEarsRequirement('When the user clicks the system shall log in.').ok, false);  // no comma before clause
  assert.equal(checkEarsRequirement('shall do something.').ok, false);                            // no system/actor
});

test('non-requirements (no "shall") are never flagged', () => {
  assert.equal(isRequirementText('This lesson explains requirements engineering.'), false);
  assert.equal(checkEarsRequirement('Requirements should be testable and unambiguous.').ok, true);
});

test('the gate enforces EARS only for the srs domain', () => {
  const bad = { scenes: [{ sceneId: 'sc_01', objects: [{ id: 'r', content: 'The system shall be fast and shall be secure.' }], voiceLines: [] }] };
  assert.equal(earsViolations(bad, { domain: 'srs' }).length, 1);
  assert.equal(earsViolations(bad, { domain: 'law' }).length, 0);
  assert.equal(earsViolations(bad, { domain: 'ml_ai' }).length, 0);

  // and it flows through the real gate under the srs domain
  const full = { scenes: [
    { sceneId: 's1', pedagogicalRole: 'worked_example', objects: [{ id: 'o', content: 'When X, the system shall Y.' }], voiceLines: [{ id: 'v', text: 'The system shall be fast and shall be secure.', targetObjectId: 'o' }], timeline: { actions: [{ id: 'a', voiceLineId: 'v', targetObjectId: 'o' }] } },
    { sceneId: 's2', pedagogicalRole: 'misconception', objects: [{ id: 'o2', content: 'x' }], voiceLines: [{ id: 'v2', text: 'What could go wrong? Consider this.', targetObjectId: 'o2' }], timeline: { actions: [{ id: 'a2', voiceLineId: 'v2', targetObjectId: 'o2' }] } },
    { sceneId: 's3', pedagogicalRole: 'checkpoint', objects: [{ id: 'o3', content: 'x' }], voiceLines: [{ id: 'v3', text: 'ok', targetObjectId: 'o3' }], timeline: { actions: [{ id: 'a3', voiceLineId: 'v3', targetObjectId: 'o3' }] } },
    { sceneId: 's4', pedagogicalRole: 'recap', objects: [{ id: 'o4', content: 'x' }], voiceLines: [{ id: 'v4', text: 'recap', targetObjectId: 'o4' }], timeline: { actions: [{ id: 'a4', voiceLineId: 'v4', targetObjectId: 'o4' }] } },
  ] };
  const g = gateLesson(full, { sourceText: '', domain: 'srs' });
  assert.ok(g.violations.some((v) => v.rule === 'ears-malformed'));
});
