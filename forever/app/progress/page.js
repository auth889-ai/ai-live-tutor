'use client';

// 📊 Progress — earned bars (scenes finished, not opened), resume where you left off.
import { useEffect, useState } from 'react';

const ago = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export default function ProgressPage() {
  const [data, setData] = useState(null);
  useEffect(() => { fetch('/api/study').then((r) => r.json()).then(setData).catch(() => setData({ signedIn: false, progress: [] })); }, []);
  if (data === null) return <Shell><div style={{ color: '#8a6d3b' }}>Loading…</div></Shell>;
  const streak = data.streak ?? 0;
  if (data.signedIn === false) {
    return <Shell done={0} active={0}><CTA text="Sign in and every lesson you watch tracks itself here — reopen any of them exactly where you left off." /></Shell>;
  }
  const items = data.progress ?? [];
  const done = items.filter((p) => p.completed).length;
  return (
    <Shell done={done} active={items.length - done} streak={streak}>
      {items.length === 0 ? (
        <CTA text="Nothing here yet — open any lesson and your progress starts tracking automatically." />
      ) : items.map((p) => (
        <a key={p._id} href={`/course/${p.lessonId}?t=${p.tMs}&scene=${p.sceneIndex}`} style={{ display: 'block', textDecoration: 'none', border: '1px solid #f0dcd5', borderRadius: 12, background: '#fffcfa', padding: '12px 14px', marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, color: '#2b211a', fontWeight: 700 }}>
            <span>{p.lessonTitle || p.lessonId}</span>
            <span style={{ color: p.completed ? '#20794a' : '#8a6d3b', whiteSpace: 'nowrap' }}>{p.completed ? '✓ complete' : `${p.percent}%`}</span>
          </div>
          <div style={{ marginTop: 8, height: 7, borderRadius: 4, background: '#f2e8dc', overflow: 'hidden' }}>
            <div style={{ width: `${Math.max(2, p.percent)}%`, height: '100%', background: p.completed ? '#2f9e5f' : 'linear-gradient(90deg,#e8604c,#d35400)' }} />
          </div>
          {p.sceneCount > 0 && p.sceneCount <= 24 ? (
            <div style={{ display: 'flex', gap: 3, marginTop: 6 }}>
              {Array.from({ length: p.sceneCount }, (_, i) => (
                <span key={i} style={{ width: 10, height: 10, borderRadius: 3, background: i < (p.completedCount ?? 0) ? '#2f9e5f' : i === p.sceneIndex && !p.completed ? '#e8604c' : '#f2e8dc' }} title={`Scene ${i + 1}`} />
              ))}
            </div>
          ) : null}
          <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#8a6d3b' }}>
            <span>{p.completed ? `${p.sceneCount} scenes finished` : `${p.completedCount ?? 0} of ${p.sceneCount} scenes finished · resume at scene ${p.sceneIndex + 1}`}</span>
            <span>{ago(p.updatedAt)}</span>
          </div>
        </a>
      ))}
    </Shell>
  );
}

function Shell({ children, done = 0, active = 0, streak = 0 }) {
  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '32px 16px' }}>
      <h1 style={{ fontSize: 22, color: '#3a3327', marginBottom: 4 }}>📊 Progress</h1>
      <p style={{ color: '#8a6d3b', fontSize: 13.5, marginBottom: 18 }}>
        {done + active > 0 ? `${active} in progress · ${done} completed${streak ? ` · 🔥 ${streak}-day streak` : ''} — bars are earned by finishing scenes, not by opening them.` : 'Bars are earned by finishing scenes, not by opening them.'}
      </p>
      {children}
    </div>
  );
}

function CTA({ text }) {
  return (
    <div style={{ border: '1.5px dashed #e8d5c8', borderRadius: 14, padding: '26px 22px', textAlign: 'center', color: '#8a6d3b' }}>
      <div style={{ fontSize: 30, marginBottom: 8 }}>📊</div>
      <div style={{ maxWidth: 420, margin: '0 auto 14px' }}>{text}</div>
      <a href="/courses" style={{ display: 'inline-block', background: '#e8604c', color: '#fff', borderRadius: 999, padding: '8px 18px', fontWeight: 800, fontSize: 13.5, textDecoration: 'none' }}>Open a course</a>
    </div>
  );
}
