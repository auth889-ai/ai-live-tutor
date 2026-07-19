// CASE LAW FETCHER — law's EXTERNAL truth source (CourtListener / Free Law Project v4 REST
// API, millions of real US opinions, NO API KEY for search). A law lesson can cite a REAL
// case — its name, court, date, and citation — for the IRAC rule and corroboration, instead
// of a hypothetical the tutor invented. A tool no human tutor invokes live; the agent pulls
// the actual precedent.
//
// Graceful + honest: a failed fetch returns [] (never a fabricated case). Injectable fetch.

const BASE = 'https://www.courtlistener.com/api/rest/v4/search/';

// Search real opinions. Returns [{ caseName, court, date, citation, url }] — real records only.
export async function searchCases(query, { fetchImpl = fetch, rows = 3, timeoutMs = 10000 } = {}) {
  const q = String(query ?? '').trim();
  if (!q) return [];
  const params = new URLSearchParams({ q, type: 'o', order_by: 'score desc' });
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetchImpl(`${BASE}?${params.toString()}`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timer);
    if (!res.ok) return [];
    const json = await res.json();
    const items = json?.results ?? [];
    return items.slice(0, rows).map((it) => ({
      caseName: it.caseName ?? it.caseNameFull ?? 'Unknown case',
      court: it.court ?? it.court_citation_string ?? null,
      date: it.dateFiled ?? it.dateArgued ?? null,
      citation: Array.isArray(it.citation) ? it.citation[0] : (it.citation ?? null),
      url: it.absolute_url ? `https://www.courtlistener.com${it.absolute_url}` : null,
    })).filter((c) => c.caseName && c.url);
  } catch {
    return []; // network/timeout/parse error — never invent a case
  }
}

// Build citable, real-precedent evidence for a law lesson.
export async function caseLawEvidence(query, opts = {}) {
  const cases = await searchCases(query, opts);
  return cases.map((c, i) => ({
    id: `case_${i + 1}`,
    kind: 'case-law',
    provenance: 'courtlistener',
    caseName: c.caseName,
    court: c.court,
    date: c.date ?? 'unknown',
    citation: c.citation,
    url: c.url,
  }));
}
