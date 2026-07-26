import { validateSourceRef } from '../../source-pack/refs/source-refs.js';

// SPOKEN-ID SCRUB (live-caught 2026-07-24 certification lesson: the tutor said "the
// normalized schema from fig_004" OUT LOUD — backstage ids are for agents, never for
// students). Mechanical repair, same class as normalizeVoiceTargets: internal id tokens
// become natural phrases; anything semantic stays untouched.
const SPOKEN_ID = /\b(?:from |in |see )?\b(fig|figure|asset|page|chunk|obj|vl|sc)_[a-z0-9]+\b/gi;

export function scrubSpokenInternalIds(lines) {
  return (lines ?? []).map((line) => {
    if (typeof line?.text !== 'string' || !SPOKEN_ID.test(line.text)) return line;
    SPOKEN_ID.lastIndex = 0;
    const text = line.text.replace(SPOKEN_ID, (match, kind) => {
      const k = kind.toLowerCase();
      if (k === 'chunk') return 'the source material';
      if (k === 'fig' || k === 'figure' || k === 'asset' || k === 'page') return 'this figure';
      return 'the board';
    }).replace(/\s{2,}/g, ' ');
    return { ...line, text };
  });
}

// DEPTH FLOOR — a BLOCKING validator, not a prompt request (external audit 2026-07-26:
// "thin scenes fail the depth floor" was only true in the after-the-fact kernel; the
// generation path accepted 5 short lines). Deterministic and role-aware; failures throw
// with a repairable reason so the Voice Writer's retry loop fixes exactly what's named.
// Also enforces MARK COVERAGE: an image object's named marks must actually be narrated —
// pointing at a part the voice never mentions is slide-waving, not teaching.
const SHORT_ROLES = new Set(['recap', 'checkpoint', 'practice', 'qa']);
const tokensOfText = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t.length >= 4));

export function validateVoiceDepth(lines, objects, { role = '' } = {}) {
  const narratable = (objects ?? []).filter((o) => o.renderHint !== 'algorithm' && !o.decorative);
  const hasFigure = (objects ?? []).some((o) => o.renderHint === 'image');
  // Bypass is NARROW (external audit: one-object scenes escaped the floor): only true
  // short-form roles, or single-object scenes WITHOUT a figure — a figure scene always
  // owes part-by-part depth, and its mark-coverage check below must always run.
  if (SHORT_ROLES.has(role) && !hasFigure) return lines;
  // Floors raised 2026-07-26 (user: "explanation is too short" — best-teacher depth means
  // a lecture segment, not a caption): 8 lines / 220 words BLOCK; the prompt band is
  // 450-900 words, so these floors only catch genuine summaries, not style variance.
  const totalWords = (lines ?? []).reduce((n, l) => n + String(l.text ?? '').split(/\s+/).filter(Boolean).length, 0);
  if ((lines ?? []).length < 8) {
    throw new Error(`only ${lines.length} voice lines — a taught scene needs at least 8 (write 6-10 sentences per board object, one idea each)`);
  }
  if (totalWords < 220) {
    throw new Error(`only ${totalWords} spoken words — a taught scene explains at lecture depth (concrete example, why it matters, the walk-through, the mistake to avoid); it never summarizes`);
  }
  // TEACHING-MOVES FLOOR (audit round 4: 220 words of meaningless filler passed — length
  // is not teaching). The five moves of the explanation spine, detected deterministically;
  // a taught scene must show at least 3. Filler shows none; any honest lesson segment
  // (definition + example + why, or example + check + trap) clears it. Research ranked
  // these markers low-FP (definition/example) to moderate (causal) — 3-of-5 keeps the
  // combined false-positive risk near zero while killing move-free filler.
  const all = (lines ?? []).map((l) => String(l.text ?? '')).join(' ');
  const moves = {
    definition: /\b(is a|is an|is the|refers to|means that|we call|known as|defined as)\b/i.test(all),
    example: /\b(for example|for instance|imagine|suppose|say you|let's say|consider a|picture a)\b/i.test(all) || /\b\d{2,}\b/.test(all),
    causal: /\b(because|so that|therefore|which means|that's why|as a result|this is why|the reason)\b/i.test(all),
    checkin: (lines ?? []).some((l) => /\?\s*$/.test(String(l.text ?? '').trim())),
    misconception: /\b(mistake|misconception|tempting|careful|trap|gotcha|watch out|wrongly|common error)\b/i.test(all),
  };
  const shown = Object.entries(moves).filter(([, v]) => v).map(([k]) => k);
  if (shown.length < 3) {
    const missing = Object.keys(moves).filter((k) => !moves[k]);
    throw new Error(`narration shows only ${shown.length}/5 teaching moves (${shown.join(', ') || 'none'}) — a taught scene needs at least 3 of: a DEFINITION in plain words, a CONCRETE example, a BECAUSE/why explanation, a question the student answers, the common mistake. Missing: ${missing.join(', ')}`);
  }
  const spoken = tokensOfText((lines ?? []).map((l) => l.text).join(' '));
  for (const object of (objects ?? []).filter((o) => o.renderHint === 'image')) {
    const marks = (object.content?.annotations ?? []).filter((a) => a.text?.trim());
    if (marks.length < 2) continue;
    const named = marks.filter((a) => {
      const t = [...tokensOfText(a.text)];
      return t.length === 0 || t.some((token) => spoken.has(token));
    });
    const nameFloor = marks.length <= 3 ? marks.length : Math.ceil(marks.length * 0.8);
    if (named.length < nameFloor) {
      throw new Error(`the figure ${object.id} carries ${marks.length} teaching marks but the narration names only ${named.length} of them — narrate the marked parts IN ORDER (what each is, what it does, how it connects)`);
    }
  }
  return lines;
}

// KEYTERM COVERAGE ("explained, not just cited" — research: the one deterministic check
// reliable enough to gate on): the scene's source text's dominant content words must
// actually be SPOKEN. Blocks at near-zero coverage (the scene talks about something else);
// the repair message names the missing terms so the retry fixes exactly that.
const STOP = new Set(['about', 'after', 'before', 'between', 'could', 'every', 'first', 'other', 'their', 'there', 'these', 'thing', 'those', 'through', 'under', 'water', 'where', 'which', 'while', 'would', 'should', 'because', 'table', 'value', 'values', 'using', 'given', 'shown', 'figure']);

export function keytermCoverage(lines, sourceText) {
  const counts = new Map();
  for (const w of String(sourceText ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')) {
    if (w.length < 5 || STOP.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);
  if (top.length < 3) return { ratio: 1, missing: [] }; // too little source text to judge
  const spoken = new Set(String((lines ?? []).map((l) => l.text).join(' ')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' '));
  const missing = top.filter((w) => !spoken.has(w));
  return { ratio: (top.length - missing.length) / top.length, missing };
}

export function validateVoiceLine(line) {
  if (!line.id?.trim()) throw new Error('voiceLine.id is required');
  const context = `voiceLine ${line.id}`;
  if (!line.text?.trim()) throw new Error(`${context}.text is required`);
  if (!line.targetObjectId?.trim()) {
    throw new Error(`${context} must be bound to a board object via targetObjectId — narration always points at something`);
  }
  // Optional sub-element the tutor points at WHILE saying this line (graph node id, code
  // line number, trace row, image bbox) — enables "highlight and explain simultaneously".
  if (line.focusRef !== undefined && !(typeof line.focusRef === 'string' || typeof line.focusRef === 'number')) {
    throw new Error(`${context}.focusRef must be a string or number (a sub-element id)`);
  }
  // Optional: for a traced diagram (dry run), the 0-based trace step THIS line narrates. Binds
  // the animation to the words — the marked node/pointer is guaranteed to match what is spoken.
  if (line.traceStep !== undefined && !(Number.isInteger(line.traceStep) && line.traceStep >= 0)) {
    throw new Error(`${context}.traceStep must be a non-negative integer (the 0-based trace step this line narrates)`);
  }
  if (line.sourceRef !== undefined) validateSourceRef(line.sourceRef, `${context}.sourceRef`);
  return line;
}

export function validateVoiceLines(lines, objects) {
  if (!lines?.length) throw new Error('At least one voice line is required');
  const objectIds = new Set((objects ?? []).map((object) => object.id));
  const ids = new Set();
  for (const line of lines) {
    validateVoiceLine(line);
    if (ids.has(line.id)) throw new Error(`Duplicate voice line id: ${line.id}`);
    ids.add(line.id);
    if (objects && !objectIds.has(line.targetObjectId)) {
      throw new Error(`voiceLine ${line.id} targets missing board object "${line.targetObjectId}" — valid object ids: ${[...objectIds].join(', ')}`);
    }
  }
  return lines;
}

// Deterministic repair for the most common Voice Writer slip (measured live 2026-07-08: a
// dry-run scene died because a line targeted tree node "n5" instead of the diagram that holds
// it): when targetObjectId matches no object but IS a sub-element (graph/diagram node id) of
// exactly ONE object, the intent is unambiguous — point at that object and keep the node as
// focusRef. Ambiguous or unknown targets are left for validation to reject loudly.
export function normalizeVoiceTargets(lines, objects) {
  const objectIds = new Set((objects ?? []).map((object) => object.id));
  const ownerOf = (elementId) => {
    const owners = (objects ?? []).filter((o) =>
      (o.content?.nodes ?? []).some((n) => String(n.id) === String(elementId)));
    return owners.length === 1 ? owners[0] : null;
  };
  return (lines ?? []).map((line) => {
    if (!line?.targetObjectId || objectIds.has(line.targetObjectId)) return line;
    const owner = ownerOf(line.targetObjectId);
    if (!owner) return line;
    return { ...line, targetObjectId: owner.id, focusRef: line.focusRef ?? line.targetObjectId };
  });
}

// Deterministic shape repair for focusRef (measured live 2026-07-13: a heat-wave scene died
// because a line pointed at TWO annotations — focusRef ["E1","E2"]). An array of refs means
// the FIRST one is spoken first; an object/empty shape carries no usable pointer and is
// dropped (focusRef is optional). Never invents a pointer, only unwraps or removes.
export function normalizeFocusRefs(lines) {
  return (lines ?? []).map((line) => {
    if (!line || line.focusRef === undefined) return line;
    const ref = line.focusRef;
    if (typeof ref === 'string' || typeof ref === 'number') return line;
    if (Array.isArray(ref)) {
      const first = ref.find((v) => typeof v === 'string' || typeof v === 'number');
      if (first !== undefined) return { ...line, focusRef: first };
    }
    const { focusRef, ...rest } = line;
    return rest;
  });
}
