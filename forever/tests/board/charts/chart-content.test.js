import assert from 'node:assert/strict';
import test from 'node:test';

import { validateChartContent } from '../../../lib/board/charts/chart-content.js';

const axes = {
  xAxis: { label: 'Quantity (scoops)', min: 0, max: 300 },
  yAxis: { label: 'Price ($)', min: 0, max: 6 },
};

const supplyDemandShift = {
  ...axes,
  series: [
    { id: 'demand_old', label: 'Demand (before)', style: 'ghost', points: [[0, 6], [300, 0]] },
    { id: 'demand', label: 'Demand (after heat wave)', points: [[50, 6], [300, 1]] },
    { id: 'supply', label: 'Supply', points: [[0, 1], [300, 6]] },
  ],
  annotations: [
    { type: 'point', x: 150, y: 3, label: 'E1' },
    { type: 'point', x: 200, y: 4, label: 'E2' },
    { type: 'arrow', from: [120, 3.5], to: [190, 3.5], label: 'demand shifts right' },
    { type: 'vline', x: 150 },
    { type: 'region', x1: 150, x2: 250, label: 'shortage' },
  ],
};

test('the full supply-demand-shift shape (ghost + arrow + equilibria + region) validates', () => {
  validateChartContent(supplyDemandShift);
});

test('axes are mandatory with numeric min < max and a named label', () => {
  assert.throws(() => validateChartContent({ series: [] }), /needs xAxis/);
  assert.throws(() => validateChartContent({ ...supplyDemandShift, yAxis: { label: 'P', min: 6, max: 0 } }), /min < max/);
  assert.throws(() => validateChartContent({ ...supplyDemandShift, xAxis: { label: ' ', min: 0, max: 1 } }), /label must name the quantity/);
});

test('every point must live inside the declared axes (the off-scale-lie rule)', () => {
  assert.throws(
    () => validateChartContent({ ...axes, series: [{ id: 's', label: 'Supply', points: [[0, 1], [300, 7]] }] }),
    /\[300, 7\] lies outside the declared axes/,
  );
});

test('series need ids, labels (the legend), ≥2 points, legal styles, and a readable count', () => {
  assert.throws(() => validateChartContent({ ...axes, series: [] }), /at least one curve/);
  assert.throws(() => validateChartContent({ ...axes, series: [{ id: 'a', label: 'A', points: [[1, 1]] }] }), /at least 2 points/);
  assert.throws(() => validateChartContent({ ...axes, series: [{ id: 'a', points: [[0, 0], [1, 1]] }] }), /needs a label/);
  assert.throws(() => validateChartContent({ ...axes, series: [{ id: 'a', label: 'A', style: 'wavy', points: [[0, 0], [1, 1]] }] }), /solid\/dashed\/ghost/);
  assert.throws(
    () => validateChartContent({ ...axes, series: Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, label: `S${i}`, points: [[0, 0], [1, 1]] })) }),
    /6 is the readable maximum/,
  );
});

test('annotations are typed and range-checked; unnamed point markers are rejected', () => {
  assert.throws(() => validateChartContent({ ...axes, series: supplyDemandShift.series, annotations: [{ type: 'blob' }] }), /type point\/vline\/hline\/arrow\/region/);
  assert.throws(() => validateChartContent({ ...axes, series: supplyDemandShift.series, annotations: [{ type: 'point', x: 150, y: 3 }] }), /needs a label/);
  assert.throws(() => validateChartContent({ ...axes, series: supplyDemandShift.series, annotations: [{ type: 'region', x1: 200, x2: 100 }] }), /x1 < x2/);
  assert.throws(() => validateChartContent({ ...axes, series: supplyDemandShift.series, annotations: [{ type: 'arrow', from: [0, 0], to: [400, 2] }] }), /in-range numeric to/);
});

test('scatter series: the dataset as a first-class citizen (points-only, optional class tags, 1 point ok)', () => {
  const chart = {
    xAxis: { label: 'suspicious words', min: 0, max: 8 },
    yAxis: { label: 'links', min: 0, max: 6 },
    series: [
      { id: 'spam', label: 'Spam', style: 'scatter', points: [[7, 4, 'spam'], [5, 3, 'spam']] },
      { id: 'ham', label: 'Not spam', style: 'scatter', points: [[0, 1]] }, // one point is a legit scatter
      { id: 'boundary', label: 'Decision boundary', points: [[0, 5.5], [8, 0.5]] },
    ],
  };
  validateChartContent(chart);
  // A class tag must be a non-empty string; a LINE series still needs 2+ points.
  assert.throws(() => validateChartContent({ ...chart, series: [{ id: 'bad', label: 'B', style: 'scatter', points: [[1, 1, 42]] }] }), /class label/);
  assert.throws(() => validateChartContent({ ...chart, series: [{ id: 'line1', label: 'L', points: [[1, 1]] }] }), /at least 2 points/);
});
