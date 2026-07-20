'use client';

// FOCUS DASHBOARD — the premium survey of the Study Focus extension's results. Reads the w2
// focus-server dashboard (focusScore, study/distraction counts, recent activities) through
// forever's proxy, and — this is the key part — for EVERY activity it asks forever's Qwen for a
// fresh, specific, powerful coach line (/api/focus/motivate) that names the actual page and the
// learner's goal. The extension's stored classification is often cautious/generic; this makes the
// motivation genuinely dynamic and useful for every event.

import { useEffect, useRef, useState } from 'react';

const V = (n, f) => `var(${n}, ${f})`;

// module-level cache so cards don't re-request Qwen on every re-render
const motivationCache = new Map();

function typeOf(a) {
  const raw = String(a.ai?.type || a.decision?.finalType || a.decision?.action || 'checked').toLowerCase();
  return /non|distract/.test(raw) ? 'distraction' : /partial|ask|uncertain/.test(raw) ? 'uncertain' : 'study';
}

// Ask forever's Qwen for a punchy, page-and-goal-specific motivation for this exact activity.
function useMotivation(a, goal) {
  const kind = typeOf(a);
  const title = a.page?.title || a.page?.domain || a.page?.url || '';
  const domain = a.page?.domain || '';
  const key = `${a.id || a.activityId || title}|${goal}|${kind}`;
  // Always ask forever's Qwen for a fresh, punchy, page+goal-specific line — the extension's
  // stored classification text is often flat; this guarantees every card is genuinely powerful.
  const [text, setText] = useState(() => motivationCache.get(key) || '');
  const asked = useRef(false);

  useEffect(() => {
    if (text || asked.current) return;               // already have a cached line
    asked.current = true;
    fetch('/api/focus/motivate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, domain, goal: goal || 'studying', type: kind }),
    })
      .then((r) => r.json())
      .then((j) => { if (j?.motivation) { motivationCache.set(key, j.motivation); setText(j.motivation); } })
      .catch(() => {});
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return text;
}

export function FocusDashboard() {
  const [deviceId, setDeviceId] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  const [devices, setDevices] = useState([]);

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('forever_focus_device_view') : '';
    // load the list of devices that actually have activity; auto-pick the busiest if none saved.
    fetch('/api/focus/devices')
      .then((r) => r.json())
      .then((j) => {
        const list = j?.devices || [];
        setDevices(list);
        if (saved) setDeviceId(saved);
        else if (list.length) setDeviceId(list.slice().sort((a, b) => b.events - a.events)[0].deviceId);
      })
      .catch(() => { if (saved) setDeviceId(saved); });
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
  const goal = data?.goal || data?.currentGoal || '';

  return (
    <div style={{ maxWidth: 940, margin: '0 auto' }}>
      <style>{keyframes}</style>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '0 0 4px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: V('--ink', '#2b2320'), margin: 0, letterSpacing: -0.4 }}>Focus Guard</h1>
        <span style={{ fontSize: 11, fontWeight: 800, color: '#c0522d', background: 'rgba(192,82,45,.1)', padding: '3px 9px', borderRadius: 999, letterSpacing: 0.4 }}>LIVE · QWEN</span>
      </div>
      <p style={{ fontSize: 13.5, color: V('--ink-muted', '#8a7d76'), margin: '0 0 18px', lineHeight: 1.55 }}>
        The AI watches for drift and writes you a personal nudge for every page you open. Here&apos;s where your study time actually went.
      </p>

      <DeviceInput deviceId={deviceId} onSet={setDeviceId} devices={devices} />

      {!deviceId && <InstallCard />}
      {loading && <Empty text="Loading your focus data…" />}
      {err && deviceId && <Empty text={`Could not load focus data (${err}).`} />}
      {deviceId && !loading && !err && acts.length === 0 && (
        <Empty text="No focus activity for this device yet — start a session in the extension and browse to a site." />
      )}

      {deviceId && data && acts.length > 0 && (
        <>
          <Hero score={score} data={data} goal={goal} />
          <CoachBanner score={score} data={data} goal={goal} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '22px 0 14px' }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: V('--ink', '#2b2320'), letterSpacing: -0.2 }}>Your session, page by page</div>
            <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, #eadfd8, transparent)' }} />
            <span style={{ fontSize: 11.5, color: V('--ink-muted', '#8a7d76'), fontWeight: 600 }}>{acts.length} events · AI-coached</span>
          </div>

          <div style={{ position: 'relative' }}>
            {acts.map((a, k) => <ActivityCard key={a.id || a.activityId || k} a={a} goal={goal} last={k === acts.length - 1} />)}
          </div>
        </>
      )}
    </div>
  );
}

// PREMIUM HERO — gauge + goal + stat tiles in a soft gradient glass panel.
function Hero({ score, data, goal }) {
  return (
    <div style={{
      position: 'relative', overflow: 'hidden', display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'center',
      margin: '16px 0', padding: 24, borderRadius: 22,
      background: 'linear-gradient(135deg, #fff7f2 0%, #fdfbf9 55%, #f4f9f4 100%)',
      border: '1px solid rgba(220,196,184,.6)', boxShadow: '0 18px 44px rgba(80,50,35,.10)',
    }}>
      <div style={{ position: 'absolute', top: -60, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, rgba(244,115,104,.14), transparent 70%)' }} />
      <FocusGauge score={score} />
      <div style={{ flex: 1, minWidth: 240, position: 'relative' }}>
        {goal ? (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#fff', border: '1px solid #eadfd8', borderRadius: 999, padding: '5px 12px', marginBottom: 12, boxShadow: '0 2px 8px rgba(60,40,30,.05)' }}>
            <span style={{ fontSize: 13 }}>🎯</span>
            <span style={{ fontSize: 12, color: V('--ink-muted', '#8a7d76'), fontWeight: 600 }}>Goal</span>
            <span style={{ fontSize: 12.5, color: V('--ink', '#2b2320'), fontWeight: 800 }}>{goal}</span>
          </div>
        ) : null}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <MiniStat icon="✅" label="On task" value={data.studyCount ?? 0} accent="#2b7a3f" />
          <MiniStat icon="⚠️" label="Distractions" value={data.distractionCount ?? 0} accent="#c0522d" />
          <MiniStat icon="🤔" label="Uncertain" value={data.partialCount ?? 0} accent="#b06a2e" />
        </div>
      </div>
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
    <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start', padding: '15px 18px', borderRadius: 16, background: `linear-gradient(135deg, ${c}16, #fff 65%)`, border: `1px solid ${c}30`, boxShadow: `0 8px 22px ${c}12` }}>
      <span style={{ fontSize: 26, flexShrink: 0, filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.08))' }}>🧑‍🏫</span>
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 900, color: c, letterSpacing: 0.8, marginBottom: 3 }}>YOUR AI COACH</div>
        <div style={{ fontSize: 14.5, color: V('--ink', '#2b2320'), lineHeight: 1.55, fontWeight: 600 }}>{line}</div>
      </div>
    </div>
  );
}

// PREMIUM ACTIVITY CARD — page + type badge + a LIVE Qwen motivation + confidence, on a timeline.
function ActivityCard({ a, goal, last }) {
  const kind = typeOf(a);
  const theme = kind === 'study' ? { c: '#2b7a3f', bg: 'rgba(43,122,63,.05)', b: 'rgba(43,122,63,.22)', badge: 'On task', icon: '✅' }
    : kind === 'distraction' ? { c: '#c0522d', bg: 'rgba(192,82,45,.05)', b: 'rgba(192,82,45,.22)', badge: 'Distraction', icon: '⚠️' }
    : { c: '#b06a2e', bg: 'rgba(176,106,46,.05)', b: 'rgba(176,106,46,.22)', badge: 'Uncertain', icon: '🤔' };
  const motivation = useMotivation(a, goal);
  const conf = Math.round((a.ai?.confidence ?? 0) * 100);
  const title = a.page?.title || a.page?.domain || a.page?.url || 'page';
  const domain = a.page?.domain || '';
  const avatar = (domain || title || '?').replace(/^www\./, '').charAt(0).toUpperCase();

  return (
    <div style={{ display: 'flex', gap: 14, position: 'relative' }}>
      {/* timeline rail */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 24, flexShrink: 0 }}>
        <span style={{ width: 15, height: 15, borderRadius: 999, background: theme.c, boxShadow: `0 0 0 4px ${theme.c}22, 0 2px 6px ${theme.c}44`, marginTop: 18 }} />
        {!last && <span style={{ flex: 1, width: 2, background: 'linear-gradient(#efe6de, #efe6de)', marginTop: 2 }} />}
      </div>

      <div style={{ display: 'flex', marginBottom: 14, borderRadius: 16, overflow: 'hidden', border: `1px solid ${theme.b}`, background: `linear-gradient(180deg, ${theme.bg}, #fff)`, boxShadow: '0 6px 18px rgba(60,40,30,.06)', flex: 1, minWidth: 0 }}>
        <div style={{ width: 5, background: `linear-gradient(${theme.c}, ${theme.c}aa)`, flexShrink: 0 }} />
        <div style={{ padding: '14px 16px', flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
            <span style={{ width: 30, height: 30, borderRadius: 9, background: `${theme.c}18`, color: theme.c, display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 14, flexShrink: 0 }}>{avatar}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: V('--ink', '#2b2320'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
              {domain && <div style={{ fontSize: 11, color: V('--ink-muted', '#8a7d76') }}>{domain}</div>}
            </div>
            <span style={{ fontSize: 10, fontWeight: 900, color: '#fff', background: theme.c, padding: '3px 9px', borderRadius: 999, letterSpacing: 0.4, flexShrink: 0 }}>{theme.icon} {theme.badge}</span>
            <span style={{ fontSize: 11, color: V('--ink-muted', '#8a7d76'), flexShrink: 0 }}>{a.createdAt ? new Date(a.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
          </div>

          {/* LIVE AI motivation — genuinely per-page, per-goal */}
          <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: '#fff', borderRadius: 12, padding: '11px 13px', border: `1px solid ${theme.b}`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.6)' }}>
            <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>💬</span>
            {motivation ? (
              <div style={{ fontSize: 13.5, color: V('--ink', '#2b2320'), lineHeight: 1.55, fontWeight: 500 }}>
                {motivation}
                <span style={{ fontSize: 9.5, fontWeight: 900, color: theme.c, letterSpacing: 0.5, marginLeft: 8, verticalAlign: 'middle', opacity: 0.75 }}>· AI COACH</span>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: V('--ink-muted', '#a89a92'), fontSize: 12.5 }}>
                <Shimmer /> <span>the AI is writing your nudge…</span>
              </div>
            )}
          </div>

          {conf > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9 }}>
              <span style={{ fontSize: 10, color: V('--ink-muted', '#8a7d76'), fontWeight: 700, letterSpacing: 0.3 }}>AI CONFIDENCE</span>
              <div style={{ flex: 1, maxWidth: 150, height: 6, borderRadius: 999, background: '#efe6de', overflow: 'hidden' }}>
                <div style={{ width: `${conf}%`, height: '100%', background: `linear-gradient(90deg, ${theme.c}, ${theme.c}bb)`, transition: 'width 1s ease' }} />
              </div>
              <span style={{ fontSize: 10.5, color: theme.c, fontWeight: 800 }}>{conf}%</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Shimmer() {
  return <span style={{ width: 30, height: 8, borderRadius: 999, background: 'linear-gradient(90deg,#efe6de 25%,#f8f1ec 50%,#efe6de 75%)', backgroundSize: '200% 100%', animation: 'fShimmer 1.2s linear infinite', display: 'inline-block' }} />;
}

function DeviceInput({ deviceId, onSet, devices = [] }) {
  const fmtDay = (d) => { try { return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' }); } catch { return ''; } };
  return (
    <div style={{ border: '1px solid rgba(216,196,184,.7)', borderRadius: 14, padding: 15, background: 'linear-gradient(135deg, rgba(176,106,46,.06), #fff)', marginBottom: 16 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: V('--ink', '#2b2320'), marginBottom: 6 }}>Which device&apos;s focus data?</div>

      {devices.length > 0 ? (
        <>
          <div style={{ fontSize: 11.5, color: V('--ink-muted', '#8a7d76'), marginBottom: 9, lineHeight: 1.5 }}>
            These devices have saved activity — tap one. (The extension makes a new id each fresh install, which is why a hand-typed id can read empty.)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
            {devices.map((d) => {
              const on = d.deviceId === deviceId;
              return (
                <button key={d.deviceId} onClick={() => onSet(d.deviceId)} title={d.deviceId}
                  style={{ textAlign: 'left', cursor: 'pointer', border: on ? '1.5px solid #c0522d' : '1px solid #eadfd8', background: on ? 'rgba(192,82,45,.08)' : '#fff', borderRadius: 12, padding: '8px 12px', boxShadow: on ? '0 4px 12px rgba(192,82,45,.14)' : '0 2px 6px rgba(60,40,30,.05)' }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: V('--ink', '#2b2320'), display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>📱</span><span style={{ fontFamily: 'ui-monospace, monospace' }}>…{d.deviceId.slice(-6)}</span>
                    {on && <span style={{ fontSize: 9, fontWeight: 900, color: '#c0522d' }}>● VIEWING</span>}
                  </div>
                  <div style={{ fontSize: 10.5, color: V('--ink-muted', '#8a7d76'), marginTop: 3 }}>
                    {d.events} events · {d.study}✅ {d.distractions}⚠️ · {fmtDay(d.last)}
                  </div>
                  {d.goal ? <div style={{ fontSize: 10, color: V('--ink-muted', '#a89a92'), marginTop: 2, maxWidth: 170, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>🎯 {d.goal}</div> : null}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 11.5, color: V('--ink-muted', '#8a7d76'), marginBottom: 9, lineHeight: 1.5 }}>
          Copy the <b>Device</b> id from the Forever Focus extension popup and paste it here (remembered next time).
        </div>
      )}

      <details style={{ marginTop: 8 }}>
        <summary style={{ fontSize: 11, color: V('--ink-muted', '#8a7d76'), cursor: 'pointer' }}>paste an id manually</summary>
        <input defaultValue={deviceId} placeholder="paste your device id"
          onKeyDown={(e) => e.key === 'Enter' && onSet(e.target.value.trim())}
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== deviceId && onSet(e.target.value.trim())}
          style={{ width: '100%', maxWidth: 420, marginTop: 6, padding: '8px 12px', borderRadius: 9, border: `1px solid ${V('--border', '#eadfd8')}`, fontSize: 12.5, fontFamily: 'ui-monospace, monospace' }} />
      </details>
    </div>
  );
}

// Circular SVG focus gauge — premium, animated stroke, color by score.
function FocusGauge({ score }) {
  const r = 54, C = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  const color = pct >= 70 ? '#2b7a3f' : pct >= 40 ? '#b06a2e' : '#c0522d';
  const label = pct >= 70 ? 'Focused' : pct >= 40 ? 'Mixed' : 'Distracted';
  return (
    <div style={{ position: 'relative', width: 140, height: 140, flexShrink: 0 }}>
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={r} fill="none" stroke="#efe6de" strokeWidth="13" />
        <circle cx="70" cy="70" r={r} fill="none" stroke={color} strokeWidth="13" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} transform="rotate(-90 70 70)"
          style={{ transition: 'stroke-dashoffset 1.1s cubic-bezier(.22,1,.36,1)' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div>
          <div style={{ fontSize: 36, fontWeight: 900, color, lineHeight: 1, letterSpacing: -1 }}>{pct}</div>
          <div style={{ fontSize: 10, fontWeight: 800, color: V('--ink-muted', '#8a7d76'), letterSpacing: 0.6, marginTop: 2 }}>FOCUS · {label.toUpperCase()}</div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ icon, label, value, accent }) {
  return (
    <div style={{ borderRadius: 14, padding: '14px 10px', background: '#fff', border: `1px solid ${accent}22`, textAlign: 'center', boxShadow: `0 4px 12px ${accent}0f` }}>
      <div style={{ fontSize: 18 }}>{icon}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color: accent, lineHeight: 1.1, letterSpacing: -0.5 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: V('--ink-muted', '#8a7d76'), fontWeight: 700, letterSpacing: 0.2 }}>{label}</div>
    </div>
  );
}

function InstallCard() {
  return (
    <div style={{ border: '1px solid rgba(216,196,184,.7)', borderRadius: 16, padding: 18, background: 'linear-gradient(135deg, rgba(43,122,63,.06), #fff)', marginBottom: 18 }}>
      <div style={{ fontSize: 14.5, fontWeight: 900, color: V('--ink', '#2b2320'), marginBottom: 8 }}>Turn on distraction detection</div>
      <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: V('--ink-muted', '#6f635c'), lineHeight: 1.8 }}>
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

const keyframes = `@keyframes fShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`;
