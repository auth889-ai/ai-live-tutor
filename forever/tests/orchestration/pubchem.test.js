import assert from 'node:assert/strict';
import test from 'node:test';
import { lookupCompound, verifyMolecularWeight, pubchemEvidence } from '../../lib/orchestration/agents/authoring/evidence/pubchem.js';

const mockFetch = (mw, formula = 'HNaO', cid = 14798) => async () => ({
  ok: true,
  json: async () => ({ PropertyTable: { Properties: [{ MolecularFormula: formula, MolecularWeight: mw, CID: cid }] } }),
});

test('lookupCompound parses PubChem properties', async () => {
  const hit = await lookupCompound('sodium hydroxide', { fetchImpl: mockFetch(39.997) });
  assert.equal(hit.molecularWeight, 39.997);
  assert.equal(hit.formula, 'HNaO');
});

test('verifyMolecularWeight accepts a claim within tolerance, rejects a wrong one', async () => {
  const ok = await verifyMolecularWeight('sodium hydroxide', 40, { fetchImpl: mockFetch(39.997) });
  assert.equal(ok.ok, true);
  const bad = await verifyMolecularWeight('sodium hydroxide', 58, { fetchImpl: mockFetch(39.997) });
  assert.equal(bad.ok, false);
});

test('network failure returns null / not-checked — NEVER a fabricated value', async () => {
  const failFetch = async () => { throw new Error('offline'); };
  assert.equal(await lookupCompound('water', { fetchImpl: failFetch }), null);
  const v = await verifyMolecularWeight('water', 18, { fetchImpl: failFetch });
  assert.equal(v.checked, false);
});

test('evidence rows built from real lookups', async () => {
  const rows = await pubchemEvidence(['sodium hydroxide'], { fetchImpl: mockFetch(39.997) });
  assert.ok(rows[0][2].includes('39.997 g/mol'));
});
