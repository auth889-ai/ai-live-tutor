'use client';

// Dev preview: the EXACT flowchart that rendered cramped in Mermaid (ML sc_02 — math inside
// nodes) now through React Flow + dagre, plus a cycle. Verify: labels wrap, nothing clips.

import { DiagramPanel } from '../../../components/course-player/panels/diagram-panel.js';

const REAL_ML_FLOWCHART = {
  diagramType: 'flowchart',
  steps: [
    { id: 'features', label: 'Email Features\nwords=4, links=2' },
    { id: 'weighted_sum', label: 'Weighted Sum\nz = w₁×words + w₂×links + b\nz = 1.5×4 + 1.0×2 + (-4)\nz = 6 + 2 - 4 = 4' },
    { id: 'sigmoid', label: 'Sigmoid Squash\nP(spam) = 1/(1+e^(-4)) ≈ 0.98' },
    { id: 'verdict', label: 'Verdict: SPAM (P ≥ 0.5 threshold)' },
  ],
};

const CYCLE = {
  diagramType: 'cycle',
  steps: ['Evaporation: ocean water rises as vapor', 'Condensation: vapor cools into clouds', 'Precipitation: rain falls to the ground', 'Collection: rivers return water to the sea'],
};

export default function DiagramDevPage() {
  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '32px 16px', display: 'grid', gap: 40 }}>
      <h1 style={{ fontSize: 22, color: '#3a3327' }}>Flowchart/cycle — React Flow + dagre (wrapping nodes)</h1>
      <section><h2 style={{ fontSize: 17, color: '#5a4a2a' }}>The real ML sc_02 flowchart (math wraps, nothing clips)</h2><DiagramPanel content={REAL_ML_FLOWCHART} /></section>
      <section><h2 style={{ fontSize: 17, color: '#5a4a2a' }}>Cycle (loop closes back to the start)</h2><DiagramPanel content={CYCLE} /></section>
    </div>
  );
}
