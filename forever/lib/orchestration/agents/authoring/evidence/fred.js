// FRED INTEGRATION — economics's EXTERNAL truth source (Federal Reserve Bank of St. Louis,
// 800,000+ real US economic time series). An economics lesson can cite REAL data — actual
// inflation, GDP, unemployment, prices — instead of a textbook's stylized numbers. A human
// tutor doesn't pull the live Fed series mid-lesson; the agent does.
//
// Requires a FREE key: set FRED_API_KEY in .env (get one at fred.stlouisfed.org/docs/api).
// Graceful: no key or a failed fetch returns null/[] — never fabricates a data point.

const BASE = 'https://api.stlouisfed.org/fred';

// Common series ids so the model can request by concept, not cryptic code.
export const FRED_SERIES = {
  inflation_cpi: 'CPIAUCSL',       // Consumer Price Index (all urban, all items)
  unemployment: 'UNRATE',          // civilian unemployment rate
  gdp: 'GDP',                      // gross domestic product
  real_gdp: 'GDPC1',               // real GDP
  fed_funds_rate: 'FEDFUNDS',      // federal funds effective rate
  gas_price: 'GASREGW',            // US regular gas price
  median_income: 'MEHOINUSA646N',  // real median household income
  '30yr_mortgage': 'MORTGAGE30US', // 30-year fixed mortgage rate
};

// Fetch the latest N observations of a series. Returns { series, title, units, observations:[{date,value}] } or null.
export async function fetchSeries(seriesKeyOrId, { fetchImpl = fetch, env = process.env, limit = 12, timeoutMs = 10000 } = {}) {
  const key = env.FRED_API_KEY;
  if (!key) return null; // no key -> no data, never invented
  const seriesId = FRED_SERIES[seriesKeyOrId] ?? seriesKeyOrId;
  const q = new URLSearchParams({ series_id: seriesId, api_key: key, file_type: 'json', sort_order: 'desc', limit: String(limit) });
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const [obsRes, metaRes] = await Promise.all([
      fetchImpl(`${BASE}/series/observations?${q}`, { signal: ctrl.signal }),
      fetchImpl(`${BASE}/series?${new URLSearchParams({ series_id: seriesId, api_key: key, file_type: 'json' })}`, { signal: ctrl.signal }),
    ]);
    clearTimeout(timer);
    if (!obsRes.ok) return null;
    const obs = await obsRes.json();
    const meta = metaRes.ok ? await metaRes.json() : null;
    const observations = (obs?.observations ?? [])
      .filter((o) => o.value !== '.')
      .map((o) => ({ date: o.date, value: Number(o.value) }))
      .reverse(); // chronological
    if (!observations.length) return null;
    const s = meta?.seriess?.[0];
    return { series: seriesId, title: s?.title ?? seriesId, units: s?.units_short ?? '', observations };
  } catch {
    return null;
  }
}

// Build citable, real-data evidence rows for an economics lesson (latest + change).
export async function fredEvidence(seriesKeys, opts = {}) {
  const rows = [];
  for (const k of seriesKeys ?? []) {
    const s = await fetchSeries(k, opts);
    if (!s) continue;
    const latest = s.observations.at(-1);
    const first = s.observations[0];
    const pct = first.value ? Math.round(((latest.value - first.value) / Math.abs(first.value)) * 1000) / 10 : null;
    rows.push([
      `${s.title} (FRED ${s.series})`,
      `latest ${latest.date}`,
      `${latest.value} ${s.units}${pct != null ? ` (${pct >= 0 ? '+' : ''}${pct}% since ${first.date})` : ''}`,
    ]);
  }
  return rows;
}
