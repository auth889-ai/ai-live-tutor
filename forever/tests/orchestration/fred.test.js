import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchSeries, fredEvidence, FRED_SERIES } from '../../lib/orchestration/agents/authoring/evidence/fred.js';

const mockFetch = () => async (url) => {
  if (String(url).includes('/series/observations')) {
    return { ok: true, json: async () => ({ observations: [
      { date: '2026-01-01', value: '3.1' }, { date: '2025-12-01', value: '3.0' }, { date: '2025-11-01', value: '.' },
    ] }) };
  }
  return { ok: true, json: async () => ({ seriess: [{ title: 'Unemployment Rate', units_short: '%' }] }) };
};

test('fetchSeries maps a friendly key to the real series id and returns chronological data', async () => {
  const s = await fetchSeries('unemployment', { fetchImpl: mockFetch(), env: { FRED_API_KEY: 'x' } });
  assert.equal(s.series, FRED_SERIES.unemployment);
  assert.equal(s.observations.length, 2); // the '.' missing value is dropped
  assert.equal(s.observations.at(-1).date, '2026-01-01'); // reversed to chronological
});

test('NO KEY -> null, never fabricates data', async () => {
  assert.equal(await fetchSeries('gdp', { fetchImpl: mockFetch(), env: {} }), null);
});

test('fredEvidence builds a citable row with the FRED series id and change', async () => {
  const rows = await fredEvidence(['unemployment'], { fetchImpl: mockFetch(), env: { FRED_API_KEY: 'x' } });
  assert.ok(rows[0][0].includes('FRED'));
  assert.ok(String(rows[0][2]).includes('3.1'));
});
