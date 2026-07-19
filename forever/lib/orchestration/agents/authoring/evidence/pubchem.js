// PUBCHEM INTEGRATION — chemistry's external truth source (NIH PubChem PUG REST, the world's
// largest free chemical database, NO API KEY required). A chemistry lesson can now cite the
// REAL molecular weight and formula of a compound instead of a hand-typed number — "NaOH is
// 40 g/mol" becomes a database-verified fact. This is a tool a human tutor cannot invoke
// mid-lesson; the agent looks it up live.
//
// Network-dependent (graceful): a lookup failure returns null, never a fabricated value —
// the caller falls back to the deterministic chem-balance engine. Injectable fetch for tests.

const BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';

// name -> { name, formula, molecularWeight, cid } or null (never invents).
export async function lookupCompound(name, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const clean = String(name ?? '').trim();
  if (!clean) return null;
  const url = `${BASE}/compound/name/${encodeURIComponent(clean)}/property/MolecularFormula,MolecularWeight/JSON`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetchImpl(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    const props = json?.PropertyTable?.Properties?.[0];
    if (!props) return null;
    return {
      name: clean,
      formula: props.MolecularFormula ?? null,
      molecularWeight: props.MolecularWeight != null ? Number(props.MolecularWeight) : null,
      cid: props.CID ?? null,
    };
  } catch {
    return null; // network error / timeout / abort — never fabricate
  }
}

// Verify a lesson's claimed molecular weight against PubChem (within tolerance for rounding).
export async function verifyMolecularWeight(name, claimedMW, opts = {}) {
  const hit = await lookupCompound(name, opts);
  if (!hit || hit.molecularWeight == null) return { checked: false, reason: 'not found / offline' };
  const diff = Math.abs(hit.molecularWeight - Number(claimedMW));
  return {
    checked: true,
    ok: diff <= Math.max(0.5, hit.molecularWeight * 0.01),
    real: hit.molecularWeight,
    claimed: Number(claimedMW),
    formula: hit.formula,
  };
}

// Build citable chemistry evidence rows from real PubChem lookups.
export async function pubchemEvidence(compoundNames, opts = {}) {
  const rows = [];
  for (const name of compoundNames ?? []) {
    const hit = await lookupCompound(name, opts);
    if (hit && hit.molecularWeight != null) {
      rows.push([`${hit.name} molecular weight (PubChem CID ${hit.cid ?? '?'})`, 'PubChem database', `${hit.molecularWeight} g/mol (${hit.formula})`]);
    }
  }
  return rows;
}
