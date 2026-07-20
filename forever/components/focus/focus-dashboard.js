'use client';

// FOCUS DASHBOARD — the structured survey of the Study Focus extension's results, reading the
// w2 focus-server dashboard (focusScore, study/distraction counts, recent activities, insights)
// through forever's proxy. The extension logs under its own device id, so the user pastes that
// id (shown in the extension popup) once; it's remembered.

import { useEffect, useState } from 'react';

const V = (n, f) => `var(${n}, ${f})`;

export function FocusDashboard() {
  const [deviceId, setDeviceId] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('forever_focus_device_view');
      if (saved) setDeviceId(saved);
    }
  }, []);

  useEffect(() => {
    if (!deviceId) return;
    if (typeof window !== 'undefined') localStorage.setItem('forever_focus_device_view', deviceId);
    setLoading(true); setErr(null);
    fetch(`/api/study/dashboard/${encodeURIComponent(deviceId)}`)
      .then((r) => r.json())
      .then((j) => { setLoading(false); j.ok ? setData(j.data) : setErr(j.message || j.error || 'no data'); })
      .catch(() => { setLoading(false); setErr('offline — is the focus-server running? (npm run focus-server)'); });
  }, [deviceId]);

  const acts = data?.recentActivities ?? data?.activities ?? [];
  const score = data?.focusScore ?? 0;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: V('--ink', '#2b2320'), margin: '0 0 4px' }}>🎯 Focus Guard</h1>
      <p style={{ fontSize: 13, color: V('--ink-muted', '#8a7d76'), margin: '0 0 16px' }}>
        Where your study time actually went — the AI watches for drift and nudges you back. Your survey lives here.
      </p>

      <DeviceInput deviceId={deviceId} onSet={setDeviceId} />

      {!deviceId && <InstallCard />}
      {loading && <Empty text="Loading your focus data…" />}
      {err && deviceId && <Empty text={`Could not load focus data (${err}).`} />}
      {deviceId && !loading && !err && acts.length === 0 && (
        <Empty text="No focus activity for this device yet — start a session in the extension and browse to a site." />
      )}

      {deviceId && data && acts.length > 0 && (
        <>
          {/* hero */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, margin: '16px 0 20px' }}>
            <Stat label="Focus score" value={`${score}`} accent={score >= 70 ? '#2b7a3f' : score >= 40 ? '#b06a2e' : '#c0522d'} big sub="/ 100" />
            <Stat label="On task" value={`${data.studyCount ?? 0}`} sub="pages" accent="#2b7a3f" />
            <Stat label="Distractions" value={`${data.distractionCount ?? 0}`} sub="pages" accent="#c0522d" />
            <Stat label="Uncertain" value={`${data.partialCount ?? 0}`} sub="checked in" accent="#b06a2e" />
          </div>

          {/* focus bar */}
          <div style={{ height: 14, borderRadius: 999, overflow: 'hidden', border: `1px solid ${V('--border', '#eadfd8')}`, marginBottom: 20, display: 'flex' }}>
            <div style={{ width: `${score}%`, background: '#2b7a3f' }} />
            <div style={{ width: `${100 - score}%`, background: '#e8c9c0' }} />
          </div>

          {/* insights */}
          {(data.insights ?? []).length > 0 && (
            <Section title="Insights">
              {(data.insights ?? []).map((ins, k) => (
                <div key={k} style={{ padding: '8px 0', borderBottom: `1px solid ${V('--border', '#f0e8e2')}` }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: ins.type === 'positive' ? '#2b7a3f' : ins.type === 'warning' ? '#c0522d' : V('--ink', '#2b2320') }}>{ins.title}</div>
                  <div style={{ fontSize: 12.5, color: V('--ink-muted', '#8a7d76') }}>{ins.message}</div>
                </div>
              ))}
            </Section>
          )}

          {/* activity timeline (the survey) */}
          <Section title="Activity timeline">
            {acts.map((a) => {
              const type = a.decision?.finalType || a.decision?.action || a.ai?.type || 'checked';
              const isStudy = /study/.test(String(type)) && !/non/.test(String(type));
              return (
                <div key={a.id || a.activityId} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: `1px solid ${V('--border', '#f0e8e2')}`, fontSize: 12.5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, marginTop: 5, flexShrink: 0, background: isStudy ? '#2b7a3f' : '#c0522d' }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ color: V('--ink', '#2b2320'), fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {a.page?.title || a.page?.domain || a.page?.url || 'page'}
                    </div>
                    <div style={{ color: V('--ink-muted', '#8a7d76'), fontSize: 11.5 }}>
                      <b style={{ color: isStudy ? '#2b7a3f' : '#c0522d' }}>{String(type)}</b>
                      {a.decision?.reason ? ` — ${a.decision.reason}` : ''}
                      {a.createdAt ? ` · ${new Date(a.createdAt).toLocaleTimeString()}` : ''}
                    </div>
                  </div>
                </div>
              );
            })}
          </Section>
        </>
      )}
    </div>
  );
}

function DeviceInput({ deviceId, onSet }) {
  return (
    <div style={{ border: '1px solid #d8c4b8', borderRadius: 12, padding: 14, background: 'rgba(176,106,46,.06)', marginBottom: 16 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: V('--ink', '#2b2320'), marginBottom: 6 }}>Show my extension&apos;s focus data</div>
      <div style={{ fontSize: 11.5, color: V('--ink-muted', '#8a7d76'), marginBottom: 8 }}>
        Copy the <b>Device</b> id from the Forever Focus extension popup and paste it here (remembered next time).
      </div>
      <input defaultValue={deviceId} placeholder="paste your device id"
        onKeyDown={(e) => e.key === 'Enter' && onSet(e.target.value.trim())}
        onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== deviceId && onSet(e.target.value.trim())}
        style={{ width: '100%', maxWidth: 400, padding: '7px 11px', borderRadius: 8, border: `1px solid ${V('--border', '#eadfd8')}`, fontSize: 12.5, fontFamily: 'ui-monospace, monospace' }} />
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

function InstallCard() {
  return (
    <div style={{ border: '1px solid #d8c4b8', borderRadius: 14, padding: 16, background: 'rgba(43,122,63,.06)', marginBottom: 18 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: V('--ink', '#2b2320'), marginBottom: 6 }}>Turn on distraction detection</div>
      <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: V('--ink-muted', '#6f635c'), lineHeight: 1.7 }}>
        <li>Run both servers: <code style={{ background: '#f0e8e2', padding: '1px 5px', borderRadius: 4 }}>npm run dev:all</code></li>
        <li>Chrome → Extensions → Developer mode → Load unpacked → <code style={{ background: '#f0e8e2', padding: '1px 5px', borderRadius: 4 }}>forever/extension-focus</code></li>
        <li>Click Forever Focus → set a goal → Save Goal (auto-starts monitoring)</li>
        <li>Copy the <b>Device</b> id from the popup and paste it above to see your survey.</li>
      </ol>
    </div>
  );
}

function Empty({ text }) {
  return <div style={{ maxWidth: 620, margin: '30px auto', textAlign: 'center', color: V('--ink-muted', '#8a7d76'), fontSize: 14 }}>{text}</div>;
}
