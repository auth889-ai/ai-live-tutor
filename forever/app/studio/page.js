'use client';

// Studio — the real product entry point: bring ANY material (paste text, upload a PDF or
// image, drop a URL) and the agent society turns it into a course. Generation is a
// background JOB: POST /api/jobs enqueues, an EventSource streams real per-scene progress
// (routing -> planning -> generating -> voicing -> saving), and completion links to the
// finished course. PDFs/images go through POST /api/uploads first, then the job references
// the uploadId — the server resolves it inside the caller's own upload store.

import { useEffect, useRef, useState } from 'react';

const UI = {
  text: '#3a2e22', muted: '#8a6d3b', border: '#f0e2d0', card: '#fff',
  accent: '#f47368', bgSoft: '#fdf6ee',
};

const TABS = [
  { key: 'text', label: '✏️ Text' },
  { key: 'pdf', label: '📄 PDF' },
  { key: 'url', label: '🔗 URL' },
  { key: 'image', label: '🖼 Image' },
];

export default function StudioPage() {
  const [tab, setTab] = useState('text');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(null); // { phase, percent, message } | null
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null); // { lessonId, lessonTitle, scenes, voiced }
  const [user, setUser] = useState(undefined); // undefined = checking, null = signed out
  const sourceRef = useRef(null);

  // Private studio: your generated courses belong to your account.
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then(setUser)
      .catch(() => setUser(null));
    return () => sourceRef.current?.close();
  }, []);

  async function startJob() {
    setError(null);
    setDone(null);
    setProgress({ phase: 'queued', percent: 0, message: 'Preparing…' });
    try {
      let input;
      if (tab === 'text') {
        input = { type: 'text', text };
      } else if (tab === 'url') {
        input = { type: 'url', url };
      } else {
        if (!file) throw new Error(`Choose a ${tab.toUpperCase()} file first`);
        setProgress({ phase: 'queued', percent: 0, message: 'Uploading your file…' });
        const form = new FormData();
        form.append('file', file);
        const up = await fetch('/api/uploads', { method: 'POST', body: form });
        const upData = await up.json();
        if (!up.ok) throw new Error(upData.error || 'Upload failed');
        // The optional notes textarea gives the vision agent context for image lessons.
        input = { type: tab, uploadId: upData.uploadId, ...(tab === 'image' && text.trim() ? { text } : {}) };
      }

      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not start the job');

      const es = new EventSource(`/api/jobs/${data.jobId}/events`);
      sourceRef.current = es;
      es.addEventListener('progress', (e) => setProgress(JSON.parse(e.data)));
      es.addEventListener('done', (e) => {
        setDone(JSON.parse(e.data));
        setProgress(null);
        es.close();
      });
      es.addEventListener('error', (e) => {
        let message = 'The job failed';
        try { message = JSON.parse(e.data).error || message; } catch { /* connection-level */ }
        setError(message);
        setProgress(null);
        es.close();
      });
    } catch (err) {
      setError(err.message);
      setProgress(null);
    }
  }

  if (user === undefined) {
    return <main style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', color: UI.muted }}>Checking your session…</main>;
  }
  if (user === null) {
    return (
      <main style={{ maxWidth: 760, margin: '80px auto', padding: '0 16px', textAlign: 'center', color: UI.text }}>
        <h1 style={{ fontSize: 24 }}>Forever Studio</h1>
        <p style={{ color: UI.muted }}>Sign in to generate courses — your library is private to your account.</p>
        <a href="/login" style={{ display: 'inline-block', marginTop: 12, padding: '10px 28px', borderRadius: 10, background: UI.accent, color: '#fff', textDecoration: 'none', fontWeight: 700 }}>
          Sign in / Create account
        </a>
      </main>
    );
  }

  const busy = progress !== null;
  const canStart = !busy && (
    (tab === 'text' && text.trim().length >= 60) ||
    (tab === 'url' && /^https?:\/\/./.test(url.trim())) ||
    ((tab === 'pdf' || tab === 'image') && Boolean(file))
  );

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '28px 20px', color: UI.text }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <a href="/" style={{ textDecoration: 'none', color: UI.muted, fontSize: 13 }}>← My Courses</a>
        {user?.email && (
          <span style={{ fontSize: 13, color: UI.muted }}>
            {user.email} ·{' '}
            <a href="#" onClick={async (e) => { e.preventDefault(); await fetch('/api/auth/logout', { method: 'POST' }); window.location.href = '/login'; }} style={{ color: UI.accent }}>
              sign out
            </a>
          </span>
        )}
      </div>
      <h1 style={{ fontSize: 26, margin: '10px 0 4px' }}>Create a course</h1>
      <p style={{ color: UI.muted, marginTop: 0 }}>Bring any material — a society of AI teachers turns it into an interactive course.</p>

      <div style={{ display: 'flex', gap: 8, margin: '18px 0 14px' }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => { setTab(t.key); setFile(null); setError(null); }} disabled={busy}
            style={{
              padding: '9px 16px', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${tab === t.key ? UI.accent : UI.border}`,
              background: tab === t.key ? '#fdece8' : '#fff', color: UI.text,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ background: UI.card, border: `1px solid ${UI.border}`, borderRadius: 16, padding: 18 }}>
        {tab === 'text' && (
          <textarea value={text} onChange={(e) => setText(e.target.value)} disabled={busy}
            placeholder="Paste your learning material (notes, an article, a chapter — at least 60 characters)…"
            style={{ width: '100%', minHeight: 220, border: `1px solid ${UI.border}`, borderRadius: 10, padding: 12, fontSize: 14, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
        )}
        {tab === 'url' && (
          <input value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy}
            placeholder="https://example.com/article-to-learn-from"
            style={{ width: '100%', border: `1px solid ${UI.border}`, borderRadius: 10, padding: 12, fontSize: 14, boxSizing: 'border-box' }} />
        )}
        {(tab === 'pdf' || tab === 'image') && (
          <div>
            <label style={{ display: 'block', border: `2px dashed ${UI.border}`, borderRadius: 12, padding: '34px 16px', textAlign: 'center', cursor: 'pointer', background: UI.bgSoft }}>
              <input type="file" accept={tab === 'pdf' ? 'application/pdf' : 'image/png,image/jpeg,image/webp'}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={busy} style={{ display: 'none' }} />
              <div style={{ fontSize: 26, marginBottom: 6 }}>{tab === 'pdf' ? '📄' : '🖼'}</div>
              <div style={{ fontWeight: 700 }}>{file ? file.name : `Choose a ${tab === 'pdf' ? 'PDF' : 'PNG / JPEG / WebP'} file`}</div>
              <div style={{ fontSize: 12, color: UI.muted, marginTop: 4 }}>max 30 MB{tab === 'pdf' ? ' · text, figures and page images are all used' : ''}</div>
            </label>
            {tab === 'image' && (
              <textarea value={text} onChange={(e) => setText(e.target.value)} disabled={busy}
                placeholder="Optional: add context about this image (what course it belongs to, what to focus on)…"
                style={{ width: '100%', minHeight: 70, marginTop: 10, border: `1px solid ${UI.border}`, borderRadius: 10, padding: 10, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }} />
            )}
          </div>
        )}

        <button onClick={startJob} disabled={!canStart}
          style={{
            marginTop: 14, padding: '12px 26px', borderRadius: 10, border: 'none', fontSize: 15, fontWeight: 700,
            background: canStart ? UI.accent : '#f0e2d0', color: canStart ? '#fff' : UI.muted, cursor: canStart ? 'pointer' : 'default',
          }}>
          {busy ? 'Generating…' : 'Generate course'}
        </button>
      </div>

      {progress && (
        <div style={{ marginTop: 16, background: UI.card, border: `1px solid ${UI.border}`, borderRadius: 14, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
            <span style={{ fontWeight: 700, textTransform: 'capitalize' }}>{progress.phase}</span>
            <span style={{ color: UI.muted }}>{progress.percent}%</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: '#f0e6d2' }}>
            <div style={{ width: `${progress.percent}%`, height: '100%', borderRadius: 4, background: UI.accent, transition: 'width 0.4s' }} />
          </div>
          <div style={{ fontSize: 13, color: UI.muted, marginTop: 8 }}>{progress.message}</div>
        </div>
      )}
      {error && (
        <div style={{ marginTop: 16, border: '1px solid #e5b8b0', background: '#fdf0ee', color: '#a33d2e', borderRadius: 12, padding: 14, fontSize: 14 }}>
          {error}
        </div>
      )}
      {done && (
        <div style={{ marginTop: 16, border: `1px solid ${UI.border}`, background: UI.card, borderRadius: 14, padding: 16 }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>🎉 {done.lessonTitle}</div>
          <div style={{ fontSize: 13, color: UI.muted, marginBottom: 12 }}>{done.scenes} scenes generated{done.voiced ? ' · voiced' : ''}</div>
          <a href={`/course/${done.lessonId}`} style={{ background: UI.accent, color: '#fff', padding: '10px 20px', borderRadius: 10, textDecoration: 'none', fontWeight: 700 }}>
            ▶ Start learning
          </a>
        </div>
      )}
    </main>
  );
}
