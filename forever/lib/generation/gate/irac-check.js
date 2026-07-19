// IRAC STRUCTURE CHECKER — law's engine=truth for reasoning STRUCTURE (pure JS, no tool).
// Langdell's case method demands Issue -> Rule -> Application -> Conclusion, and the value is
// in APPLICATION: mapping the rule's elements to the facts. A legal lesson that states a rule
// and jumps to a holding — skipping application — has skipped the discipline. This detects a
// lesson that reaches a legal CONCLUSION without an APPLICATION beat, so the gate can force the
// missing step (the same way the number gate forces executed evidence).
//
// Heuristic and domain-scoped (law only): looks across the whole lesson's text for the four
// IRAC moves by their linguistic markers. Conclusion-without-application is the flagged defect.

const MARKERS = {
  issue: /\b(issue|the question is|whether|at issue|legal question)\b/i,
  rule: /\b(rule|statute|principle|the law (?:is|provides|states)|governed by|doctrine|elements? (?:of|are))\b/i,
  application: /\b(apply|applying|applies|here[,]|in this case|on these facts|element[- ]by[- ]element|maps? to|because the facts|mapping)\b/i,
  conclusion: /\b(conclu|therefore|holding|the court (?:would|likely)|it follows that|thus the|liable|not liable|breach(?:es|ed)?|entitled to)\b/i,
};

export function iracPresence(text) {
  const t = String(text ?? '');
  const has = {};
  for (const [k, re] of Object.entries(MARKERS)) has[k] = re.test(t);
  return has;
}

// Scan a law lesson: gather all narration/board text, detect which IRAC moves appear.
// Flag a lesson that draws a CONCLUSION without any APPLICATION language — the cardinal sin.
export function iracViolations(payload, { domain = null } = {}) {
  if (domain !== 'law') return [];
  const strings = [];
  for (const scene of payload?.scenes ?? []) {
    const walk = (v) => {
      if (typeof v === 'string') strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    for (const o of scene.objects ?? []) walk(o.content);
    for (const vl of scene.voiceLines ?? []) strings.push(vl.text);
  }
  const all = strings.join(' \n ');
  const has = iracPresence(all);
  const out = [];
  // the defect that matters: a legal conclusion asserted with no application step anywhere
  if (has.conclusion && has.rule && !has.application) {
    out.push({ sceneId: null, rule: 'irac-no-application', detail: 'the lesson states a rule and reaches a legal conclusion but never APPLIES the rule element-by-element to the facts (the IRAC application step is missing) — add the application before the conclusion' });
  }
  return out;
}
