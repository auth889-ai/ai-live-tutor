// EARS REQUIREMENT CHECKER — the SRS field's equivalent of the number/quote gates. Mavin's
// Easy Approach to Requirements Syntax (Rolls-Royce; used by NASA, Airbus, Bosch) constrains
// a requirement to one of five patterns, each with a single testable "shall". A requirements
// lesson that shows a requirement NOT in EARS form is teaching the ambiguity it should be
// curing — so we detect it deterministically (zero tokens) and let repair rewrite it.
//
// A string is treated as a REQUIREMENT (and thus EARS-checkable) when it contains "shall" —
// the modal EARS mandates. Prose, questions, and analogies never say "shall", so they pass.

// The five EARS patterns, each recognized by its shape around the single "shall":
//   Ubiquitous:    The <system> shall <response>.
//   Event-driven:  When <trigger>, the <system> shall <response>.
//   State-driven:  While <state>, the <system> shall <response>.
//   Unwanted:      If <condition>, then the <system> shall <response>.
//   Optional:      Where <feature>, the <system> shall <response>.
const PATTERN_HEADS = /^\s*(when|while|if|where)\b/i;

export function isRequirementText(t) {
  return /\bshall\b/i.test(String(t ?? ''));
}

// Returns { ok, reason } — ok:true means the requirement is well-formed EARS.
export function checkEarsRequirement(text) {
  const t = String(text ?? '').trim();
  if (!isRequirementText(t)) return { ok: true, reason: 'not a requirement' };

  const shalls = (t.match(/\bshall\b/gi) ?? []).length;
  if (shalls !== 1) {
    return { ok: false, reason: `an EARS requirement has exactly one "shall" (found ${shalls}) — split compound requirements` };
  }
  // there must be a system/actor before "shall" and a response after it
  const [before, after] = t.split(/\bshall\b/i);
  if (!/\b(the|a|an|each|every|system|\w+)\s*$/i.test(before.trim()) || before.trim().length < 3) {
    return { ok: false, reason: 'no clear system/actor before "shall"' };
  }
  if (after.trim().replace(/[.;]/g, '').split(/\s+/).filter(Boolean).length < 2) {
    return { ok: false, reason: 'no testable response after "shall"' };
  }
  // conditional requirements (when/while/if/where) must actually name their trigger before a comma
  if (PATTERN_HEADS.test(t)) {
    const head = t.slice(0, t.search(/\bshall\b/i));
    if (!head.includes(',')) {
      return { ok: false, reason: 'a conditional requirement (when/while/if/where) needs a comma separating the trigger from the "the <system> shall" clause' };
    }
  }
  return { ok: true, reason: 'valid EARS' };
}

// Scan a lesson payload; return violations only for the srs domain (others don't mandate EARS).
export function earsViolations(payload, { domain = null } = {}) {
  if (domain !== 'srs') return [];
  const out = [];
  for (const scene of payload?.scenes ?? []) {
    const strings = [];
    for (const o of scene.objects ?? []) {
      const c = o.content;
      const walk = (v) => {
        if (typeof v === 'string') strings.push(v);
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
      };
      walk(c);
    }
    for (const vl of scene.voiceLines ?? []) strings.push(vl.text);
    for (const s of strings) {
      const r = checkEarsRequirement(s);
      if (!r.ok) out.push({ sceneId: scene.sceneId, rule: 'ears-malformed', detail: `"${String(s).slice(0, 70)}..." — ${r.reason}` });
    }
  }
  return out;
}
