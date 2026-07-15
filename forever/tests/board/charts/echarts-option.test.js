import assert from 'node:assert/strict';
import test from 'node:test';

import { toEChartsOption } from '../../../lib/board/charts/echarts-option.js';

const ECON = {
  xAxis: { label: 'Quantity', min: 0, max: 12 },
  yAxis: { label: 'Price ($)', min: 0, max: 12 },
  series: [
    { id: 'demand_old', label: 'Demand (before)', style: 'ghost', points: [[0, 9], [10, 1]] },
    { id: 'demand', label: 'Demand (after)', points: [[0, 11], [10, 3]] },
    { id: 'data', label: 'Observed sales', style: 'scatter', points: [[4, 6, 'June'], [6, 5]] },
  ],
  annotations: [
    { type: 'point', x: 5, y: 6, label: 'Equilibrium' },
    { type: 'vline', x: 5, label: 'Q*' },
    { type: 'arrow', from: [4, 5], to: [6, 7], label: 'shift' },
    { type: 'region', x1: 2, x2: 4, label: 'shortage' },
  ],
};

test('the mapper is a deterministic transform of the SAME validated contract (design law intact)', () => {
  const opt = toEChartsOption(ECON);
  assert.equal(opt.series.length, 3);
  const [ghost, solid, scatter] = opt.series;
  assert.equal(ghost.lineStyle.type, 'dashed');
  assert.ok(ghost.lineStyle.opacity < 1, 'ghost stays faded — the MRU shift move survives the upgrade');
  assert.equal(solid.lineStyle.type, 'solid');
  assert.equal(scatter.type, 'scatter');
  assert.equal(scatter.data[0].name, 'June', 'scatter class tags become point labels');
});

test('containLabel is on — the live-reported cut-off-labels bug is structurally dead', () => {
  const opt = toEChartsOption(ECON);
  assert.equal(opt.grid.containLabel, true);
  assert.equal(opt.xAxis.axisLabel.hideOverlap, true, 'overlapping tick labels auto-hide');
});

test('annotations map: point->markPoint, vline->markLine, arrow->arrowed pair, region->markArea', () => {
  const opt = toEChartsOption(ECON);
  const first = opt.series[0];
  assert.equal(first.markPoint.data[0].name, 'Equilibrium');
  assert.ok(first.markLine.data.some((d) => d.xAxis === 5));
  const arrow = first.markLine.data.find((d) => Array.isArray(d));
  assert.equal(arrow[1].symbol, 'arrow');
  assert.equal(first.markArea.data[0][0].xAxis, 2);
});

test('a single-series chart hides the legend (no decoration without information)', () => {
  const opt = toEChartsOption({ ...ECON, series: [ECON.series[1]], annotations: [] });
  assert.equal(opt.legend.show, false);
});
