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
          {/* PREMIUM HERO: circular focus gauge + stat cards */}
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', margin: '16px 0 16px',
            padding: 22, borderRadius: 18, background: 'linear-gradient(135deg, #fbf6f2, #fff)', border: `1px solid ${V('--border', '#eadfd8')}`, boxShadow: '0 10px 30px rgba(60,40,30,.08)' }}>
            <FocusGauge score={score} />
            <div style={{ flex: 1, minWidth: 220, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <MiniStat icon="✅" label="On task" value={data.studyCount ?? 0} accent="#2b7a3f" />
              <MiniStat icon="⚠️" label="Distractions" value={data.distractionCount ?? 0} accent="#c0522d" />
              <MiniStat icon="🤔" label="Uncertain" value={data.partialCount ?? 0} accent="#b06a2e" />
            </div>
          </div>

          {/* AI COACH BANNER — one dynamic line summarizing where you stand */}
          <CoachBanner score={score} data={data} goal={data.goal} />

          {/* PREMIUM activity feed — each with the AI's dynamic motivation, on a timeline */}
          <div style={{ fontSize: 15, fontWeight: 800, color: V('--ink', '#2b2320'), margin: '18px 0 12px' }}>AI coaching · every page you visited</div>
          <div style={{ position: 'relative', paddingLeft: 4 }}>
            {acts.map((a, k) => <ActivityCard key={a.id || a.activityId || k} a={a} last={k === acts.length - 1} />)}
          </div>
        </>
      )}
    </div>
  );
}

// AI COACH BANNER — a single dynamic line that reads the whole session.
function CoachBanner({ score, data, goal }) {
  const distract = data.distractionCount ?? 0;
  const line = score >= 75 ? `Excellent focus — ${score}/100. You're staying on ${goal || 'your goal'}. Keep the streak alive.`
    : score >= 45 ? `Mixed session (${score}/100). ${distract} distraction${distract === 1 ? '' : 's'} crept in — a couple of focused blocks will pull this up fast.`
    : `Your focus dipped to ${score}/100${distract ? ` with ${distract} distraction${distract === 1 ? '' : 's'}` : ''}. No shame — reset now: one 25-minute focused block on ${goal || 'your goal'} and you're back.`;
  const c = score >= 75 ? '#2b7a3f' : score >= 45 ? '#b06a2e' : '#c0522d';
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 18px', borderRadius: 14, background: `linear-gradient(135deg, ${c}14, #fff)`, border: `1px solid ${c}33` }}>
      <span style={{ fontSize: 22, flexShrink: 0 }}>🧑‍🏫</span>
      <div>
        <div style={{ fontSize: 11, fontWeight: 800, color: c, letterSpacing: 0.5, marginBottom: 2 }}>YOUR AI COACH</div>
        <div style={{ fontSize: 14, color: V('--ink', '#2b2320'), lineHeight: 1.55, fontWeight: 500 }}>{line}</div>
      </div>
    </div>
  );
}

// PREMIUM ACTIVITY CARD — page + type badge + the AI's dynamic motivation + confidence, on a timeline.
function ActivityCard({ a, last }) {
  const rawType = String(a.ai?.type || a.decision?.finalType || a.decision?.action || 'checked').toLowerCase();
  const kind = /non|distract/.test(rawType) ? 'distraction' : /partial|ask|uncertain/.test(rawType) ? 'uncertain' : 'study';
  const theme = kind === 'study' ? { c: '#2b7a3f', bg: 'rgba(43,122,63,.06)', b: '#bfebd5', badge: 'On task', icon: '✅' }
    : kind === 'distraction' ? { c: '#c0522d', bg: 'rgba(192,82,45,.06)', b: '#ffd4cf', badge: 'Distraction', icon: '⚠️' }
    : { c: '#b06a2e', bg: 'rgba(176,106,46,.06)', b: '#ffe1a8', badge: 'Uncertain', icon: '🤔' };
  // guarantee a motivation line for EVERY event
  const fallback = kind === 'distraction' ? "This won't move your goal forward — step back and give it 5 focused minutes. You've got this."
    : kind === 'uncertain' ? 'Quick gut-check: is this actually helping your goal, or a detour?'
    : "On track — keep this momentum going.";
  const motivation = a.ai?.motivation || a.ai?.voiceText || a.decision?.reason || a.ai?.reason || fallback;
  const conf = Math.round((a.ai?.confidence ?? 0) * 100);

  return (
    <div style={{ display: 'flex', gap: 12, position: 'relative' }}>
      {/* timeline rail */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 22, flexShrink: 0 }}>
        <span style={{ width: 14, height: 14, borderRadius: 999, background: theme.c, boxShadow: `0 0 0 4px ${theme.c}22`, marginTop: 16 }} />
        {!last && <span style={{ flex: 1, width: 2, background: '#efe6de' }} />}
      </div>
      <div style={{ display: 'flex', gap: 0, marginBottom: 14, borderRadius: 14, overflow: 'hidden', border: `1px solid ${theme.b}`, background: theme.bg, boxShadow: '0 4px 14px rgba(60,40,30,.05)', flex: 1, minWidth: 0 }}>
      <div style={{ width: 5, background: theme.c, flexShrink: 0 }} />
      <div style={{ padding: '13px 16px', flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15 }}>{theme.icon}</span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: V('--ink', '#2b2320'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}>
            {a.page?.title || a.page?.domain || a.page?.url || 'page'}
          </span>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: '#fff', background: theme.c, padding: '2px 8px', borderRadius: 999, letterSpacing: 0.3 }}>{theme.badge}</span>
          {a.page?.domain && <span style={{ fontSize: 11, color: V('--ink-muted', '#8a7d76') }}>{a.page.domain}</span>}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: V('--ink-muted', '#8a7d76') }}>{a.createdAt ? new Date(a.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
        </div>
        {motivation && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#fff', borderRadius: 10, padding: '9px 12px', border: `1px solid ${theme.b}` }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>💬</span>
            <div style={{ fontSize: 13, color: V('--ink', '#2b2320'), lineHeight: 1.5, fontStyle: 'italic' }}>&ldquo;{motivation}&rdquo;</div>
          </div>
        )}
        {conf > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 10.5, color: V('--ink-muted', '#8a7d76'), fontWeight: 600 }}>AI confidence</span>
            <div style={{ flex: 1, maxWidth: 140, height: 5, borderRadius: 999, background: '#efe6de', overflow: 'hidden' }}>
              <div style={{ width: `${conf}%`, height: '100%', background: theme.c }} />
            </div>
            <span style={{ fontSize: 10.5, color: theme.c, fontWeight: 700 }}>{conf}%</span>
          </div>
        )}
      </div>
      </div>
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

// Circular SVG focus gauge — premium, animated stroke, color by score.
function FocusGauge({ score }) {
  const r = 52, C = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  const color = pct >= 70 ? '#2b7a3f' : pct >= 40 ? '#b06a2e' : '#c0522d';
  const label = pct >= 70 ? 'Focused' : pct >= 40 ? 'Mixed' : 'Distracted';
  return (
    <div style={{ position: 'relative', width: 132, height: 132, flexShrink: 0 }}>
      <svg width="132" height="132" viewBox="0 0 132 132">
        <circle cx="66" cy="66" r={r} fill="none" stroke="#efe6de" strokeWidth="12" />
        <circle cx="66" cy="66" r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} transform="rotate(-90 66 66)"
          style={{ transition: 'stroke-dashoffset 1s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div>
          <div style={{ fontSize: 32, fontWeight: 800, color, lineHeight: 1 }}>{pct}</div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: V('--ink-muted', '#8a7d76'), letterSpacing: 0.5 }}>FOCUS · {label}</div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ icon, label, value, accent }) {
  return (
    <div style={{ borderRadius: 12, padding: '12px 10px', background: '#fff', border: `1px solid ${V('--border', '#eadfd8')}`, textAlign: 'center' }}>
      <div style={{ fontSize: 18 }}>{icon}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: accent, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: V('--ink-muted', '#8a7d76'), fontWeight: 600 }}>{label}</div>
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
