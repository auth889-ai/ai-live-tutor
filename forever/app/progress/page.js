'use client';

// 📊 Progress — every lesson with a resume point; one click lands where you left off.
import { useEffect, useState } from 'react';

export default function ProgressPage() {
  const [items, setItems] = useState(null);
  useEffect(() => { fetch('/api/study').then((r) => r.json()).then((d) => setItems(d.progress ?? [])).catch(() => setItems([])); }, []);
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 16px' }}>
      <h1 style={{ fontSize: 22, color: '#3a3327', marginBottom: 14 }}>📊 Progress</h1>
      {items === null ? <div style={{ color: '#8a6d3b' }}>Loading…</div> : items.length === 0 ? (
        <div style={{ color: '#8a6d3b' }}>Nothing in progress yet — open any lesson and it will appear here.</div>
      ) : items.map((p) => (
        <a key={p._id} href={`/course/${p.lessonId}?t=${p.tMs}&scene=${p.sceneIndex}`} style={{ display: 'block', textDecoration: 'none', border: '1px solid #f0dcd5', borderRadius: 12, background: '#fffcfa', padding: '12px 14px', marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#2b211a', fontWeight: 700 }}>
            <span>{p.lessonTitle || p.lessonId}</span>
            <span style={{ color: p.completed ? '#20794a' : '#8a6d3b' }}>{p.completed ? '✓ complete' : `${p.percent}%`}</span>
          </div>
          <div style={{ marginTop: 8, height: 6, borderRadius: 4, background: '#f2e8dc', overflow: 'hidden' }}>
            <div style={{ width: `${p.percent}%`, height: '100%', background: p.completed ? '#2f9e5f' : '#e8604c' }} />
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: '#8a6d3b' }}>Scene {p.sceneIndex + 1} of {p.sceneCount} · resume where you left off</div>
        </a>
      ))}
    </div>
  );
}
