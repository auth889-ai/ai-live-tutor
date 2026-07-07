'use client';

// "Generate" button for a course lesson that doesn't exist yet: enqueues the job, follows
// its live progress over SSE, and reloads the page when the lesson is ready so the row
// becomes a play link. One button, honest states: idle -> generating(x%) -> error/reload.

import { useRef, useState } from 'react';

export function GenerateLessonButton({ courseId, outlineLessonId }) {
  const [progress, setProgress] = useState(null); // null | {percent, phase}
  const [error, setError] = useState(null);
  const sourceRef = useRef(null);

  async function start() {
    setError(null);
    setProgress({ percent: 0, phase: 'queued' });
    try {
      const res = await fetch(`/api/courses/${courseId}/lessons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outlineLessonId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start generation');
      const es = new EventSource(`/api/jobs/${data.jobId}/events`);
      sourceRef.current = es;
      es.addEventListener('progress', (e) => setProgress(JSON.parse(e.data)));
      es.addEventListener('done', () => { es.close(); window.location.reload(); });
      es.addEventListener('error', (e) => {
        let message = 'Generation failed';
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

  if (progress) {
    return (
      <span style={{ fontSize: 12.5, fontWeight: 700, color: '#8a6d3b', whiteSpace: 'nowrap' }}>
        ⏳ {progress.phase} · {progress.percent ?? 0}%
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {error && <span style={{ fontSize: 11.5, color: '#a33d2e' }}>{error}</span>}
      <button onClick={start}
        style={{ border: '1.5px solid #f47368', color: '#e8604c', background: '#fff', borderRadius: 999, padding: '6px 16px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
        ⚡ Generate
      </button>
    </span>
  );
}
