// PRIMARY SOURCE FETCHER — history's EXTERNAL truth source (Library of Congress "Chronicling
// America" historic newspapers, NO API KEY). Wineburg's Reading Like a Historian demands REAL
// primary sources to source, contextualize, and corroborate — this fetches actual period
// newspaper articles with their date and title, so a history lesson works from a genuine
// document, not a paraphrase the tutor half-remembers. A tool no human tutor invokes live.
//
// Graceful + honest: a failed fetch returns [] (never a fabricated "source"). Injectable fetch.

const BASE = 'https://www.loc.gov/collections/chronicling-america/';

// Search real historic newspapers (current LoC JSON API). Returns real records only.
export async function searchPrimarySources(query, { fetchImpl = fetch, rows = 3, timeoutMs = 10000, dateFrom = null, dateTo = null } = {}) {
  const q = String(query ?? '').trim();
  if (!q) return [];
  const params = new URLSearchParams({ q, fo: 'json', c: String(rows), at: 'results' });
  if (dateFrom && dateTo) params.set('dates', `${dateFrom}/${dateTo}`);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetchImpl(`${BASE}?${params.toString()}`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timer);
    if (!res.ok) return [];
    const json = await res.json();
    const items = json?.results ?? [];
    return items.slice(0, rows).map((it) => ({
      title: it.title ?? 'Untitled',
      date: it.date ?? null,               // YYYY-MM-DD from LoC
      place: it.location_city?.[0] ?? it.location?.[0] ?? null,
      snippet: String(Array.isArray(it.description) ? it.description.join(' ') : (it.description ?? '')).replace(/\s+/g, ' ').trim().slice(0, 500),
      url: it.id ?? it.url ?? null,
    })).filter((s) => s.title && s.url);
  } catch {
    return []; // network/timeout/parse error — never invent a source
  }
}

// Build citable, SOURCED evidence for a history lesson (each carries its real provenance).
export async function primarySourceEvidence(query, opts = {}) {
  const sources = await searchPrimarySources(query, opts);
  return sources.map((s, i) => ({
    id: `primary_source_${i + 1}`,
    kind: 'primary-source',
    provenance: 'chronicling-america',
    title: s.title,
    date: s.date ?? 'unknown',
    place: s.place,
    quote: s.snippet,
    url: s.url,
  }));
}
