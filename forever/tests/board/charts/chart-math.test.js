import assert from 'node:assert/strict';
import test from 'node:test';

import { makeScale, niceTicks, seriesColors } from '../../../lib/board/charts/chart-math.js';

test('makeScale maps the data domain linearly onto the pixel range (inverted for y)', () => {
  const sx = makeScale([0, 300], [68, 696]);
  assert.equal(sx(0), 68);
  assert.equal(sx(300), 696);
  assert.equal(sx(150), (68 + 696) / 2);
  const sy = makeScale([0, 6], [372, 26]); // y grows downward in SVG
  assert.equal(sy(0), 372);
  assert.equal(sy(6), 26);
});

test('niceTicks picks 1/2/5-ladder steps covering the range', () => {
  assert.deepEqual(niceTicks(0, 6), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(niceTicks(0, 300), [0, 50, 100, 150, 200, 250, 300]);
  assert.deepEqual(niceTicks(0, 1), [0, 0.2, 0.4, 0.6, 0.8, 1]);
});

test('ghost/shifted variants of one curve share their sibling color (the shift reads as ONE curve moving)', () => {
  const colors = seriesColors([
    { id: 'demand_old', label: 'Demand (before)' },
    { id: 'demand', label: 'Demand (after)' },
    { id: 'supply', label: 'Supply' },
  ]);
  assert.equal(colors.get('demand_old'), colors.get('demand'));
  assert.notEqual(colors.get('supply'), colors.get('demand'));
});
