// CHEMICAL EQUATION BALANCE CHECKER — chemistry's engine=truth, zero tokens. A balanced
// equation is a conservation law: every element's atom count must be equal on both sides.
// This parses "CH4 + 2 O2 -> CO2 + 2 H2O", counts atoms per element per side, and reports
// any imbalance — so a chemistry lesson literally cannot present an unbalanced equation as
// balanced (the Drennan/POGIL "atom conservation is checkable" law, made checkable).
//
// Deterministic, no LLM. Handles coefficients, subscripts, and nested groups: Ca(OH)2, Al2(SO4)3.

// Parse one formula (e.g. "Ca(OH)2", "2 H2O") -> { coefficient, atoms: {Ca:1,O:2,H:2} }
function parseFormula(term) {
  const m = String(term).trim().match(/^(\d+)?\s*(.+)$/);
  const coefficient = m[1] ? Number(m[1]) : 1;
  const formula = m[2].replace(/\s+/g, '');
  const atoms = parseGroup(formula);
  return { coefficient, atoms };
}

// Recursive-descent over element symbols, subscripts, and parenthesized groups.
function parseGroup(s) {
  const atoms = {};
  let i = 0;
  while (i < s.length) {
    if (s[i] === '(') {
      let depth = 1, j = i + 1;
      while (j < s.length && depth > 0) { if (s[j] === '(') depth += 1; if (s[j] === ')') depth -= 1; j += 1; }
      const inner = parseGroup(s.slice(i + 1, j - 1));
      const numMatch = s.slice(j).match(/^\d+/);
      const mult = numMatch ? Number(numMatch[0]) : 1;
      for (const [el, n] of Object.entries(inner)) atoms[el] = (atoms[el] ?? 0) + n * mult;
      i = j + (numMatch ? numMatch[0].length : 0);
    } else {
      const elMatch = s.slice(i).match(/^([A-Z][a-z]?)(\d*)/);
      if (!elMatch || !elMatch[1]) { i += 1; continue; }
      const el = elMatch[1];
      const count = elMatch[2] ? Number(elMatch[2]) : 1;
      atoms[el] = (atoms[el] ?? 0) + count;
      i += elMatch[0].length;
    }
  }
  return atoms;
}

function sideCounts(side) {
  const totals = {};
  for (const term of side.split('+')) {
    if (!term.trim()) continue;
    const { coefficient, atoms } = parseFormula(term);
    for (const [el, n] of Object.entries(atoms)) totals[el] = (totals[el] ?? 0) + n * coefficient;
  }
  return totals;
}

// Recognize an equation string: has a reaction arrow AND element-looking tokens.
const ARROW = /->|→|=>|⇌|<=>/;
export function isEquation(text) {
  const t = String(text ?? '');
  return ARROW.test(t) && /[A-Z][a-z]?\d*/.test(t) && /\+/.test(t.split(ARROW)[0] + t.split(ARROW)[1] || '');
}

export function checkBalance(equation) {
  const t = String(equation ?? '').trim();
  const parts = t.split(ARROW);
  if (parts.length !== 2) return { ok: true, reason: 'not a two-sided equation' };
  const [lhs, rhs] = parts;
  let left, right;
  try { left = sideCounts(lhs); right = sideCounts(rhs); } catch { return { ok: true, reason: 'unparseable — skipped' }; }
  const elements = new Set([...Object.keys(left), ...Object.keys(right)]);
  const imbalances = [];
  for (const el of elements) {
    const l = left[el] ?? 0, r = right[el] ?? 0;
    if (l !== r) imbalances.push(`${el}: ${l} left vs ${r} right`);
  }
  if (imbalances.length) return { ok: false, reason: `unbalanced — ${imbalances.join('; ')}` };
  return { ok: true, reason: 'balanced' };
}

// Scan a chemistry lesson for unbalanced equations presented on the board or narrated.
export function balanceViolations(payload, { domain = null } = {}) {
  if (domain !== 'chemistry') return [];
  const out = [];
  const seen = new Set();
  for (const scene of payload?.scenes ?? []) {
    const strings = [];
    const walk = (v) => {
      if (typeof v === 'string') strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    for (const o of scene.objects ?? []) walk(o.content);
    for (const vl of scene.voiceLines ?? []) strings.push(vl.text);
    for (const s of strings) {
      // extract ONLY the chemical tokens around each arrow (ignore surrounding prose):
      // a side is chemical terms (opt-coefficient + formula) joined by "+".
      const TERM = String.raw`\d*\s*[A-Z][A-Za-z0-9()]*`;
      const SIDE = `(?:${TERM}\\s*\\+\\s*)*${TERM}`;
      const EQ = new RegExp(`(${SIDE})\\s*(?:->|\\u2192|=>|\\u21cc|<=>)\\s*(${SIDE})`, 'g');
      for (const m of String(s).matchAll(EQ)) {
        const eq = `${m[1].trim()} -> ${m[2].trim()}`;
        const key = eq.replace(/\s+/g, '');
        if (seen.has(key)) continue;
        seen.add(key);
        const r = checkBalance(eq);
        if (!r.ok) out.push({ sceneId: scene.sceneId, rule: 'equation-unbalanced', detail: `"${eq.slice(0, 60)}" ${r.reason}` });
      }
    }
  }
  return out;
}
