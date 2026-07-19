// VARIATION ENGINE — the registers' "infinite leveled variations from the student's OWN
// material" made real, with ZERO model calls: take a lesson's executed calc spec
// (dataset + formulas), scale the dataset by clean factors, and RE-EXECUTE the formulas.
// Every variant's answer is engine-computed — a practice question whose answer key cannot
// be wrong, at any scale, forever. Deterministic by construction (factors are fixed,
// no randomness): the same lesson always yields the same practice pack (resume-safe).
//
// The pedagogy is free: some quantities SCALE with the data (revenue at 2x prices and
// 2x quantities is 4x) and some are INVARIANT (elasticity survives any rescaling) — the
// variants expose which is which, a distinction no static worksheet teaches.
//
// Levels:
//   1 RETRIEVE — the lesson's own numbers (recall what was measured)
//   2 TRANSFER — same structure, scaled data (the formula, not the memory, must do the work)
//   3 EXPLAIN  — same variant, but the student must say WHY the value moved or stayed

import { runCalcEvidence } from '../../orchestration/agents/authoring/evidence/calc-evidence.js';

const DEFAULT_FACTORS = [2, 5, 0.5];

// GRADUATED HINTS (IntelliCode's five-level ladder, deterministic): each level narrows
// without disclosing — the answer appears ONLY at level 5. Derived from the executed spec
// itself (columns, label, formula), so a hint can never mislead: it is the real structure.
export function hintLadder({ label, expr, answer, columns = [] }) {
  const quantities = columns.length ? columns.join(', ') : 'the given values';
  return [
    { level: 1, hint: `Which quantities matter here? Look at: ${quantities}. Which of them does "${label}" depend on?` },
    { level: 2, hint: `Name the relationship: you are computing ${label}. Say in words how the quantities combine before touching numbers.` },
    { level: 3, hint: `The formula has this shape: ${String(expr).replace(/\[\d+\]/g, '[…]')} — identify which value goes where.` },
    { level: 4, hint: `Set it up exactly: ${expr} — now substitute the data values and evaluate carefully.` },
    { level: 5, hint: `Worked answer: ${expr} = ${answer}.` },
  ];
}

const scaleDataset = (dataset, factor) => ({
  columns: dataset.columns,
  rows: dataset.rows.map((row) => row.map((cell) => (typeof cell === 'number' ? Math.round(cell * factor * 10000) / 10000 : cell))),
});

export function generateVariations({ dataset, formulas }, { factors = DEFAULT_FACTORS } = {}) {
  if (!dataset?.rows?.length || !formulas?.length) return [];
  const base = runCalcEvidence({ dataset, formulas });

  const variants = [{
    level: 1,
    kind: 'retrieve',
    factor: 1,
    dataset,
    questions: base.results.map((r) => ({
      id: `v1_${r.id}`,
      prompt: `From the lesson's own data: compute ${r.label}.`,
      expr: r.expr,
      answer: r.value,
      hints: hintLadder({ label: r.label, expr: r.expr, answer: r.value, columns: dataset.columns }),
    })),
  }];

  for (const factor of factors) {
    const scaled = scaleDataset(dataset, factor);
    let ev;
    try {
      ev = runCalcEvidence({ dataset: scaled, formulas });
    } catch {
      continue; // a formula that breaks under scaling (division by a shifted zero) is skipped, never faked
    }
    const baseline = new Map(base.results.map((r) => [r.id, r.value]));
    variants.push({
      level: 2,
      kind: 'transfer',
      factor,
      dataset: scaled,
      questions: ev.results.map((r) => ({
        id: `v2_x${String(factor).replace('.', '_')}_${r.id}`,
        prompt: `Every number in the data is now ${factor}x. Compute ${r.label}.`,
        expr: r.expr,
        answer: r.value,
        invariant: r.value === baseline.get(r.id),
        hints: hintLadder({ label: r.label, expr: r.expr, answer: r.value, columns: scaled.columns }),
      })),
    });
    variants.push({
      level: 3,
      kind: 'explain',
      factor,
      dataset: scaled,
      questions: ev.results
        .filter((r) => baseline.has(r.id))
        .map((r) => ({
          id: `v3_x${String(factor).replace('.', '_')}_${r.id}`,
          prompt: r.value === baseline.get(r.id)
            ? `At ${factor}x the data, ${r.label} is STILL ${r.value}. Explain in your own words why scaling every number leaves it unchanged.`
            : `At ${factor}x the data, ${r.label} moved from ${baseline.get(r.id)} to ${r.value}. Explain in your own words why it changed by that amount.`,
          expr: r.expr,
          answer: r.value,
          baselineAnswer: baseline.get(r.id),
        })),
    });
  }
  return variants;
}

// Pull a lesson's executed calc spec back out of its computed_evidence object, if any —
// the bridge from a stored lesson to its practice pack.
export function calcSpecFromLesson(payload) {
  for (const scene of payload?.scenes ?? []) {
    for (const o of scene.objects ?? []) {
      if (o.sourceRef?.provenance === 'executed' && o.content?.dataset?.rows?.length) {
        const rows = (o.content.rows ?? []).filter((r) => Array.isArray(r) && r.length === 3 && typeof r[1] === 'string');
        const formulas = rows
          .map((r, i) => ({ id: `f${i + 1}`, label: String(r[0]), expr: String(r[1]) }))
          .filter((f) => !/^epoch |^w, b$/.test(f.expr)); // training rows are runs, not formulas
        if (formulas.length) return { dataset: o.content.dataset, formulas };
      }
    }
  }
  return null;
}
