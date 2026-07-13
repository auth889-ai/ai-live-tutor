'use client';

// DEV PREVIEW of the ChartView curve primitive (not product content). The fixture is the
// exact shape the Board Director is prompted to write: a demand SHIFT with the old curve
// as a ghost, a direction arrow, named equilibria, a guide line and a shortage band —
// everything Mermaid xychart could not draw. Screenshot this page to verify rendering.

import { ChartView } from '../../../components/course-player/panels/chart-view.js';

const HEAT_WAVE_SHIFT = {
  xAxis: { label: 'Quantity (scoops per day)', min: 0, max: 300 },
  yAxis: { label: 'Price ($ per scoop)', min: 0, max: 6 },
  series: [
    { id: 'demand_old', label: 'Demand (before)', style: 'ghost', points: [[0, 6], [300, 0]] },
    { id: 'demand', label: 'Demand (after heat wave)', points: [[50, 6], [300, 1]] },
    { id: 'supply', label: 'Supply', points: [[0, 1], [250, 6]] },
  ],
  annotations: [
    { type: 'point', x: 150, y: 3, label: 'E1' },
    { type: 'point', x: 200, y: 4, label: 'E2' },
    { type: 'arrow', from: [110, 3.2], to: [185, 3.2], label: 'demand shifts right' },
    { type: 'vline', x: 150 },
    { type: 'region', x1: 150, x2: 250, label: 'shortage at old price' },
  ],
};

export default function ChartPreview() {
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>ChartView — the curve primitive</h1>
      <p style={{ color: '#8a8172', fontSize: 13, marginTop: 0 }}>
        Ghost curve + shared hue = one curve visibly moving. Legend, named equilibria, shift arrow, shortage band.
      </p>
      <ChartView content={HEAT_WAVE_SHIFT} />
    </div>
  );
}
