// Bayesian Knowledge Tracing — thin ESM adaptation of OATutor's BKT update, vendored at
// vendor/oatutor/src/models/BKT/BKT-brain.js (MIT, CAHL research lab). Provenance, upstream
// commit hash and the full concept map live in vendor/oatutor/SOURCE.md.
//
// Kept from upstream: the exact conditional-probability equations and their structure
// (posterior on mastery given the observation, then the learning transit). Changed: module
// surface only — named ESM exports, a pure update (returns a new model instead of mutating
// the argument, so callers can keep per-step mastery history), input validation, and default
// parameters (upstream keeps its per-skill params in the CC BY content repo, which is not
// vendored).

export const BKT_DEFAULTS = Object.freeze({
  probMastery: 0.3, // pInit — prior P(student already knows the skill)
  probTransit: 0.15, // pTransit — P(learn the skill at this opportunity)
  probGuess: 0.25, // pGuess — P(correct despite not knowing)
  probSlip: 0.1, // pSlip — P(incorrect despite knowing)
});

const PARAM_KEYS = Object.keys(BKT_DEFAULTS);

export function createBktModel(params = {}) {
  const model = { ...BKT_DEFAULTS };
  for (const key of PARAM_KEYS) {
    if (params[key] === undefined) continue;
    const v = params[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v >= 1) {
      throw new Error(`BKT ${key} must be a number strictly between 0 and 1, got ${v}`);
    }
    model[key] = v;
  }
  // Degenerate parameterizations (guess+slip >= 1) invert the evidence: a correct answer
  // would LOWER mastery. Reject at construction so every model is well-posed.
  if (model.probGuess + model.probSlip >= 1) {
    throw new Error('BKT needs probGuess + probSlip < 1 — otherwise observations lose their meaning');
  }
  return model;
}

// Upstream equations, kept verbatim in structure (BKT-brain.js `update(model, isCorrect)`):
//   correct:  P(L|obs) = pL(1-pS) / (pL(1-pS) + (1-pL)pG)
//   wrong:    P(L|obs) = pL*pS    / (pL*pS    + (1-pL)(1-pG))
//   then:     pL' = P(L|obs) + (1 - P(L|obs)) * pT
export function updateBkt(model, isCorrect) {
  let numerator;
  let masteryAndGuess;
  if (isCorrect) {
    numerator = model.probMastery * (1 - model.probSlip);
    masteryAndGuess = (1 - model.probMastery) * model.probGuess;
  } else {
    numerator = model.probMastery * model.probSlip;
    masteryAndGuess = (1 - model.probMastery) * (1 - model.probGuess);
  }

  const probMasteryGivenObservation = numerator / (numerator + masteryAndGuess);
  return {
    ...model,
    probMastery: probMasteryGivenObservation + (1 - probMasteryGivenObservation) * model.probTransit,
  };
}
