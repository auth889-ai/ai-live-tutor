'use client';

// Lens gallery — every pattern family's REAL trace (from the universal engine, real python
// runs) rendered through the REAL cockpit. The generalization proof for the eyes: grid and
// graph were screenshot-verified via full lessons; this page makes the other families
// inspectable without burning build tokens. Scrub each trace with its own slider.

import { useState } from 'react';

import { AlgorithmStage } from '../../../components/course-player/algorithm-stage/algorithm-stage.js';
import gallery from './gallery.json';

function LensCard({ item }) {
  const steps = item.trace?.steps?.length ?? 0;
  const [index, setIndex] = useState(Math.min(3, Math.max(0, steps - 1)));
  if (!item.trace) {
    return <div style={{ padding: 16, border: '2px solid #e06c75', borderRadius: 12 }}>✖ {item.name}: {item.error}</div>;
  }
  return (
    <section style={{ display: 'grid', gap: 8 }}>
      <h2 style={{ fontSize: 17, color: '#5a4a2a', margin: 0 }}>
        {item.name} <span style={{ color: '#8a6d3b', fontWeight: 400 }}>· lens: {item.lens} · {steps} steps</span>
      </h2>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input type="range" min="0" max={steps - 1} value={index} onChange={(e) => setIndex(Number(e.target.value))} style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: '#8a6d3b', minWidth: 70 }}>step {index + 1}/{steps}</span>
      </div>
      <AlgorithmStage trace={item.trace} stepIndex={index} progress={1} />
    </section>
  );
}

export default function LensGalleryPage() {
  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '32px 16px', display: 'grid', gap: 44 }}>
      <h1 style={{ fontSize: 22, color: '#3a3327' }}>Lens gallery — every family, real traces, real cockpit</h1>
      {gallery.map((item) => <LensCard key={item.name} item={item} />)}
    </div>
  );
}
