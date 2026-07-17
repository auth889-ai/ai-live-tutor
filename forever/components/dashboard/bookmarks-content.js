'use client';

// 🔖 Bookmarks — elite version, each function from a verified winner design:
//   memory cards w/ the captured teaching line  (Rayan Memory: moments as memory objects)
//   search across everything                    (BrowseBack: find what you kept)
//   spaced review queue, Got it / Again         (JohnKeats calibrated memory + SM-2)
import { useEffect, useMemo, useState } from 'react';

const COVERS = ['/images/study-29.png', '/images/study-30.png', '/images/study-31.png', '/images/study-32.png', '/images/study-33.png', '/images/study-34.png', '/images/study-35.png', '/images/study-36.png', '/images/study-37.png', '/images/study-38.png'];
const hashCover = (id) => COVERS[[...String(id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % COVERS.length];
const coverMapFor = (ids) => new Map([...new Set(ids)].sort().map((id, i) => [id, COVERS[i % COVERS.length]]));

const fmtT = (t) => `${Math.floor(t / 60000)}:${String(Math.floor((t % 60000) / 1000)).padStart(2, '0')}`;
const ago = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export function BookmarksContent() {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    let dead = false;
    const load = () => fetch('/api/study').then((r) => r.json()).then((d) => { if (!dead) setData(d); }).catch(() => { if (!dead) setData({ signedIn: false, bookmarks: [] }); });
    load();
    const t = setInterval(load, 25000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { dead = true; clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, []);
  const remove = (id) => fetch(`/api/study?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    .then(() => setData((d) => ({ ...d, bookmarks: d.bookmarks.filter((x) => x._id !== id) })));
  const review = (id, grade) => fetch('/api/study', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'review', id, grade }),
  }).then((r) => r.json()).then(({ review: rv }) => {
    if (rv) setData((d) => ({ ...d, bookmarks: d.bookmarks.map((b) => (b._id === id ? { ...b, ...rv, reviewDue: rv.reviewDue } : b)) }));
  });

  const [tab, setTab] = useState('library'); // 'review' | 'library'
  const [reviewIdx, setReviewIdx] = useState(0);
  const [tag, setTag] = useState('');
  const tags = useMemo(() => {
    const t = new Set();
    for (const b of data?.bookmarks ?? []) for (const m of String(b.note ?? '').match(/#[\w-]+/g) ?? []) t.add(m);
    return [...t];
  }, [data]);
  const filtered = useMemo(() => {
    let items = data?.bookmarks ?? [];
    if (tag) items = items.filter((b) => String(b.note ?? '').includes(tag));
    if (!q.trim()) return items;
    const needle = q.toLowerCase();
    return items.filter((b) => [b.lessonTitle, b.sceneTitle, b.note, b.context].join(' ').toLowerCase().includes(needle));
  }, [data, q, tag]);

  // Readwise-style portability: your moments are YOURS — one click, clean Markdown.
  const exportMd = () => {
    const lines = ['# My bookmarks — Forever', ''];
    const byLesson = new Map();
    for (const b of data?.bookmarks ?? []) {
      if (!byLesson.has(b.lessonId)) byLesson.set(b.lessonId, { title: b.lessonTitle || b.lessonId, items: [] });
      byLesson.get(b.lessonId).items.push(b);
    }
    for (const [, g] of byLesson) {
      lines.push(`## ${g.title}`, '');
      for (const b of g.items) {
        lines.push(`- **${b.sceneTitle || 'Scene'}** · ${fmtT(b.tMs)}${b.context ? `\n  > ${b.context}` : ''}${b.note ? `\n  📝 ${b.note}` : ''}`);
      }
      lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'forever-bookmarks.md';
    a.click();
  };

  if (data === null) return <Shell><div style={{ color: '#8a6d3b' }}>Loading…</div></Shell>;
  if (data.signedIn === false) return <Shell><CTA text="Sign in and every moment you press 🔖 in a lesson lands here — with the exact teaching line, your notes, and a review schedule." /></Shell>;

  const now = Date.now();
  const due = (data.bookmarks ?? []).filter((b) => b.reviewDue && new Date(b.reviewDue).getTime() <= now);
  const groups = new Map();
  for (const b of filtered) {
    if (!groups.has(b.lessonId)) groups.set(b.lessonId, { title: b.lessonTitle || b.lessonId, items: [] });
    groups.get(b.lessonId).items.push(b);
  }
  const coverMap = coverMapFor((data.bookmarks ?? []).map((b) => b.lessonId));
  const coverFor = (id) => coverMap.get(id) ?? hashCover(id);

  return (
    <Shell count={(data.bookmarks ?? []).length} dueCount={due.length}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes, teaching lines, scenes…"
          style={{ flex: 1, border: '1px solid #efe6d3', borderRadius: 10, padding: '9px 13px', fontSize: 13.5, background: '#fffcfa' }}
        />
        <button onClick={exportMd} title="Export all as Markdown" style={{ border: '1px solid #efe6d3', borderRadius: 10, background: '#fffcfa', color: '#5a4a2a', fontSize: 12.5, fontWeight: 700, padding: '0 14px', cursor: 'pointer' }}>⬇ Export .md</button>
      </div>
      {tags.length ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {tags.map((t) => (
            <button key={t} onClick={() => setTag(tag === t ? '' : t)}
              style={{ border: `1.5px solid ${tag === t ? '#d35400' : '#efe6d3'}`, borderRadius: 999, background: tag === t ? '#fff5ec' : '#fff', color: '#8a3a12', fontSize: 12, fontWeight: 700, padding: '3px 11px', cursor: 'pointer' }}>
              {t}
            </button>
          ))}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8, margin: '0 0 16px' }}>
        <TabBtn active={tab === 'review'} onClick={() => { setTab('review'); setReviewIdx(0); }}>
          🧠 Review{due.length ? ` · ${due.length} due` : ''}
        </TabBtn>
        <TabBtn active={tab === 'library'} onClick={() => setTab('library')}>🔖 Library · {(data.bookmarks ?? []).length}</TabBtn>
      </div>

      {tab === 'review' ? (
        <div>
          <Forecast f={data.forecast ?? {}} />
          {due.length === 0 ? (
            <div style={{ border: '1.5px dashed #e8d5c8', borderRadius: 14, padding: '34px 22px', textAlign: 'center', color: '#8a6d3b' }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}>🎉</div>
              <div>Nothing due right now — reviews return on their schedule.</div>
            </div>
          ) : reviewIdx >= due.length ? (
            <div style={{ border: '1.5px solid #cfe8d6', borderRadius: 14, padding: '34px 22px', textAlign: 'center', color: '#20794a', background: '#f2faf4' }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}>✅</div>
              <div style={{ fontWeight: 800 }}>Session done — {due.length} moment{due.length === 1 ? '' : 's'} reviewed.</div>
            </div>
          ) : (
            <div style={{ maxWidth: 560, margin: '0 auto' }}>
              <div style={{ fontSize: 12, color: '#8a6d3b', textAlign: 'center', marginBottom: 8 }}>card {reviewIdx + 1} of {due.length}</div>
              <RecallCard key={due[reviewIdx]._id} b={due[reviewIdx]}
                onGood={() => { review(due[reviewIdx]._id, 'good'); setReviewIdx((i) => i + 1); }}
                onAgain={() => { review(due[reviewIdx]._id, 'again'); setReviewIdx((i) => i + 1); }} />
            </div>
          )}
        </div>
      ) : groups.size === 0 ? (
        <CTA text={q ? 'Nothing matches that search.' : 'No bookmarks yet — press 🔖 at a moment worth keeping; the teaching line is captured with it.'} />
      ) : [...groups.entries()].map(([lessonId, g]) => (
        <section key={lessonId} style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 10px' }}>
            <img src={coverFor(lessonId)} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', border: '1px solid #f5e6d9' }} />
            <div>
              <h2 style={{ fontSize: 15.5, color: '#2b211a', margin: 0, fontWeight: 800 }}>{g.title}</h2>
              <div style={{ fontSize: 11.5, color: '#b3a889' }}>{g.items.length} moment{g.items.length === 1 ? '' : 's'}</div>
            </div>
          </div>
          {g.items.map((b) => <Card key={b._id} b={b} onRemove={remove} />)}
        </section>
      ))}
    </Shell>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      border: `1.5px solid ${active ? '#d35400' : '#f5e6d9'}`, borderRadius: 999, cursor: 'pointer',
      background: active ? 'linear-gradient(180deg,#fffdf9,#fff5ec)' : '#fff', color: active ? '#8a3a12' : '#8a6d3b',
      fontWeight: 800, fontSize: 13, padding: '7px 18px', boxShadow: active ? '0 2px 8px rgba(211,84,0,0.12)' : 'none',
    }}>{children}</button>
  );
}

// Anki-style due forecast: what's coming keeps the habit honest.
function Forecast({ f }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
      {[['today', f.today ?? 0, '#c0522d'], ['tomorrow', f.tomorrow ?? 0, '#8a6d3b'], ['this week', f.week ?? 0, '#8a6d3b']].map(([label, n, color]) => (
        <div key={label} style={{ border: '1px solid #f5e6d9', borderRadius: 12, background: '#fff', padding: '8px 14px', fontSize: 12.5 }}>
          <b style={{ color, fontSize: 16 }}>{n}</b> <span style={{ color: '#8a6d3b' }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

// ACTIVE RECALL (Anki law: retrieve BEFORE re-reading): due cards hide the teaching line;
// the student recalls, presses Reveal (or Space), then grades honestly.
function RecallCard({ b, onGood, onAgain }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="bmcard recall" style={{ border: '1px solid #f5e6d9', borderRadius: 14, background: '#fff', padding: '13px 15px', marginBottom: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: '#8e44ad', marginBottom: 6 }}>RECALL — what was being taught here?</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800 }}>{b.lessonTitle}</span>
        <span style={{ color: '#8a6d3b', fontSize: 13 }}>· {b.sceneTitle} · {fmtT(b.tMs)}</span>
      </div>
      {b.note ? <div style={{ marginTop: 4, fontSize: 12.5, color: '#8a3a12', fontStyle: 'italic' }}>📝 {b.note}</div> : null}
      {revealed ? (
        <>
          {b.context ? <div style={{ marginTop: 8, fontSize: 13, color: '#5a4a2a', borderLeft: '3px solid #f0c39a', paddingLeft: 8, lineHeight: 1.45 }}>{b.context}</div> : <div style={{ marginTop: 8, fontSize: 12.5, color: '#b3a889' }}>No captured line — <a href={`/course/${b.lessonId}?scene=${encodeURIComponent(b.sceneId ?? '')}&t=${b.tMs}`} style={{ color: '#c0522d' }}>re-watch the moment</a>.</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
            <button onClick={onGood} style={{ border: 'none', borderRadius: 999, background: '#2f9e5f', color: '#fff', fontWeight: 800, fontSize: 12, padding: '6px 16px', cursor: 'pointer' }}>Got it</button>
            <button onClick={onAgain} style={{ border: '1.5px solid #e8604c', borderRadius: 999, background: '#fff', color: '#c0522d', fontWeight: 800, fontSize: 12, padding: '6px 16px', cursor: 'pointer' }}>Again · 10 min</button>
            <a href={`/course/${b.lessonId}?scene=${encodeURIComponent(b.sceneId ?? '')}&t=${b.tMs}`} style={{ fontSize: 12, color: '#8a6d3b' }}>▶ re-watch</a>
          </div>
        </>
      ) : (
        <button onClick={() => setRevealed(true)} style={{ marginTop: 10, border: '1.5px solid #f0c39a', borderRadius: 999, background: 'linear-gradient(180deg,#fffdf9,#fff5ec)', color: '#8a3a12', fontWeight: 800, fontSize: 12.5, padding: '6px 18px', cursor: 'pointer' }}>
        Reveal the teaching line
        </button>
      )}
    </div>
  );
}

function Card({ b, onRemove, onGood, onAgain, due = false }) {
  return (
    <div className="bmcard" style={{ border: '1px solid #f5e6d9', borderRadius: 14, background: '#fff', padding: '11px 15px', marginBottom: 8, boxShadow: '0 2px 8px rgba(58,46,34,0.05)' }}>
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
    <div>
      <style>{`
        .bmcard{transition:transform .15s, box-shadow .15s} .bmcard:hover{transform:translateY(-2px); box-shadow:0 8px 20px rgba(58,46,34,0.12)}
        @keyframes cardIn{from{transform:translateX(26px);opacity:0}to{transform:translateX(0);opacity:1}}
        .recall{animation:cardIn .3s ease-out}
      `}</style>
      <div style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: 24, color: '#2b211a', marginBottom: 4, fontFamily: 'var(--font-newsreader), Georgia, serif' }}>Bookmarks</h1>
      <p style={{ color: '#8a6d3b', fontSize: 13.5, marginBottom: 18 }}>
        {count > 0 ? `${count} kept moment${count === 1 ? '' : 's'}${dueCount ? ` · ${dueCount} due for review` : ''} — each card holds the exact second and the line being taught.` : 'Each card holds the exact second and the line being taught.'}
      </p>
      {children}
      </div>
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
