import assert from 'node:assert/strict';
import test from 'node:test';
import { repairLessonPayload } from '../../lib/generation/gate/lesson-repair.js';

const scene = (id, role, text) => ({ sceneId: id, title: role, pedagogicalRole: role,
  objects: [{ id: id + 'o', objectType: 't', renderHint: 'text', region: 'notebook_area', content: 'x', sourceRef: { chunkId: 'c1' } }],
  voiceLines: [{ id: id + 'v', text, targetObjectId: id + 'o' }],
  timeline: { sceneId: id, actions: [{ id: id + 'a', kind: 'point', targetObjectId: id + 'o' }] } });

test('a law lesson gets a REAL precedent object injected from the (mocked) case-law API', async () => {
  const payload = { scenes: [
    scene('s1', 'worked_example', 'What is the rule? Applying it here, therefore liable.'),
    scene('s2', 'misconception', 'x'), scene('s3', 'checkpoint', 'x'), scene('s4', 'recap', 'x'),
  ] };
  await repairLessonPayload(payload, {
    sourceText: 'contract breach', domain: 'law', lessonTitle: 'Breach',
    agents: {
      runAgentChain: async () => ({ json: { query: 'material breach' } }),
      caseLawEvidence: async () => ([{ caseName: 'Real v. Case', court: 'Sup. Ct.', date: '2016-10-20', citation: '2016 COA 155', url: 'https://www.courtlistener.com/opinion/1/' }]),
    },
  });
  const injected = payload.scenes.flatMap((s) => s.objects).find((o) => o.id === 'real_precedents');
  assert.ok(injected, 'real precedent object should be injected');
  assert.equal(injected.sourceRef.provenance, 'courtlistener');
  assert.ok(injected.content.rows[0].some((c) => String(c).includes('Real v. Case')));
});

test('a history lesson gets a REAL primary source injected (mocked LoC)', async () => {
  const payload = { scenes: [
    scene('s1', 'worked_example', 'What happened? Consider this event.'),
    scene('s2', 'misconception', 'x'), scene('s3', 'checkpoint', 'x'), scene('s4', 'recap', 'x'),
  ] };
  await repairLessonPayload(payload, {
    sourceText: 'suffrage', domain: 'history', lessonTitle: 'Suffrage',
    agents: {
      runAgentChain: async () => ({ json: { query: 'women suffrage' } }),
      primarySourceEvidence: async () => ([{ title: 'Suffrage News 1916', place: 'Baltimore', date: '1916-10-14', quote: 'Women marched', url: 'https://www.loc.gov/resource/x/' }]),
    },
  });
  const injected = payload.scenes.flatMap((s) => s.objects).find((o) => o.id === 'real_primary_sources');
  assert.ok(injected);
  assert.equal(injected.sourceRef.provenance, 'chronicling-america');
});

test('a fetch that returns nothing injects no object (never fabricates)', async () => {
  const payload = { scenes: [
    scene('s1', 'worked_example', 'What is the rule? Applying it, therefore liable.'),
    scene('s2', 'misconception', 'x'), scene('s3', 'checkpoint', 'x'), scene('s4', 'recap', 'x'),
  ] };
  await repairLessonPayload(payload, {
    sourceText: 'x', domain: 'law', lessonTitle: 'X',
    agents: { runAgentChain: async () => ({ json: { query: 'x' } }), caseLawEvidence: async () => ([]) },
  });
  assert.ok(!payload.scenes.flatMap((s) => s.objects).some((o) => o.id === 'real_precedents'));
});
