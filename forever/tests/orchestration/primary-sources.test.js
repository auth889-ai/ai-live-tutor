import assert from 'node:assert/strict';
import test from 'node:test';
import { searchPrimarySources, primarySourceEvidence } from '../../lib/orchestration/agents/authoring/evidence/primary-sources.js';

const mockFetch = (results) => async () => ({ ok: true, json: async () => ({ results }) });

test('parses real LoC result records into sourced documents', async () => {
  const fetchImpl = mockFetch([
    { title: 'Maryland suffrage news, 1916', date: '1916-10-14', description: ['Women marched for the vote'], id: 'http://www.loc.gov/resource/x/1916-10-14/', location_city: ['Baltimore'] },
  ]);
  const ev = await primarySourceEvidence('suffrage', { fetchImpl });
  assert.equal(ev.length, 1);
  assert.equal(ev[0].date, '1916-10-14');
  assert.equal(ev[0].provenance, 'chronicling-america');
  assert.ok(ev[0].url.startsWith('http'));
  assert.ok(ev[0].quote.includes('marched'));
});

test('a failed fetch returns [] — NEVER a fabricated source', async () => {
  const failFetch = async () => { throw new Error('offline'); };
  assert.deepEqual(await searchPrimarySources('anything', { fetchImpl: failFetch }), []);
  const bad = async () => ({ ok: false });
  assert.deepEqual(await searchPrimarySources('anything', { fetchImpl: bad }), []);
});

test('records without a title or url are dropped (no half-sources)', async () => {
  const fetchImpl = mockFetch([{ description: ['orphan text'] }, { title: 'Real', id: 'http://x', description: ['ok'] }]);
  const r = await searchPrimarySources('x', { fetchImpl });
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'Real');
});
