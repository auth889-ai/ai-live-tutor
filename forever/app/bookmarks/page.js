'use client';

// 🔖 Bookmarks — every moment the student marked, one click back to that exact second.
import { useEffect, useState } from 'react';

export default function BookmarksPage() {
  const [items, setItems] = useState(null);
  useEffect(() => { fetch('/api/study').then((r) => r.json()).then((d) => setItems(d.bookmarks ?? [])).catch(() => setItems([])); }, []);
  const remove = (id) => fetch(`/api/study?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).then(() => setItems((xs) => xs.filter((x) => x._id !== id)));
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 16px' }}>
      <h1 style={{ fontSize: 22, color: '#3a3327', marginBottom: 14 }}>🔖 Bookmarks</h1>
      {items === null ? <div style={{ color: '#8a6d3b' }}>Loading…</div> : items.length === 0 ? (
        <div style={{ color: '#8a6d3b' }}>No bookmarks yet — press 🔖 in the player to keep a moment.</div>
      ) : items.map((b) => (
        <div key={b._id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #f0dcd5', borderRadius: 12, background: '#fffcfa', padding: '10px 14px', marginBottom: 8 }}>
          <a href={`/course/${b.lessonId}?scene=${encodeURIComponent(b.sceneId ?? '')}&t=${b.tMs}`} style={{ flex: 1, textDecoration: 'none', color: '#2b211a' }}>
            <div style={{ fontWeight: 700 }}>{b.lessonTitle || b.lessonId}</div>
            <div style={{ fontSize: 12.5, color: '#8a6d3b' }}>{b.sceneTitle} · {Math.floor(b.tMs / 60000)}:{String(Math.floor((b.tMs % 60000) / 1000)).padStart(2, '0')}</div>
          </a>
          <button onClick={() => remove(b._id)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#c0522d' }}>✕</button>
        </div>
      ))}
    </div>
  );
}
