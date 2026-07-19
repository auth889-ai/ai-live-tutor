// RIPESTAT INTEGRATION — networking's EXTERNAL real-internet source (RIPE NCC, the European
// internet registry's public data API, NO API KEY). A networking lesson can show the REAL
// internet: who owns an AS number, the actual BGP prefixes announced, real routing — beside
// the local timing simulation. A human tutor doesn't query live BGP mid-lesson; the agent does.
//
// Graceful: a failed fetch returns null/[] — never fabricates a route.

const BASE = 'https://stat.ripe.net/data';

// Real ownership + routing for an Autonomous System (e.g. AS15169 = Google).
export async function asOverview(asn, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const resource = String(asn).toUpperCase().startsWith('AS') ? String(asn).toUpperCase() : `AS${asn}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetchImpl(`${BASE}/as-overview/data.json?resource=${resource}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const j = await res.json();
    const d = j?.data;
    if (!d) return null;
    return { asn: resource, holder: d.holder ?? null, announced: d.announced ?? null, type: d.type ?? null };
  } catch { return null; }
}

// The real BGP prefixes an AS announces (the actual chunks of the internet it routes).
export async function announcedPrefixes(asn, { fetchImpl = fetch, timeoutMs = 10000, limit = 5 } = {}) {
  const resource = String(asn).toUpperCase().startsWith('AS') ? String(asn).toUpperCase() : `AS${asn}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetchImpl(`${BASE}/announced-prefixes/data.json?resource=${resource}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const j = await res.json();
    return (j?.data?.prefixes ?? []).slice(0, limit).map((p) => p.prefix).filter(Boolean);
  } catch { return []; }
}

// Build citable, real-routing evidence for a networking lesson.
export async function ripeEvidence(asns, opts = {}) {
  const rows = [];
  for (const a of asns ?? []) {
    const ov = await asOverview(a, opts);
    if (!ov) continue;
    const prefixes = await announcedPrefixes(a, opts);
    rows.push([`${ov.asn} — real owner (RIPE)`, ov.holder ?? '', prefixes.length ? `announces ${prefixes.length}+ prefixes, e.g. ${prefixes.slice(0, 2).join(', ')}` : (ov.announced ? 'announced in BGP' : 'not announced')]);
  }
  return rows;
}
