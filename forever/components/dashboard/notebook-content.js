'use client';

// 📓 Notebook — the Sankofa pattern (winner research: auto-collected notes beat blank pages):
// every lesson gets a notebook page that ARRIVES half-written — the moments the player captured
// (bookmark notes + the teaching line said at that second) — and the student writes their own
// synthesis beside it. Autosaves as they type; exports as Markdown. Zero canned text: a lesson
// only appears once the learner has touched it.

import { useEffect, useMemo, useRef, useState } from 'react';

const T = {
  card: { border: '1px solid #f2e3d5', borderRadius: 16, background: '#fff', boxShadow: '0 1px 4px rgba(58,46,34,0.05)' },
  cap: { fontSize: 11.5, color: '#9b8465' },
  accent: '#e8604c',
};
const COVERS = ['/images/study-29.png', '/images/study-30.png', '/images/study-31.png', '/images/study-32.png', '/images/study-33.png', '/images/study-34.png', '/images/study-35.png', '/images/study-36.png', '/images/study-37.png', '/images/study-38.png'];
const coverMapFor = (ids) => new Map([...new Set(ids)].sort().map((id, i) => [id, COVERS[i % COVERS.length]]));

export function NotebookContent() {
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(null);
  useEffect(() => {
    fetch('/api/study').then((r) => r.json()).then(setData).catch(() => {});
  }, []);
  const lessons = useMemo(() => {
    if (!data) return [];
    const byId = new Map();
    for (const p of data.progress ?? []) byId.set(p.lessonId, { lessonId: p.lessonId, title: p.lessonTitle || p.lessonId, touched: p.updatedAt });
    for (const b of data.bookmarks ?? []) if (!byId.has(b.lessonId)) byId.set(b.lessonId, { lessonId: b.lessonId, title: b.lessonTitle || b.lessonId, touched: b.createdAt });
    return [...byId.values()].sort((a, b) => new Date(b.touched) - new Date(a.touched));
  }, [data]);
  const covers = useMemo(() => coverMapFor(lessons.map((l) => l.lessonId)), [lessons]);
  const active = sel ?? lessons[0]?.lessonId ?? null;
  if (data === null) return <div style={{ ...T.card, padding: 40, textAlign: 'center', color: '#9b8465' }}>Opening your notebook…</div>;

  return (
    <div style={{ maxWidth: 1080 }}>
      <h1 style={{ fontSize: 27, color: '#2b211a', fontFamily: 'var(--font-newsreader), Georgia, serif', fontWeight: 600, margin: 0 }}>Notebook</h1>
      <p style={{ ...T.cap, margin: '4px 0 18px' }}>Every lesson's page arrives half-written — the moments you saved, waiting for your own words.</p>
      {lessons.length === 0 ? (
        <div style={{ ...T.card, padding: '42px 20px', textAlign: 'center', color: '#9b8465' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📓</div>
          <div style={{ fontWeight: 700, color: '#2b211a' }}>Open any lesson and its notebook page appears here</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>bookmarked moments arrive automatically — press B while watching</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 300px) minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {lessons.map((l) => (
              <button key={l.lessonId} onClick={() => setSel(l.lessonId)}
                style={{ display: 'flex', gap: 10, alignItems: 'center', textAlign: 'left', padding: 8, cursor: 'pointer', ...T.card, borderColor: active === l.lessonId ? T.accent : '#f2e3d5', background: active === l.lessonId ? '#fdf0ee' : '#fff' }}>
                <img src={covers.get(l.lessonId)} alt="" style={{ width: 46, height: 34, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, fontWeight: 700, color: '#2b211a', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{l.title}</span>
              </button>
            ))}
          </div>
          {active ? <NotebookPage key={active} lessonId={active} lesson={lessons.find((l) => l.lessonId === active)} data={data} /> : null}
        </div>
      )}
    </div>
  );
}

function NotebookPage({ lessonId, lesson, data }) {
  const moments = (data.bookmarks ?? []).filter((b) => b.lessonId === lessonId);
  const saved = (data.notebooks ?? []).find((n) => n.lessonId === lessonId);
  const [text, setText] = useState(saved?.text ?? '');
  const [state, setState] = useState('saved'); // saved | typing | saving
  const timer = useRef(null);

  // Autosave: 900ms after the last keystroke (the Sankofa feel — never a save button).
  const onType = (v) => {
    setText(v);
    setState('typing');
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setState('saving');
      await fetch('/api/study', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'notebook', lessonId, text: v }) }).catch(() => {});
      setState('saved');
    }, 900);
  };

  const exportMd = () => {
    const md = [`# ${lesson?.title ?? lessonId}`, '', '## Captured moments', ...(moments.length ? moments.map((m) => `- **${m.note || 'moment'}** — “${m.context ?? ''}”`) : ['(none yet)']), '', '## My notes', text || '(empty)'].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = `${(lesson?.title ?? 'notebook').replace(/[^\w]+/g, '-').slice(0, 50)}.md`;
    a.click();
  };

  return (
    <div style={{ ...T.card, borderRadius: 20, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 18px', borderBottom: '1px solid #f6ebe0' }}>
        <span style={{ fontSize: 15.5, fontWeight: 800, color: '#2b211a', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lesson?.title}</span>
        <span style={{ ...T.cap, whiteSpace: 'nowrap' }}>{state === 'saved' ? '✓ saved' : state === 'saving' ? 'saving…' : 'typing…'}</span>
        <button onClick={exportMd} style={{ border: '1px solid #f2e3d5', borderRadius: 999, background: '#fff', color: '#6b563d', padding: '4px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>⬇ export .md</button>
        <a href={`/course/${lessonId}`} style={{ border: 'none', borderRadius: 999, background: T.accent, color: '#fff', padding: '5px 14px', fontSize: 12, fontWeight: 800, textDecoration: 'none' }}>▶ open lesson</a>
      </div>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid #f6ebe0', background: '#fffdf9' }}>
        <div style={{ ...T.cap, fontWeight: 800, marginBottom: 8 }}>CAPTURED MOMENTS · {moments.length}</div>
        {moments.length ? moments.map((m) => (
          <div key={m._id} style={{ padding: '7px 0', borderTop: '1px dashed #f2e8dc' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#2b211a' }}>🔖 {m.note || 'saved moment'}</div>
            {m.context ? <div style={{ fontSize: 12.5, color: '#6b563d', fontStyle: 'italic', marginTop: 2 }}>“{m.context}”</div> : null}
          </div>
        )) : <div style={{ ...T.cap }}>press <b style={{ color: '#2b211a' }}>B</b> during the lesson — the tutor's sentence at that second lands here</div>}
      </div>
      <textarea value={text} onChange={(e) => onType(e.target.value)} placeholder="Your synthesis — what clicked, what to remember, your own examples…" spellCheck={false}
        style={{ width: '100%', minHeight: 280, boxSizing: 'border-box', border: 'none', outline: 'none', resize: 'vertical', padding: '16px 18px', fontSize: 14, lineHeight: 1.65, color: '#2b211a', background: 'repeating-linear-gradient(transparent, transparent 27px, #f8efe6 28px)', fontFamily: 'var(--font-newsreader), Georgia, serif' }} />
    </div>
  );
}
