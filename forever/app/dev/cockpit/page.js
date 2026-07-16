'use client';

// /dev/cockpit — the C3 screenshot gate: the handwritten Tarjan SemanticVisualSpec rendered
// over a REAL engine trace through the CompositionCockpit (resolver-fed panels). If this page
// is wrong, the bug is the resolver/renderer — never the (future) Director.

import { useState } from 'react';

import { CompositionCockpit } from '../../../components/course-player/panels/composition-cockpit.js';
import fixture from './fixture.json';

export default function CockpitFixturePage() {
  const steps = fixture.trace?.steps?.length ?? 0;
  const [index, setIndex] = useState(Math.min(12, Math.max(0, steps - 1)));
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 16px', display: 'grid', gap: 12 }}>
      <h1 style={{ fontSize: 20, color: '#3a3327' }}>Cockpit fixture — handwritten spec · real trace · resolver-fed panels</h1>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input type="range" min="0" max={Math.max(0, steps - 1)} value={index} onChange={(e) => setIndex(Number(e.target.value))} style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: '#8a6d3b', minWidth: 80 }}>step {index + 1}/{steps}</span>
      </div>
      <CompositionCockpit spec={fixture.spec} trace={fixture.trace} stepIndex={index} />
    </div>
  );
}
