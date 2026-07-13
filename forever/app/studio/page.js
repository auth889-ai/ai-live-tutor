'use client';

// Studio — the real product entry point: bring ANY material (paste text, upload a PDF or
// image, drop a URL) and the agent society turns it into a course. Generation is a
// background JOB: POST /api/jobs enqueues, an EventSource streams real per-scene progress
// (routing -> planning -> generating -> voicing -> saving), and completion links to the
// finished course. PDFs/images go through POST /api/uploads first, then the job references
// the uploadId — the server resolves it inside the caller's own upload store.

import { useEffect, useRef, useState } from 'react';

import { DashboardSidebar } from '../../components/dashboard/sidebar.js';

const UI = {
  text: '#2b211a', muted: '#8a6d3b', border: '#f5e6d9', card: '#fff',
  accent: '#f47368', accentDark: '#e8604c', bgSoft: '#fdf6ee',
};

const TABS = [
  { key: 'text', icon: '✏️', label: 'Text', hint: 'Paste notes or an article' },
  { key: 'pdf', icon: '📄', label: 'PDF', hint: 'Figures & pages included' },
  { key: 'url', icon: '🔗', label: 'URL', hint: 'Any web article' },
  { key: 'image', icon: '🖼', label: 'Image', hint: 'Diagram or slide photo' },
];

export default function StudioPage() {
  const [tab, setTab] = useState('text');
  const [fullCourse, setFullCourse] = useState(true);
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
      const course = fullCourse && tab !== 'image';
      let input;
      if (tab === 'text') {
        input = { type: 'text', text, course };
      } else if (tab === 'url') {
        input = { type: 'url', url, course };
      } else {
        if (!file) throw new Error(`Choose a ${tab.toUpperCase()} file first`);
        setProgress({ phase: 'queued', percent: 0, message: 'Uploading your file…' });
        const form = new FormData();
        form.append('file', file);
        const up = await fetch('/api/uploads', { method: 'POST', body: form });
        const upData = await up.json();
        if (!up.ok) throw new Error(upData.error || 'Upload failed');
        // The optional notes textarea gives the vision agent context for image lessons.
        input = { type: tab, uploadId: upData.uploadId, course, ...(tab === 'image' && text.trim() ? { text } : {}) };
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
    <div style={{ display: 'flex', gap: 18, maxWidth: 1280, margin: '0 auto', padding: 16, alignItems: 'flex-start', color: UI.text }}>
      <DashboardSidebar email={user?.email} active="studio" />

      <main style={{ flex: 1, minWidth: 0, maxWidth: 860 }}>
      <header style={{ margin: '10px 0 22px' }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>Create a course ✨</h1>
        <p style={{ color: UI.muted, margin: '6px 0 0', fontSize: 15 }}>
          Bring any material — your faculty of AI teachers turns it into an interactive, narrated course.
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, margin: '0 0 14px' }}>
        {TABS.map((t) => {
          const activeTab = tab === t.key;
          return (
            <button key={t.key} onClick={() => { setTab(t.key); setFile(null); setError(null); }} disabled={busy}
              style={{
                textAlign: 'left', padding: '12px 14px', borderRadius: 14, cursor: 'pointer',
                border: `2px solid ${activeTab ? UI.accent : UI.border}`,
                background: activeTab ? '#fdece8' : '#fff',
                boxShadow: activeTab ? '0 4px 14px rgba(244,115,104,0.18)' : '0 1px 2px rgba(58,46,34,0.05)',
                transition: 'all 0.15s',
              }}>
              <span style={{ fontSize: 20 }}>{t.icon}</span>
              <span style={{ display: 'block', fontWeight: 800, fontSize: 14.5, marginTop: 4, color: activeTab ? UI.accentDark : UI.text }}>{t.label}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: UI.muted, marginTop: 2 }}>{t.hint}</span>
            </button>
          );
        })}
      </div>

      <div style={{ background: UI.card, border: `1px solid ${UI.border}`, borderRadius: 18, padding: 22, boxShadow: '0 1px 2px rgba(58,46,34,0.05)' }}>
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

        {tab !== 'image' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, cursor: 'pointer', fontSize: 13.5, fontWeight: 700 }}>
            <input type="checkbox" checked={fullCourse} onChange={(e) => setFullCourse(e.target.checked)} disabled={busy} style={{ accentColor: UI.accent, width: 16, height: 16 }} />
            📚 Build a full course (the Dean plans episodes & lessons; the first lesson generates now, the rest on demand)
          </label>
        )}

        <button onClick={startJob} disabled={!canStart} className={canStart ? 'forever-glow' : undefined}
          style={{
            marginTop: 16, padding: '13px 30px', borderRadius: 12, border: 'none', fontSize: 15.5, fontWeight: 800,
            background: canStart ? UI.accent : '#f0e2d0', color: canStart ? '#fff' : UI.muted, cursor: canStart ? 'pointer' : 'default',
            boxShadow: canStart ? '0 6px 18px rgba(244,115,104,0.35)' : 'none', transition: 'all 0.15s',
          }}>
          {busy ? 'Generating…' : '✨ Generate course'}
        </button>
        <span style={{ marginLeft: 12, fontSize: 12.5, color: UI.muted }}>
          ~5–10 minutes · live progress below · lands in My Courses
        </span>
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
          {/* PROGRESSIVE PLAYBACK: first scene saved -> start learning while the rest builds. */}
          {(progress.scenesReady ?? 0) > 0 && progress.lessonId && (
            <a href={`/course/${progress.lessonId}`} className="forever-glow"
              style={{ display: 'inline-block', marginTop: 12, background: UI.accent, color: '#fff', padding: '9px 20px', borderRadius: 10, textDecoration: 'none', fontWeight: 800, fontSize: 13.5 }}>
              ▶ Watch now — {progress.scenesReady} scene{progress.scenesReady === 1 ? '' : 's'} ready, the rest keep building
            </a>
          )}
        </div>
      )}
      {error && (
        <div style={{ marginTop: 16, border: '1px solid #e5b8b0', background: '#fdf0ee', color: '#a33d2e', borderRadius: 12, padding: 14, fontSize: 14 }}>
          {error}
        </div>
      )}
      {done && (
        <div style={{ marginTop: 16, border: `1px solid ${UI.border}`, background: UI.card, borderRadius: 14, padding: 16 }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>🎉 {done.courseTitle ?? done.lessonTitle}</div>
          <div style={{ fontSize: 13, color: UI.muted, marginBottom: 12 }}>
            {done.courseId
              ? `${done.episodes} episode${done.episodes === 1 ? '' : 's'} · ${done.lessonsPlanned} lessons planned · first lesson ready`
              : `${done.scenes} scenes generated${done.voiced ? ' · voiced' : ''}`}
          </div>
          <a href={done.courseId ? `/courses/${done.courseId}` : `/course/${done.lessonId}`} style={{ background: UI.accent, color: '#fff', padding: '10px 20px', borderRadius: 10, textDecoration: 'none', fontWeight: 700 }}>
            {done.courseId ? '📚 Open the course' : '▶ Start learning'}
          </a>
        </div>
      )}
      </main>
    </div>
  );
}
