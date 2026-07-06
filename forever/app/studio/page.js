'use client';

// Studio: paste any learning material -> the agent society generates a course lesson ->
// jump to the player. The real product entry point (ARCHITECTURE.md app/studio).
// Generation is currently synchronous (~2 min); Phase 4 adds queued jobs + live progress.

import { useState } from 'react';

export default function StudioPage() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState(null);

  async function generate() {
    setResult(null);
    setStatus('Generating — the agents are planning, writing, and reviewing the lesson (~2 min)...');
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Generation failed');
      setResult(data);
      setStatus(null);
    } catch (error) {
      setStatus(`Failed: ${error.message}`);
    }
  }

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
        onClick={generate}
        disabled={text.trim().length < 60 || status?.startsWith('Generating')}
        style={{ marginTop: 12, padding: '10px 24px', fontSize: 16, borderRadius: 8 }}
      >
        Generate lesson
      </button>
      {status && <p style={{ marginTop: 16 }}>{status}</p>}
      {result && (
        <div style={{ marginTop: 16, padding: 16, borderRadius: 8, background: '#fdeaa7' }}>
          <div style={{ fontWeight: 700 }}>{result.lessonTitle}</div>
          <div style={{ fontSize: 13, color: '#7a4a12' }}>{result.scenes} scenes generated.</div>
          <a href={`/course/${result.id}`} style={{ display: 'inline-block', marginTop: 8, fontWeight: 600 }}>
            ▶ Watch the lesson
          </a>
        </div>
      )}
    </main>
  );
}
