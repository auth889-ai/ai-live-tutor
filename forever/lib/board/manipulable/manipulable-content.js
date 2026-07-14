// Manipulable content contract (pure, tested) — the teaching interaction the winners' best
// education entry (SpatialMath AI) and the user's own "manipulate it" spine step both demand:
// the student moves ONE parameter and the curve/number RECOMPUTES live. Unlike a free-drawing
// tool, the value is computed by a WHITELISTED formula the ENGINE owns — so what the student
// sees is always REAL (Forever's verification edge, extended to interaction). Optional
// predict-before-reveal makes the student COMMIT a guess first (pretesting g=0.54).
//
//   {
//     param:   { id, label, min, max, step, default, unit? },   // the slider
//     xAxis:   { label, min, max }, yAxis: { label, min, max },
//     curves:  [{ id, label, formula, coeffs, style? }],        // coeffs may use "@param"
//     readout?:{ label, formula, coeffs, unit? },               // a scalar the param drives
//     predict?:{ prompt, choices:[…], answerIndex },            // commit-before-reveal
//   }
//
// A coeff value of "@param" is substituted with the current slider value at compute time; the
// slider drives exactly one degree of freedom of a known formula. Everything else is fixed data.

// The whitelist. Each is a pure, deterministic (x, c) -> y. Chosen to cover the subjects a
// manipulable actually teaches: ML (sigmoid threshold), econ (line shift), physics/loss (decay),
// math (parabola / line). No eval, no free expressions — the engine owns every formula.
export const FORMULAS = Object.freeze({
  linear: (x, c) => c.m * x + c.b,                          // slope/intercept — math, supply/demand line
  quadratic: (x, c) => c.a * x * x + c.b * x + c.c,          // parabola — math, projectile height
  sigmoid: (x, c) => 1 / (1 + Math.exp(-c.k * (x - c.x0))),  // logistic — ML decision threshold
  expDecay: (x, c) => c.A * Math.exp(-c.k * x),              // decay — loss curve, physics
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const SERIES_STYLES = new Set(['solid', 'dashed', 'ghost']);

// Replace every "@param" coeff with the current slider value. Pure — returns a fresh object.
export function resolveCoeffs(coeffs, paramValue) {
  const out = {};
  for (const [k, v] of Object.entries(coeffs)) out[k] = v === '@param' ? paramValue : v;
  return out;
}

// Sample a curve across the x-axis at the current parameter value. Points are clamped into the
// declared y-range so the recomputed curve always renders in-frame (the axes are chosen to hold
// the parameter's range; clamping guards the edges rather than drawing an off-scale lie).
export function computeCurvePoints(curve, xAxis, yAxis, paramValue, samples = 48) {
  const fn = FORMULAS[curve.formula];
  const c = resolveCoeffs(curve.coeffs, paramValue);
  const pts = [];
  for (let i = 0; i <= samples; i += 1) {
    const x = xAxis.min + ((xAxis.max - xAxis.min) * i) / samples;
    const yRaw = fn(x, c);
    const y = Math.min(yAxis.max, Math.max(yAxis.min, Number.isFinite(yRaw) ? yRaw : yAxis.min));
    pts.push([x, Number(y.toFixed(4))]);
  }
  return pts;
}

// The scalar readout the parameter drives (e.g. "Loss at this learning rate"), computed live.
export function computeReadout(readout, paramValue) {
  if (!readout) return null;
  const fn = FORMULAS[readout.formula];
  const y = fn(readout.at ?? paramValue, resolveCoeffs(readout.coeffs, paramValue));
  return { label: readout.label, value: Number(y.toFixed(4)), unit: readout.unit ?? '' };
}

// Recompute the whole manipulable INTO the existing chart-content shape, so the player reuses the
// tested ChartView renderer. One function; the UI just calls this on every slider move.
export function toChartContent(content, paramValue) {
  return {
    xAxis: content.xAxis,
    yAxis: content.yAxis,
    series: content.curves.map((curve) => ({
      id: curve.id,
      label: curve.label,
      style: curve.style ?? 'solid',
      points: computeCurvePoints(curve, content.xAxis, content.yAxis, paramValue),
    })),
    annotations: content.annotations ?? [],
  };
}

export function validateManipulableContent(content, context = 'manipulable') {
  if (!content || typeof content !== 'object') throw new Error(`${context} content must be an object`);

  const p = content.param;
  if (!p || typeof p !== 'object') throw new Error(`${context} needs param: { id, label, min, max, step, default }`);
  if (typeof p.id !== 'string' || !p.id.trim()) throw new Error(`${context}.param needs an id`);
  if (typeof p.label !== 'string' || !p.label.trim()) throw new Error(`${context}.param.label must name what the student changes (e.g. "Learning rate")`);
  if (!isNum(p.min) || !isNum(p.max) || p.min >= p.max) throw new Error(`${context}.param needs numeric min < max`);
  if (!isNum(p.step) || p.step <= 0) throw new Error(`${context}.param.step must be a positive number`);
  if (!isNum(p.default) || p.default < p.min || p.default > p.max) throw new Error(`${context}.param.default must be a number within [min, max]`);

  for (const axisKey of ['xAxis', 'yAxis']) {
    const axis = content[axisKey];
    if (!axis || typeof axis !== 'object') throw new Error(`${context} needs ${axisKey}: { label, min, max }`);
    if (typeof axis.label !== 'string' || !axis.label.trim()) throw new Error(`${context} ${axisKey}.label must name the quantity`);
    if (!isNum(axis.min) || !isNum(axis.max) || axis.min >= axis.max) throw new Error(`${context} ${axisKey} needs numeric min < max`);
  }

  if (!Array.isArray(content.curves) || content.curves.length === 0) {
    throw new Error(`${context} needs curves[] — at least one recomputable curve`);
  }
  const ids = new Set();
  content.curves.forEach((curve, i) => {
    const at = `${context} curve ${i}${curve?.id ? ` ("${curve.id}")` : ''}`;
    if (!curve || typeof curve !== 'object') throw new Error(`${at} must be an object`);
    if (typeof curve.id !== 'string' || !curve.id.trim()) throw new Error(`${at} needs an id`);
    if (ids.has(curve.id)) throw new Error(`${context} duplicate curve id "${curve.id}"`);
    ids.add(curve.id);
    if (typeof curve.label !== 'string' || !curve.label.trim()) throw new Error(`${at} needs a label`);
    if (!FORMULAS[curve.formula]) throw new Error(`${at} formula must be one of ${Object.keys(FORMULAS).join('/')} (the engine only computes whitelisted formulas)`);
    if (!curve.coeffs || typeof curve.coeffs !== 'object') throw new Error(`${at} needs coeffs (numbers, or "@param" for the slider-driven one)`);
    for (const [k, v] of Object.entries(curve.coeffs)) {
      if (v !== '@param' && !isNum(v)) throw new Error(`${at} coeff "${k}" must be a number or "@param"`);
    }
    if (curve.style !== undefined && !SERIES_STYLES.has(curve.style)) throw new Error(`${at} style must be solid/dashed/ghost`);
  });

  // Exactly one degree of freedom drives the interaction: at least one coeff must be "@param".
  const drivesSomething = content.curves.some((curve) => Object.values(curve.coeffs).includes('@param'))
    || (content.readout && Object.values(content.readout.coeffs ?? {}).includes('@param'));
  if (!drivesSomething) throw new Error(`${context}: the param drives nothing — at least one coeff (or readout coeff) must be "@param", else the slider is decorative`);

  if (content.predict !== undefined) {
    const q = content.predict;
    if (typeof q.prompt !== 'string' || !q.prompt.trim()) throw new Error(`${context}.predict needs a prompt (commit-before-reveal)`);
    if (!Array.isArray(q.choices) || q.choices.length < 2 || !q.choices.every((c) => typeof c === 'string' && c.trim())) {
      throw new Error(`${context}.predict needs choices[] of ≥2 non-empty strings`);
    }
    if (!Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex >= q.choices.length) {
      throw new Error(`${context}.predict.answerIndex must index into choices`);
    }
  }

  return content;
}
