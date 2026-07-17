'use client';

// 🔖 Bookmarks — grouped by lesson, notes visible, one click back to the exact second.
import { useEffect, useState } from 'react';

const fmtT = (t) => `${Math.floor(t / 60000)}:${String(Math.floor((t % 60000) / 1000)).padStart(2, '0')}`;
const ago = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export default function BookmarksPage() {
  const [data, setData] = useState(null);
  useEffect(() => { fetch('/api/study').then((r) => r.json()).then(setData).catch(() => setData({ signedIn: false, bookmarks: [] })); }, []);
  const remove = (id) => fetch(`/api/study?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    .then(() => setData((d) => ({ ...d, bookmarks: d.bookmarks.filter((x) => x._id !== id) })));

  if (data === null) return <Shell><div style={{ color: '#8a6d3b' }}>Loading…</div></Shell>;
  if (data.signedIn === false) {
    return <Shell><CTA text="Sign in and every moment you press 🔖 in a lesson lands here — with your notes, on any device." /></Shell>;
  }
  const groups = new Map();
  for (const b of data.bookmarks ?? []) {
    if (!groups.has(b.lessonId)) groups.set(b.lessonId, { title: b.lessonTitle || b.lessonId, items: [] });
    groups.get(b.lessonId).items.push(b);
  }
  return (
    <Shell>
      {groups.size === 0 ? (
        <CTA text="No bookmarks yet — open any lesson and press 🔖 at a moment worth keeping. Add a note when it saves." />
      ) : [...groups.entries()].map(([lessonId, g]) => (
        <section key={lessonId} style={{ marginBottom: 22 }}>
          <h2 style={{ fontSize: 15.5, color: '#5a4a2a', margin: '0 0 8px' }}>{g.title}</h2>
          {g.items.map((b) => (
            <div key={b._id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #f0dcd5', borderRadius: 12, background: '#fffcfa', padding: '10px 14px', marginBottom: 8 }}>
              <a href={`/course/${b.lessonId}?scene=${encodeURIComponent(b.sceneId ?? '')}&t=${b.tMs}`} style={{ flex: 1, textDecoration: 'none', color: '#2b211a' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700 }}>{b.sceneTitle || 'Scene'}</span>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#d35400', fontWeight: 700 }}>▶ {fmtT(b.tMs)}</span>
                  <span style={{ fontSize: 11.5, color: '#b3a889' }}>{ago(b.createdAt)}</span>
                </div>
                {b.note ? <div style={{ marginTop: 4, fontSize: 13, color: '#5a4a2a', fontStyle: 'italic' }}>“{b.note}”</div> : null}
              </a>
              <button onClick={() => remove(b._id)} title="Remove" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#c0522d', fontSize: 14 }}>✕</button>
            </div>
          ))}
        </section>
      ))}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '32px 16px' }}>
      <h1 style={{ fontSize: 22, color: '#3a3327', marginBottom: 4 }}>🔖 Bookmarks</h1>
      <p style={{ color: '#8a6d3b', fontSize: 13.5, marginBottom: 18 }}>Moments you kept — each link reopens the lesson at that exact second.</p>
      {children}
    </div>
  );
}

function CTA({ text }) {
  return (
    <div style={{ border: '1.5px dashed #e8d5c8', borderRadius: 14, padding: '26px 22px', textAlign: 'center', color: '#8a6d3b' }}>
      <div style={{ fontSize: 30, marginBottom: 8 }}>🔖</div>
      <div style={{ maxWidth: 420, margin: '0 auto 14px' }}>{text}</div>
      <a href="/courses" style={{ display: 'inline-block', background: '#e8604c', color: '#fff', borderRadius: 999, padding: '8px 18px', fontWeight: 800, fontSize: 13.5, textDecoration: 'none' }}>Open a course</a>
    </div>
  );
}
