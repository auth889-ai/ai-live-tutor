import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchStructure, pdbEvidence, PDB_TEACHING } from '../../lib/orchestration/agents/authoring/evidence/rcsb-pdb.js';
import { asOverview, ripeEvidence } from '../../lib/orchestration/agents/authoring/evidence/ripestat.js';

test('RCSB: common name maps to PDB id and parses the structure', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ struct: { title: 'HUMAN OXYHAEMOGLOBIN' }, exptl: [{ method: 'X-RAY DIFFRACTION' }], rcsb_entry_info: { resolution_combined: [2.1] } }) });
  const s = await fetchStructure('hemoglobin', { fetchImpl });
  assert.equal(s.pdbId, PDB_TEACHING.hemoglobin);
  assert.equal(s.resolution, 2.1);
  assert.ok(s.viewerUrl.includes('1HHO'));
});

test('RCSB: a failed fetch returns null, never fabricates', async () => {
  assert.equal(await fetchStructure('insulin', { fetchImpl: async () => ({ ok: false }) }), null);
});

test('RIPEstat: parses real AS ownership', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ data: { holder: 'GOOGLE - Google LLC', announced: true } }) });
  const ov = await asOverview('AS15169', { fetchImpl });
  assert.equal(ov.holder, 'GOOGLE - Google LLC');
  assert.equal(ov.asn, 'AS15169');
});

test('RIPEstat: bare number gets AS prefix; failed fetch -> null', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ data: { holder: 'X' } }) });
  const ov = await asOverview('15169', { fetchImpl });
  assert.equal(ov.asn, 'AS15169');
  assert.equal(await asOverview('1', { fetchImpl: async () => ({ ok: false }) }), null);
});
