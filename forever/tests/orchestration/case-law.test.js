import assert from 'node:assert/strict';
import test from 'node:test';
import { searchCases, caseLawEvidence } from '../../lib/orchestration/agents/authoring/evidence/case-law.js';

const mockFetch = (results) => async () => ({ ok: true, json: async () => ({ results }) });

test('parses real CourtListener opinions into cited precedents', async () => {
  const ev = await caseLawEvidence('breach', { fetchImpl: mockFetch([
    { caseName: 'Layton Construction Co. v. Shaw', dateFiled: '2016-10-20', citation: ['2016 COA 155'], court: 'Colo. App.', absolute_url: '/opinion/43/layton/' },
  ]) });
  assert.equal(ev.length, 1);
  assert.equal(ev[0].citation, '2016 COA 155');
  assert.equal(ev[0].provenance, 'courtlistener');
  assert.ok(ev[0].url.startsWith('https://www.courtlistener.com'));
});

test('a failed fetch returns [] — NEVER a fabricated case', async () => {
  const failFetch = async () => { throw new Error('offline'); };
  assert.deepEqual(await searchCases('x', { fetchImpl: failFetch }), []);
  assert.deepEqual(await searchCases('x', { fetchImpl: async () => ({ ok: false }) }), []);
});

test('records without a case name or url are dropped', async () => {
  const r = await searchCases('x', { fetchImpl: mockFetch([{ court: 'x' }, { caseName: 'Real v. Case', absolute_url: '/opinion/1/' }]) });
  assert.equal(r.length, 1);
  assert.equal(r[0].caseName, 'Real v. Case');
});
