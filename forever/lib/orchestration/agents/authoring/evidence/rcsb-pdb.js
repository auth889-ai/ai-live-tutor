// RCSB PDB INTEGRATION — biology's EXTERNAL structural-biology source (Protein Data Bank, the
// world's archive of 3D molecular structures, NO API KEY). A biology lesson can show a REAL
// protein — hemoglobin, insulin, a real enzyme — with its actual resolution, chains, and the
// experiment that determined it, instead of a cartoon. Pairs with the local genetics engine.
//
// Graceful: a failed fetch returns null/[] — never fabricates a structure.

const DATA = 'https://data.rcsb.org/rest/v1/core/entry';
const SEARCH = 'https://search.rcsb.org/rcsbsearch/v2/query';

// Well-known teaching structures by common name -> PDB id.
export const PDB_TEACHING = {
  hemoglobin: '1HHO',
  insulin: '4INS',
  dna: '1BNA',            // B-DNA dodecamer
  lysozyme: '6LYZ',
  myoglobin: '1MBN',
  green_fluorescent_protein: '1EMA',
  collagen: '1CAG',
};

// Fetch a structure entry by PDB id or common name. Returns { pdbId, title, method, resolution, url } or null.
export async function fetchStructure(nameOrId, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const pdbId = (PDB_TEACHING[String(nameOrId).toLowerCase()] ?? String(nameOrId)).toUpperCase();
  if (!/^[0-9A-Z]{4}$/.test(pdbId)) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetchImpl(`${DATA}/${pdbId}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const j = await res.json();
    return {
      pdbId,
      title: j?.struct?.title ?? pdbId,
      method: j?.exptl?.[0]?.method ?? j?.rcsb_entry_info?.experimental_method ?? null,
      resolution: j?.rcsb_entry_info?.resolution_combined?.[0] ?? null,
      // 3Dmol.js / Mol* can render this id directly; the viewer URL is a real, embeddable page.
      viewerUrl: `https://www.rcsb.org/3d-view/${pdbId}`,
      url: `https://www.rcsb.org/structure/${pdbId}`,
    };
  } catch {
    return null;
  }
}

// Build citable structural evidence for a biology lesson.
export async function pdbEvidence(names, opts = {}) {
  const rows = [];
  for (const n of names ?? []) {
    const s = await fetchStructure(n, opts);
    if (s) rows.push([`${s.title} (PDB ${s.pdbId})`, s.method ?? 'experimental structure', `${s.resolution ? s.resolution + ' Å, ' : ''}real 3D structure`]);
  }
  return rows;
}
