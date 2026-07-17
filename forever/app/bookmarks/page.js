'use client';

// 🔖 Bookmarks — elite version, each function from a verified winner design:
//   memory cards w/ the captured teaching line  (Rayan Memory: moments as memory objects)
//   search across everything                    (BrowseBack: find what you kept)
//   spaced review queue, Got it / Again         (JohnKeats calibrated memory + SM-2)
import { useEffect, useMemo, useState } from 'react';

const fmtT = (t) => `${Math.floor(t / 60000)}:${String(Math.floor((t % 60000) / 1000)).padStart(2, '0')}`;
const ago = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export default function BookmarksPage() {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => { fetch('/api/study').then((r) => r.json()).then(setData).catch(() => setData({ signedIn: false, bookmarks: [] })); }, []);
  const remove = (id) => fetch(`/api/study?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    .then(() => setData((d) => ({ ...d, bookmarks: d.bookmarks.filter((x) => x._id !== id) })));
  const review = (id, grade) => fetch('/api/study', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'review', id, grade }),
  }).then((r) => r.json()).then(({ review: rv }) => {
    if (rv) setData((d) => ({ ...d, bookmarks: d.bookmarks.map((b) => (b._id === id ? { ...b, ...rv, reviewDue: rv.reviewDue } : b)) }));
  });

  const filtered = useMemo(() => {
    const items = data?.bookmarks ?? [];
    if (!q.trim()) return items;
    const needle = q.toLowerCase();
    return items.filter((b) => [b.lessonTitle, b.sceneTitle, b.note, b.context].join(' ').toLowerCase().includes(needle));
  }, [data, q]);

  if (data === null) return <Shell><div style={{ color: '#8a6d3b' }}>Loading…</div></Shell>;
  if (data.signedIn === false) return <Shell><CTA text="Sign in and every moment you press 🔖 in a lesson lands here — with the exact teaching line, your notes, and a review schedule." /></Shell>;

  const now = Date.now();
  const due = filtered.filter((b) => b.reviewDue && new Date(b.reviewDue).getTime() <= now);
  const groups = new Map();
  for (const b of filtered) {
    if (!groups.has(b.lessonId)) groups.set(b.lessonId, { title: b.lessonTitle || b.lessonId, items: [] });
    groups.get(b.lessonId).items.push(b);
  }

  return (
    <Shell count={(data.bookmarks ?? []).length} dueCount={due.length}>
      <input
        value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes, teaching lines, scenes…"
        style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #efe6d3', borderRadius: 10, padding: '9px 13px', fontSize: 13.5, marginBottom: 16, background: '#fffcfa' }}
      />
      {due.length > 0 ? (
        <section style={{ marginBottom: 22, border: '1.5px solid #f0c39a', borderRadius: 14, background: 'linear-gradient(180deg,#fffdf9,#fff5ec)', padding: '12px 14px' }}>
          <h2 style={{ fontSize: 14.5, color: '#8a3a12', margin: '0 0 10px' }}>🧠 Due for review — re-read, then grade yourself honestly</h2>
          {due.map((b) => (
            <Card key={`due-${b._id}`} b={b} onRemove={remove} due
              onGood={() => review(b._id, 'good')} onAgain={() => review(b._id, 'again')} />
          ))}
        </section>
      ) : null}
      {groups.size === 0 ? (
        <CTA text={q ? 'Nothing matches that search.' : 'No bookmarks yet — press 🔖 at a moment worth keeping; the teaching line is captured with it.'} />
      ) : [...groups.entries()].map(([lessonId, g]) => (
        <section key={lessonId} style={{ marginBottom: 22 }}>
          <h2 style={{ fontSize: 15.5, color: '#5a4a2a', margin: '0 0 8px' }}>{g.title}</h2>
          {g.items.map((b) => <Card key={b._id} b={b} onRemove={remove} />)}
        </section>
      ))}
    </Shell>
  );
}

function Card({ b, onRemove, onGood, onAgain, due = false }) {
  return (
    <div style={{ border: '1px solid #f0dcd5', borderRadius: 12, background: '#fffcfa', padding: '10px 14px', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <a href={`/course/${b.lessonId}?scene=${encodeURIComponent(b.sceneId ?? '')}&t=${b.tMs}`} style={{ flex: 1, textDecoration: 'none', color: '#2b211a' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700 }}>{b.sceneTitle || 'Scene'}</span>
            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#d35400', fontWeight: 700 }}>▶ {fmtT(b.tMs)}</span>
            <span style={{ fontSize: 11.5, color: '#b3a889' }}>{ago(b.createdAt)}</span>
          </div>
          {b.context ? (
            <div style={{ marginTop: 5, fontSize: 13, color: '#5a4a2a', borderLeft: '3px solid #f0c39a', paddingLeft: 8, lineHeight: 1.45 }}>{b.context}</div>
          ) : null}
          {b.note ? <div style={{ marginTop: 4, fontSize: 12.5, color: '#8a3a12', fontStyle: 'italic' }}>📝 {b.note}</div> : null}
        </a>
        <button onClick={() => onRemove(b._id)} title="Remove" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#c0522d', fontSize: 14 }}>✕</button>
      </div>
      {due ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={onGood} style={{ border: 'none', borderRadius: 999, background: '#2f9e5f', color: '#fff', fontWeight: 800, fontSize: 12, padding: '5px 14px', cursor: 'pointer' }}>Got it — see it in {'>'}2 days</button>
          <button onClick={onAgain} style={{ border: '1.5px solid #e8604c', borderRadius: 999, background: '#fff', color: '#c0522d', fontWeight: 800, fontSize: 12, padding: '5px 14px', cursor: 'pointer' }}>Again — 10 minutes</button>
        </div>
      ) : null}
    </div>
  );
}

function Shell({ children, count = 0, dueCount = 0 }) {
  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '32px 16px' }}>
      <h1 style={{ fontSize: 22, color: '#3a3327', marginBottom: 4 }}>🔖 Bookmarks</h1>
      <p style={{ color: '#8a6d3b', fontSize: 13.5, marginBottom: 18 }}>
        {count > 0 ? `${count} kept moment${count === 1 ? '' : 's'}${dueCount ? ` · ${dueCount} due for review` : ''} — each card holds the exact second and the line being taught.` : 'Each card holds the exact second and the line being taught.'}
      </p>
      {children}
    </div>
  );
}

function CTA({ text }) {
  return (
    <div style={{ border: '1.5px dashed #e8d5c8', borderRadius: 14, padding: '26px 22px', textAlign: 'center', color: '#8a6d3b' }}>
      <div style={{ fontSize: 30, marginBottom: 8 }}>🔖</div>
      <div style={{ maxWidth: 440, margin: '0 auto 14px' }}>{text}</div>
      <a href="/courses" style={{ display: 'inline-block', background: '#e8604c', color: '#fff', borderRadius: 999, padding: '8px 18px', fontWeight: 800, fontSize: 13.5, textDecoration: 'none' }}>Open a course</a>
    </div>
  );
}
