'use client';

// DEV GALLERY — every engine rendered from a REAL trace (scripts/gen-trace-fixtures.mjs runs
// actual solutions through python3). Pick an engine with ?i=<index>&p=<0..1> so a headless
// screenshot can land on any structure at any step for visual verification.

import { useState, useEffect } from 'react';

import { AlgorithmStage } from '../../../components/course-player/algorithm-stage/algorithm-stage.js';
import traces from './traces.json';

export default function Gallery() {
  const [i, setI] = useState(0);
  const [progress, setProgress] = useState(0.9);

  // URL params drive the screenshot: ?i=2&p=0.6
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.has('i')) setI(Math.max(0, Math.min(traces.length - 1, Number(q.get('i')) || 0)));
    if (q.has('p')) setProgress(Math.max(0, Math.min(1, Number(q.get('p')))));
  }, []);

  const entry = traces[i];
  if (!entry) return <div style={{ padding: 24 }}>no traces — run scripts/gen-trace-fixtures.mjs</div>;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Engine gallery — real traces</h1>
      <div style={{ display: 'flex', gap: 6, margin: '12px 0', flexWrap: 'wrap' }}>
        {traces.map((t, idx) => (
          <button
            key={idx}
            onClick={() => { setI(idx); setProgress(0.9); }}
            className={idx === i ? 'forever-btn' : 'forever-chip'}
            style={{ padding: '6px 12px', color: idx === i ? '#fff' : '#5a4a2a', cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}
          >
            {t.name}
          </button>
        ))}
      </div>
      <input type="range" min={0} max={1000} value={Math.round(progress * 1000)} onChange={(e) => setProgress(Number(e.target.value) / 1000)} style={{ width: '100%', margin: '8px 0 18px' }} />
      <div style={{ fontSize: 13, color: '#8a6d3b', marginBottom: 10 }}>{entry.name} — {entry.trace.steps.length} steps</div>
      <AlgorithmStage trace={entry.trace} progress={progress} />
    </div>
  );
}
