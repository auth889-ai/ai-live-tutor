// Chart geometry (pure, tested): axis scales and tick choice for the SVG chart renderer.
// Kept out of the React component so the math is unit-testable in node.

// Linear scale: data domain -> pixel range.
export function makeScale([d0, d1], [r0, r1]) {
  const span = d1 - d0;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

// "Nice" tick values covering [min, max] with roughly `count` steps (1/2/5 ladder,
// d3-style threshold rounding so 0–6 gets step 1, not a sparse 2).
export function niceTicks(min, max, count = 5) {
  const raw = (max - min) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const ratio = raw / mag;
  const step = mag * (ratio >= 7.07 ? 10 : ratio >= 3.16 ? 5 : ratio >= 1.41 ? 2 : 1);
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

// Deterministic series colors: warm, high-contrast, palette-consistent (no AI color picking).
// Ghost/dashed styling is handled by the renderer; ghosts inherit their sibling's hue when
// ids share a stem ("demand" / "demand_old") so the shift reads as ONE curve moving.
const PALETTE = ['#BC3F34', '#2D5F9E', '#2F7D4A', '#B87F24', '#6B3FA0', '#84685E'];

export function seriesColors(series) {
  const colors = new Map();
  let next = 0;
  for (const s of series) {
    const stem = String(s.id).replace(/_?(old|new|original|shifted|before|after|ghost)$/i, '');
    const sibling = [...colors.keys()].find((id) => id.replace(/_?(old|new|original|shifted|before|after|ghost)$/i, '') === stem);
    colors.set(s.id, sibling ? colors.get(sibling) : PALETTE[next++ % PALETTE.length]);
  }
  return colors;
}
