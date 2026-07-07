'use client';

// Studio: paste any learning material -> the agent society generates a course lesson -> jump to
// the player. The real product entry point. Generation is a background JOB (~8 min): POST /api/jobs
// enqueues it, then an EventSource on /api/jobs/:id/events streams live progress (real per-scene
// percent, not a fake spinner), and on completion we navigate to the finished lesson.

import { useRef, useState } from 'react';

export default function StudioPage() {
  const [text, setText] = useState('');
  const [progress, setProgress] = useState(null); // { phase, percent, message } | null
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null); // { lessonId, lessonTitle, scenes }
  const sourceRef = useRef(null);

  async function startJob() {
    setError(null);
    setDone(null);
    setProgress({ phase: 'queued', percent: 0, message: 'Queued…' });
    try {
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not start the job');

      // Subscribe to live progress. The server emits progress/done/error SSE events.
      const es = new EventSource(`/api/jobs/${data.jobId}/events`);
      sourceRef.current = es;
      es.addEventListener('progress', (e) => setProgress(JSON.parse(e.data)));
      es.addEventListener('done', (e) => {
        setDone(JSON.parse(e.data));
        setProgress(null);
        es.close();
      });
      es.addEventListener('error', (e) => {
        // SSE 'error' can be our payload or a raw connection drop; handle both.
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

  const busy = progress !== null;

  return (
    <main style={{ maxWidth: 760, margin: '32px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 24 }}>Forever Studio</h1>
      <p style={{ color: '#8a6d3b' }}>Paste any learning material. The AI tutor faculty turns it into a course lesson.</p>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={10}
        placeholder="Paste notes, an article, code, or a topic explanation (60+ characters)..."
        style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid #e8ddc9', fontFamily: 'inherit', fontSize: 14 }}
      />
      <button
        onClick={startJob}
        disabled={text.trim().length < 60 || busy}
        style={{ marginTop: 12, padding: '10px 24px', fontSize: 16, borderRadius: 8, cursor: busy ? 'default' : 'pointer' }}
      >
        {busy ? 'Generating…' : 'Generate lesson'}
      </button>

      {progress && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#7a4a12', marginBottom: 6 }}>
            <span>{progress.message || progress.phase}</span>
            <span>{progress.percent}%</span>
          </div>
          <div style={{ height: 10, borderRadius: 6, background: '#f3eee2', overflow: 'hidden' }}>
            <div style={{ width: `${progress.percent}%`, height: '100%', background: '#d35400', transition: 'width 0.4s' }} />
          </div>
        </div>
      )}

      {error && <p style={{ marginTop: 16, color: '#c0392b' }}>Failed: {error}</p>}

      {done && (
        <div style={{ marginTop: 16, padding: 16, borderRadius: 8, background: '#fdeaa7' }}>
          <div style={{ fontWeight: 700 }}>{done.lessonTitle}</div>
          <div style={{ fontSize: 13, color: '#7a4a12' }}>{done.scenes} scenes generated.</div>
          <a href={`/course/${done.lessonId}`} style={{ display: 'inline-block', marginTop: 8, fontWeight: 600 }}>
            ▶ Watch the lesson
          </a>
        </div>
      )}
    </main>
  );
}
