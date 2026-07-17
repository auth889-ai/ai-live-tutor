'use client';

// 📊 Progress — the app's own card language: study-photo covers, ring overlays, earned
// scene dots. Same palette/grid as CourseGrid (one visual system, no drift).
import { useEffect, useState } from 'react';

const UI = { text: '#2b211a', muted: '#8a6d3b', border: '#f5e6d9', card: '#fff', bgSoft: '#fdf1ea' };
const COVERS = ['/images/study-29.png', '/images/study-30.png', '/images/study-31.png', '/images/study-32.png', '/images/study-33.png', '/images/study-34.png', '/images/study-35.png', '/images/study-36.png', '/images/study-37.png', '/images/study-38.png'];
const coverFor = (id) => COVERS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % COVERS.length];
const ago = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

function Ring({ percent, done }) {
  const r = 24; const c = 2 * Math.PI * r;
  return (
    <svg width="62" height="62" viewBox="0 0 62 62" style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.25))' }}>
      <circle cx="31" cy="31" r={r} fill="rgba(255,255,255,0.92)" />
      <circle cx="31" cy="31" r={r} fill="none" stroke="#f2e8dc" strokeWidth="5" />
      <circle cx="31" cy="31" r={r} fill="none" stroke={done ? '#2f9e5f' : '#f47368'} strokeWidth="5" strokeLinecap="round"
        strokeDasharray={`${(percent / 100) * c} ${c}`} transform="rotate(-90 31 31)" />
      <text x="31" y="35" textAnchor="middle" fontSize="13" fontWeight="800" fill={done ? '#2f9e5f' : '#c0522d'}>{done ? '✓' : `${percent}%`}</text>
    </svg>
  );
}

export function ProgressContent() {
  const [data, setData] = useState(null);
  useEffect(() => { fetch('/api/study').then((r) => r.json()).then(setData).catch(() => setData({ progress: [] })); }, []);
  if (data === null) return <Skeleton />;
  const items = data.progress ?? [];
  const done = items.filter((p) => p.completed).length;
  return (
    <div>
      <style>{`.pcard{transition:transform .18s, box-shadow .18s} .pcard:hover{transform:translateY(-3px); box-shadow:0 10px 26px rgba(58,46,34,0.14)!important}`}</style>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <h1 style={{ fontSize: 24, color: UI.text, margin: 0, fontFamily: 'var(--font-newsreader), Georgia, serif' }}>Progress</h1>
        {data.streak ? <span style={{ fontSize: 13, fontWeight: 800, color: '#d35400' }}>🔥 {data.streak}-day streak</span> : null}
      </div>
      <p style={{ color: UI.muted, fontSize: 13.5, margin: '4px 0 18px' }}>
        {items.length ? `${items.length - done} in progress · ${done} completed — every bar is earned by finishing scenes.` : 'Every bar is earned by finishing scenes, not by opening them.'}
      </p>
      {items.length === 0 ? (
        <a href="/courses" style={{ display: 'block', border: `2px dashed ${UI.border}`, borderRadius: 18, padding: '48px 20px', textAlign: 'center', textDecoration: 'none', color: UI.muted, background: UI.bgSoft }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>📊</div>
          <div style={{ fontWeight: 700, color: UI.text }}>Open any lesson and it starts tracking here</div>
          <div style={{ fontSize: 13 }}>resume points · earned bars · streaks</div>
        </a>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 16 }}>
          {items.map((p) => (
            <a key={p._id} className="pcard" href={`/course/${p.lessonId}?t=${p.tMs}&scene=${p.sceneIndex}`}
              style={{ border: `1px solid ${UI.border}`, borderRadius: 18, overflow: 'hidden', background: UI.card, textDecoration: 'none', color: UI.text, boxShadow: '0 2px 10px rgba(58,46,34,0.06)' }}>
              <div style={{ position: 'relative', height: 108, overflow: 'hidden' }}>
                <img src={coverFor(p.lessonId)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(43,33,26,0.55))' }} />
                <div style={{ position: 'absolute', right: 10, bottom: -14 }}><Ring percent={p.percent} done={p.completed} /></div>
                <div style={{ position: 'absolute', left: 12, bottom: 8, color: '#fff', fontSize: 11.5, fontWeight: 800, textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                  {p.completed ? 'COMPLETED' : `▶ RESUME · SCENE ${p.sceneIndex + 1}`}
                </div>
              </div>
              <div style={{ padding: '16px 14px 13px' }}>
                <div style={{ fontWeight: 800, fontSize: 14.5, lineHeight: 1.3, minHeight: 38 }}>{p.lessonTitle || p.lessonId}</div>
                {p.sceneCount > 0 && p.sceneCount <= 24 ? (
                  <div style={{ display: 'flex', gap: 3, margin: '9px 0 7px' }}>
                    {Array.from({ length: p.sceneCount }, (_, i) => (
                      <span key={i} style={{ flex: 1, maxWidth: 14, height: 9, borderRadius: 3, background: i < (p.completedCount ?? 0) ? '#2f9e5f' : i === p.sceneIndex && !p.completed ? '#f47368' : '#f2e8dc' }} />
                    ))}
                  </div>
                ) : null}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: UI.muted }}>
                  <span>{p.completedCount ?? 0}/{p.sceneCount} scenes</span>
                  <span>{ago(p.updatedAt)}</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 16 }}>
      {[0, 1, 2].map((i) => <div key={i} style={{ height: 210, borderRadius: 18, background: 'linear-gradient(100deg,#fdf1ea,#fff,#fdf1ea)', border: '1px solid #f5e6d9' }} />)}
    </div>
  );
}
