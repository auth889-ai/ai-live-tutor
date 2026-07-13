// Chart content contract (pure, tested). The hand-rolled curve primitive the research
// demanded (Mermaid xychart is banned for curve teaching: no legends, no point markers,
// no ghost curves — measured live: it killed 8/8 scenes of an economics lesson). One
// declarative shape covers supply/demand shifts, loss curves, function plots, projectile
// paths. The AI declares data + meaning; the renderer owns geometry and color.
//
//   {
//     xAxis: { label, min, max },  yAxis: { label, min, max },
//     series: [{ id, label, points: [[x,y],…≥2], style?: solid|dashed|ghost }],
//     annotations?: [
//       { type:"point",  x, y, label }                    // equilibrium dots
//       { type:"vline",  x, label? } | { type:"hline", y, label? }
//       { type:"arrow",  from:[x,y], to:[x,y], label? }   // shift-direction arrows
//       { type:"region", x1, x2, label? }                 // shortage/surplus bands
//     ],
//   }
//
// "ghost" is the MRU move: the pre-shift curve stays as a dashed phantom so the SHIFT
// itself is visible. Every coordinate must live inside the declared axes — an off-scale
// line renders as a lie (same rule as the xychart gate).

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const SERIES_STYLES = new Set(['solid', 'dashed', 'ghost']);
const ANNOTATION_TYPES = new Set(['point', 'vline', 'hline', 'arrow', 'region']);

export function validateChartContent(content, context = 'chart') {
  if (!content || typeof content !== 'object') throw new Error(`${context} content must be an object`);

  for (const axisKey of ['xAxis', 'yAxis']) {
    const axis = content[axisKey];
    if (!axis || typeof axis !== 'object') throw new Error(`${context} needs ${axisKey}: { label, min, max }`);
    if (typeof axis.label !== 'string' || !axis.label.trim()) throw new Error(`${context} ${axisKey}.label must name the quantity (e.g. "Price ($/scoop)")`);
    if (!isNum(axis.min) || !isNum(axis.max) || axis.min >= axis.max) {
      throw new Error(`${context} ${axisKey} needs numeric min < max (got min=${axis.min}, max=${axis.max})`);
    }
  }
  const inX = (v) => v >= content.xAxis.min && v <= content.xAxis.max;
  const inY = (v) => v >= content.yAxis.min && v <= content.yAxis.max;

  if (!Array.isArray(content.series) || content.series.length === 0) {
    throw new Error(`${context} needs series[] — at least one curve with ≥2 [x, y] points`);
  }
  if (content.series.length > 6) throw new Error(`${context} has ${content.series.length} series — 6 is the readable maximum; split the idea across scenes`);
  const ids = new Set();
  content.series.forEach((s, i) => {
    const at = `${context} series ${i}${s?.id ? ` ("${s.id}")` : ''}`;
    if (!s || typeof s !== 'object') throw new Error(`${at} must be an object`);
    if (typeof s.id !== 'string' || !s.id.trim()) throw new Error(`${at} needs an id`);
    if (ids.has(s.id)) throw new Error(`${context} duplicate series id "${s.id}"`);
    ids.add(s.id);
    if (typeof s.label !== 'string' || !s.label.trim()) throw new Error(`${at} needs a label — the legend must name every curve`);
    if (s.style !== undefined && !SERIES_STYLES.has(s.style)) throw new Error(`${at} style must be one of solid/dashed/ghost`);
    if (!Array.isArray(s.points) || s.points.length < 2) throw new Error(`${at} needs points: [[x, y], …] with at least 2 points`);
    s.points.forEach((p, j) => {
      if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1])) {
        throw new Error(`${at} point ${j} must be a numeric [x, y] pair`);
      }
      if (!inX(p[0]) || !inY(p[1])) {
        throw new Error(`${at} point ${j} [${p[0]}, ${p[1]}] lies outside the declared axes — extend the axis range or fix the data (an off-scale curve renders as a lie)`);
      }
    });
  });

  if (content.annotations !== undefined) {
    if (!Array.isArray(content.annotations)) throw new Error(`${context} annotations must be an array`);
    content.annotations.forEach((a, i) => {
      const at = `${context} annotation ${i}`;
      if (!a || typeof a !== 'object' || !ANNOTATION_TYPES.has(a.type)) {
        throw new Error(`${at} needs type point/vline/hline/arrow/region`);
      }
      if (a.type === 'point') {
        if (!isNum(a.x) || !isNum(a.y) || !inX(a.x) || !inY(a.y)) throw new Error(`${at} needs in-range numeric x and y`);
        if (typeof a.label !== 'string' || !a.label.trim()) throw new Error(`${at} (point) needs a label — an unnamed dot teaches nothing`);
      }
      if (a.type === 'vline' && (!isNum(a.x) || !inX(a.x))) throw new Error(`${at} (vline) needs in-range numeric x`);
      if (a.type === 'hline' && (!isNum(a.y) || !inY(a.y))) throw new Error(`${at} (hline) needs in-range numeric y`);
      if (a.type === 'arrow') {
        for (const end of ['from', 'to']) {
          const p = a[end];
          if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1]) || !inX(p[0]) || !inY(p[1])) {
            throw new Error(`${at} (arrow) needs in-range numeric ${end}: [x, y]`);
          }
        }
      }
      if (a.type === 'region') {
        if (!isNum(a.x1) || !isNum(a.x2) || a.x1 >= a.x2 || !inX(a.x1) || !inX(a.x2)) {
          throw new Error(`${at} (region) needs in-range numeric x1 < x2`);
        }
      }
    });
  }

  return content;
}
