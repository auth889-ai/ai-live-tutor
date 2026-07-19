'use client';

// FOCUS DASHBOARD — the structured UI for the Study Focus extension's results (the "survey"):
// a focus-rate hero, a study-vs-distraction breakdown, the top sites, and a timeline of every
// classified page with the AI's reason and any nudge. Reads /api/study/dashboard.

import { useEffect, useState } from 'react';

const V = (n, f) => `var(${n}, ${f})`;
const fmtMin = (ms) => `${Math.round((ms ?? 0) / 60000)} min`;

export function FocusDashboard({ deviceId = 'device' }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    fetch(`/api/study/dashboard?deviceId=${encodeURIComponent(deviceId)}`)
      .then((r) => r.json())
      .then((j) => (j.ok ? setData(j.data) : setErr(j.error || 'no data')))
      .catch(() => setErr('offline'));
  }, [deviceId]);

  if (err) return <Empty text={`Could not load focus data (${err}). Start a session in the extension.`} />;
  if (!data) return <Empty text="Loading your focus data…" />;
  const t = data.totals;
  if (!t || t.total === 0) return <Empty text="No focus activity yet. Install the extension, set a goal, and start studying — your survey appears here." />;

  const topDomains = Object.entries(t.byDomain ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 6);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: V('--ink', '#2b2320'), margin: '0 0 4px' }}>Focus Report</h1>
      <p style={{ fontSize: 13, color: V('--ink-muted', '#8a7d76'), margin: '0 0 18px' }}>
        Where your study time actually went — classified by the AI against your goal, saved automatically by the Study Focus extension.
      </p>

      {/* hero cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        <Stat label="Focus rate" value={`${t.focusRate}%`} accent={t.focusRate >= 70 ? '#2b7a3f' : t.focusRate >= 40 ? '#b06a2e' : '#c0522d'} big />
        <Stat label="On task" value={`${t.study}`} sub="pages" accent="#2b7a3f" />
        <Stat label="Distractions" value={`${t.distract}`} sub="pages" accent="#c0522d" />
        <Stat label="Nudges sent" value={`${t.nudges}`} sub="refocus popups" accent="#b06a2e" />
      </div>

      {/* study vs distraction bar */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', height: 14, borderRadius: 999, overflow: 'hidden', border: `1px solid ${V('--border', '#eadfd8')}` }}>
          <div style={{ width: `${t.focusRate}%`, background: '#2b7a3f' }} />
          <div style={{ width: `${100 - t.focusRate}%`, background: '#e8c9c0' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: V('--ink-muted', '#8a7d76'), marginTop: 4 }}>
          <span>Studying {fmtMin(t.studyMs)}</span><span>Distracted {fmtMin(t.distractMs)}</span>
        </div>
      </div>

      {/* top sites */}
      <Section title="Where your time went">
        {topDomains.map(([dom, n]) => (
          <div key={dom} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, borderBottom: `1px solid ${V('--border', '#f0e8e2')}` }}>
            <span style={{ color: V('--ink', '#2b2320') }}>{dom || 'unknown'}</span>
            <span style={{ color: V('--ink-muted', '#8a7d76') }}>{n} visit{n === 1 ? '' : 's'}</span>
          </div>
        ))}
      </Section>

      {/* activity timeline (the survey) */}
      <Section title="Activity timeline">
        {(data.activities ?? []).map((a) => (
          <div key={a._id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: `1px solid ${V('--border', '#f0e8e2')}`, fontSize: 12.5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, marginTop: 5, flexShrink: 0, background: a.type === 'study' ? '#2b7a3f' : '#c0522d' }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ color: V('--ink', '#2b2320'), fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {a.title || a.domain || a.url}
              </div>
              <div style={{ color: V('--ink-muted', '#8a7d76'), fontSize: 11.5 }}>
                <b style={{ color: a.type === 'study' ? '#2b7a3f' : '#c0522d' }}>{a.type}</b>
                {a.reason ? ` — ${a.reason}` : ''}{a.nudged ? ' · nudged back' : ''} · {new Date(a.at).toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}
      </Section>
    </div>
  );
}

function Stat({ label, value, sub, accent, big }) {
  return (
    <div style={{ border: `1px solid ${V('--border', '#eadfd8')}`, borderRadius: 14, padding: 16, background: V('--card', '#fffdfb') }}>
      <div style={{ fontSize: 11.5, color: V('--ink-muted', '#8a7d76'), fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: big ? 34 : 26, fontWeight: 800, color: accent, lineHeight: 1.1, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: V('--ink-muted', '#8a7d76') }}>{sub}</div>}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ border: `1px solid ${V('--border', '#eadfd8')}`, borderRadius: 14, padding: 16, background: V('--surface', '#fbf6f2'), marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: V('--ink', '#2b2320'), marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function Empty({ text }) {
  return <div style={{ maxWidth: 620, margin: '40px auto', textAlign: 'center', color: V('--ink-muted', '#8a7d76'), fontSize: 14 }}>{text}</div>;
}
