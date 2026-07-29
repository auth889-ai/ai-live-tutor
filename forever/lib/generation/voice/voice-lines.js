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
  // ANTI-STUFFING FLOOR (audit: keywords can trick keyword checks; 220 words of repetition
  // can trick length checks): lexical DIVERSITY is hard to fake — narration built from
  // repeated phrases or recycled sentences has few distinct 4-word shingles relative to its
  // length. Real teaching (every fixture and live lesson measured) sits far above 0.55.
  const words = (lines ?? []).map((l) => String(l.text ?? '').toLowerCase().replace(/[^a-z0-9']+/g, ' ')).join(' ').split(/\s+/).filter(Boolean);
  if (words.length >= 60) {
    const shingles = new Set();
    for (let i = 0; i + 4 <= words.length; i += 1) shingles.add(words.slice(i, i + 4).join(' '));
    const diversity = shingles.size / Math.max(1, words.length - 3);
    if (diversity < 0.55) {
      throw new Error(`narration repeats itself (phrase diversity ${(diversity * 100).toFixed(0)}% — floor 55%): rewrite with DISTINCT sentences that each add one new idea; repeated phrases and filler do not teach`);
    }
  }

  const spoken = tokensOfText((lines ?? []).map((l) => l.text).join(' '));
  for (const object of (objects ?? []).filter((o) => o.renderHint === 'image')) {
    const marks = (object.content?.annotations ?? []).filter((a) => a.text?.trim());
    if (marks.length < 2) continue;
    const named = marks.filter((a) => {
      const t = [...tokensOfText(a.text)];
      return t.length === 0 || t.some((token) => spoken.has(token));
    });
    // FULL-EXPLANATION FLOOR (user law 2026-07-27: every part fully explained, never
    // shortly): beyond NAMING the parts, the figure must carry real narration WEIGHT —
    // at least ~2 spoken lines per mark bound to this object (the two-lines-per-mark
    // contract, count-enforced so synonyms can't dodge it).
    const figureLines = (lines ?? []).filter((l) => l.targetObjectId === object.id).length;
    const weightFloor = Math.max(4, marks.length * 2 - 1);
    if (figureLines < weightFloor) {
      throw new Error(`the figure ${object.id} has ${marks.length} marked parts but only ${figureLines} narration lines bound to it — a fully-taught figure needs ~2 lines per part (${weightFloor}+): for EACH mark say what it IS, then WHY it matters and how it connects`);
    }
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

const topTerms = (sourceText, limit) => {
  const counts = new Map();
  for (const w of String(sourceText ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')) {
    if (w.length < 5 || STOP.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
};
const spokenSetOf = (lines) => new Set(String((lines ?? []).map((l) => l.text).join(' ')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' '));

export function keytermCoverage(lines, sourceText) {
  const top = topTerms(sourceText, 8);
  if (top.length < 3) return { ratio: 1, missing: [] }; // too little source text to judge
  const spoken = spokenSetOf(lines);
  const missing = top.filter((w) => !spoken.has(w));
  return { ratio: (top.length - missing.length) / top.length, missing };
}

// PER-CHUNK coverage (audit: "chunk assigned to a scene ≠ concepts explained"): the global
// check above concatenates all focused chunks, so a scene that teaches chunk A richly and
// SKIPS chunk B still passes — chunk B's vocabulary is simply diluted out of the combined
// top terms. Judge each chunk on ITS OWN dominant terms instead (top-5, chunks being much
// smaller than a whole scene's source). Same guard: a chunk too thin to yield 3 terms is
// not judged (ratio 1), never failed on noise.
export function perChunkKeytermCoverage(lines, chunks) {
  const spoken = spokenSetOf(lines);
  return (chunks ?? []).map((chunk) => {
    const top = topTerms(chunk?.text, 5);
    if (top.length < 3) return { chunkId: chunk?.id, ratio: 1, missing: [] }; // too little chunk text to judge
    const missing = top.filter((w) => !spoken.has(w));
    return { chunkId: chunk?.id, ratio: (top.length - missing.length) / top.length, missing };
  });
}

// TYPED TEACHING CONTRACT (replaces regex-guessing with typed evidence): instead of
// hoping varied filler happens to match the teaching-move regexes above, the Voice Writer
// DECLARES which lines carry which move ({type, voiceLineIds, chunkId}) and this validator
// checks the structure deterministically — no model calls. A cited line must actually
// carry its move's evidence (a concrete value for an example, a causal marker for a
// mechanism), one line cannot be everything, and every citation must resolve. Returns an
// array of violation strings (empty = pass) so the repair retry is told exactly what to fix.
const MOVE_TYPES = new Set(['definition', 'concrete_example', 'mechanism', 'worked_step', 'learner_check']);
const CORE_MOVES = ['definition', 'concrete_example', 'mechanism'];
// ROLE-AWARE REQUIRED SET (external audit 2026-07-28: hard rules must be scene-role-specific
// — same stance as validateVoiceDepth's SHORT_ROLES): forcing every scene into the full
// definition+example+mechanism triad made recap RE-DEFINE instead of making the learner
// retrieve, and pushed practice toward leaking the very explanation the learner is supposed
// to produce. Each short-form role owes its own floor instead; every declared move still
// passes the full per-move evidence rules below — only the REQUIRED set is role-shaped.
// Unknown or absent roles keep the strict triad (fail closed).
const REQUIRED_MOVES_BY_ROLE = {
  recap: ['learner_check'], // retrieval first — the learner recalls, the tutor confirms
  practice: ['learner_check'], // the question IS the scene; the full teach-back would leak it
  checkpoint: ['learner_check'],
  motivate: ['concrete_example'], // the hook is concrete; definitions come in later scenes
  qa: [], // reactive — the declared moves are shaped by the question asked
};
const ROLE_MOVE_REASON = {
  learner_check: 'the prompt that makes the learner retrieve or attempt it themselves',
  concrete_example: 'the concrete hook built from real values',
};
// Quoted-value detection deliberately excludes the straight apostrophe — contractions
// ("let's", "that's") would false-positive it; double/curly quotes and backticks are safe.
const CONCRETE_MARKER = /\d|["“”`]|\b(for example|suppose|say we|imagine)\b/i;
const CAUSAL_MARKER = /\b(because|so that|therefore|which means|leads to|that's why)\b/i;
// A definition must actually DEFINE — the copular/defining frame, not just mention a term.
const DEFINING_PATTERN = /\b(is a|is an|is the|means|refers to|defined as)\b/i;

// SEMANTIC FLOOR (audit: "a number alone in generic prose passes the evidence rules"):
// the same content-word machinery as keytermCoverage (>=5 chars, non-stopword), applied
// per MOVE — a move's cited lines must speak at least one content word OF THE CHUNK the
// move claims to teach. Deterministic, no LLM; failures name the chunk and its candidate
// terms so the repair retry knows exactly which vocabulary to weave in.
const contentWordsOf = (text) => new Set(
  String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter((w) => w.length >= 5 && !STOP.has(w)),
);

// BOARD-DESCRIPTION LAW (external audit 2026-07-28: "Photosynthesis is a triangle containing
// chlorophyll beside sunlight" passed every rule — it carries the defining frame AND the
// chunk's own words, yet defines nothing). The tell is that the sentence describes the
// DRAWING instead of the material: the thing photosynthesis is said to BE is a rendering
// primitive. Two affirmative violations below, both SELF-CALIBRATED against the source —
// a word is only "board vocabulary" when the source never uses it, so a geometry lesson
// may freely say "a triangle is a polygon" and a diagram walkthrough may name its arrows.
// Deliberately narrow: only unambiguous drawing primitives, never words that carry real
// meaning in some subject (graph, node, line, cell, row, column, block, list, table…).
const BOARD_PRIMITIVES = new Set([
  'triangle', 'triangles', 'rectangle', 'rectangles', 'square', 'squares', 'circle', 'circles',
  'oval', 'ovals', 'ellipse', 'ellipses', 'box', 'boxes', 'arrow', 'arrows', 'shape', 'shapes',
  'diagram', 'diagrams', 'panel', 'panels', 'slide', 'slides', 'callout', 'callouts',
  'bubble', 'bubbles', 'icon', 'icons', 'picture', 'pictures', 'image', 'images',
  'figure', 'figures', 'chart', 'charts', 'graphic', 'graphics', 'drawing', 'drawings',
  'sketch', 'sketches', 'thumbnail', 'thumbnails', 'sticker', 'stickers', 'object', 'objects',
]);
const wordsOf = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
// Light suffix stripping so inflections of one word agree ("flows"/"flowing" -> "flow",
// "stores"/"stored" -> "stor"). Not linguistics — just enough that an honest paraphrase of
// a sentence is recognised as coming from it. Never shortens below 3 chars.
const stemOf = (w) => {
  const cut = String(w).replace(/(ing|ed|es|s)$/, '').replace(/e$/, '');
  return cut.length >= 3 ? cut : String(w);
};
// A drawing word the SOURCE never uses — board vocabulary for this lesson, not material.
const foreignBoardWords = (text, sourceWords) => wordsOf(text).filter((w) => BOARD_PRIMITIVES.has(w) && !sourceWords.has(w));

export function validateTeachingContract(moves, lines, chunks, { role = '' } = {}) {
  const violations = [];
  const lineById = new Map((lines ?? []).map((l) => [String(l.id), String(l.text ?? '')]));
  const chunkIds = (chunks ?? []).length ? new Set(chunks.map((c) => String(c?.id))) : null;
  const chunkById = new Map((chunks ?? []).map((c) => [String(c?.id), c]));
  const typesByLine = new Map(); // lineId -> Set of move types citing it

  const present = new Set((moves ?? []).map((m) => m?.type));
  const required = Object.hasOwn(REQUIRED_MOVES_BY_ROLE, role) ? REQUIRED_MOVES_BY_ROLE[role] : CORE_MOVES;
  for (const req of required) {
    if (!present.has(req)) {
      violations.push(required === CORE_MOVES
        ? `no ${req} move declared — a taught scene needs at least a definition, a concrete_example, and a mechanism`
        : `no ${req} move declared — a ${role} scene must carry ${ROLE_MOVE_REASON[req] ?? `its ${req}`}`);
    }
  }

  (moves ?? []).forEach((move, index) => {
    const label = `teachingMoves[${index}] (${move?.type ?? 'untyped'})`;
    if (!MOVE_TYPES.has(move?.type)) {
      violations.push(`${label}: unknown move type — use definition|concrete_example|mechanism|worked_step|learner_check`);
    }
    const cited = (move?.voiceLineIds ?? []).map(String);
    if (cited.length === 0) {
      violations.push(`${label}: cites no voiceLineIds — every move must name the lines that carry it`);
    }
    const known = [];
    for (const id of cited) {
      if (!lineById.has(id)) {
        violations.push(`${label}: cites unknown voice line "${id}" — cite only ids from voiceLines`);
        continue;
      }
      known.push(id);
      if (MOVE_TYPES.has(move?.type)) {
        if (!typesByLine.has(id)) typesByLine.set(id, new Set());
        typesByLine.get(id).add(move.type);
      }
    }
    const citedText = known.map((id) => lineById.get(id)).join(' ');
    if (move?.type === 'concrete_example' && known.length > 0 && !CONCRETE_MARKER.test(citedText)) {
      violations.push(`${label}: cited lines carry no concrete value (a number, a quoted value, or "for example/suppose/say we/imagine") — a concrete example must show real values, not gesture at them`);
    }
    if (move?.type === 'mechanism' && known.length > 0 && !CAUSAL_MARKER.test(citedText)) {
      violations.push(`${label}: cited lines carry no cause-effect marker (because/so that/therefore/which means/leads to/that's why) — a mechanism must explain WHY, not restate WHAT`);
    }
    if (move?.type === 'definition' && known.length > 0 && !DEFINING_PATTERN.test(citedText)) {
      violations.push(`${label}: cited lines never actually DEFINE (no "is a/is an/is the/means/refers to/defined as") — a definition names the concept and says what it is in plain words`);
    }
    if (chunkIds && !chunkIds.has(String(move?.chunkId))) {
      violations.push(`${label}: chunkId "${move?.chunkId ?? 'none'}" is not one of this scene's focused chunks (${[...chunkIds].join(', ')})`);
    }

    // SEMANTIC FLOOR — evidence must be ABOUT the cited chunk, not generic prose that
    // happens to carry a digit or a "because". Judged only when the cited chunk resolves
    // and has judgeable vocabulary (same too-thin-to-judge stance as keytermCoverage).
    const chunk = chunkById.get(String(move?.chunkId));
    const chunkWords = chunk ? contentWordsOf(chunk.text) : null;
    if (known.length > 0 && chunkWords?.size) {
      const spokenCited = contentWordsOf(citedText);
      const speaksChunk = [...chunkWords].some((w) => spokenCited.has(w));
      const candidates = topTerms(chunk.text, 6);
      const named = candidates.length ? candidates : [...chunkWords].slice(0, 6);
      if (move?.type === 'concrete_example' && !speaksChunk) {
        violations.push(`${label}: cited lines never speak the cited chunk's own content — a real example is built FROM ${move.chunkId}'s material; weave in one of its terms (e.g. ${named.join(', ')})`);
      }
      if (move?.type === 'definition' && !speaksChunk) {
        violations.push(`${label}: cited lines define without using any content word from ${move.chunkId} — define THIS chunk's concept using its own vocabulary (e.g. ${named.join(', ')})`);
      }
      if (move?.type === 'mechanism' && CAUSAL_MARKER.test(citedText)) {
        // The cause-effect SENTENCE itself must be about the chunk — a causal marker in
        // generic filler ("because reasons") is not a mechanism of this material.
        const causalOnChunk = citedText.split(/[.!?]+/)
          .filter((sentence) => CAUSAL_MARKER.test(sentence))
          .some((sentence) => [...contentWordsOf(sentence)].some((w) => chunkWords.has(w)));
        if (!causalOnChunk) {
          violations.push(`${label}: the cause-effect sentence never mentions ${move.chunkId}'s own content — explain WHY using the chunk's terms (e.g. ${named.join(', ')})`);
        }
      }

      // BOARD-DESCRIPTION LAW, rule A — a definition may not classify the concept as a
      // DRAWING PRIMITIVE. "X is a triangle…" says what the picture looks like, not what X
      // is. Only the genus is judged (the 3 words after the defining frame), and only words
      // the source itself never uses: a geometry chunk that talks about triangles keeps its
      // right to define one.
      const sourceWords = new Set(wordsOf(chunk.text));
      if (move?.type === 'definition') {
        const frame = citedText.match(DEFINING_PATTERN);
        if (frame) {
          const genus = citedText.slice(frame.index + frame[0].length);
          const drawn = foreignBoardWords(wordsOf(genus).slice(0, 3).join(' '), sourceWords);
          if (drawn.length > 0) {
            violations.push(`${label}: this "definition" says the concept IS a ${drawn[0]} — that describes the drawing, not the material. Define what it IS in the source's own terms (e.g. ${named.join(', ')}), then point at the ${drawn[0]} separately`);
          }
        }
      }
      // BOARD-DESCRIPTION LAW, rule B — an example's numbers must count the MATERIAL, not
      // the picture. "5 photosynthesis objects carry chlorophyll" wears a real number and
      // real source words, yet quantifies board furniture. A number is rejected when the
      // noun it counts (within 2 words) is a drawing primitive the source never uses.
      if (move?.type === 'concrete_example') {
        const toks = wordsOf(citedText);
        const counted = [];
        toks.forEach((tok, i) => {
          if (!/^\d+$/.test(tok)) return;
          for (const next of foreignBoardWords(toks.slice(i + 1, i + 3).join(' '), sourceWords)) {
            counted.push(`${tok} ${next}`);
          }
        });
        if (counted.length > 0) {
          violations.push(`${label}: the example counts the BOARD, not the material ("${counted[0]}") — a concrete example uses real quantities from ${move.chunkId} (e.g. ${named.join(', ')}), never a tally of shapes on screen`);
        }
      }

      // BOARD-DESCRIPTION LAW, rule C — THE MECHANISM'S PROPOSITION (2026-07-29). Rules A
      // and B judge sentences, and a sentence is exactly where board vocabulary is
      // LEGITIMATE: pointing is how a teacher teaches ("the arrow shows heat flowing in").
      // That is why every sentence-level rule tried against a spatial mechanism
      // ("...because the sunlight arrow points at it") false-positived on real figure
      // teaching. The fix is to move the judgment off the sentence and onto the PROPOSITION
      // the move claims to teach: a mechanism now declares {cause, effect}, and a
      // proposition never needs drawing words unless the source itself uses them. The
      // deixis stays in the sentence where it belongs; the claim must be about the world.
      if (move?.type === 'mechanism') {
        const cause = String(move?.cause ?? '').trim();
        const effect = String(move?.effect ?? '').trim();
        if (!cause || !effect) {
          // Fail closed, exactly like an omitted contract: silence must not be a way out.
          violations.push(`${label}: declares no cause/effect — state the CAUSE and the EFFECT as two short propositions taken from your own cited sentence, written about the material (not about the drawing)`);
        } else {
          // C1 GROUNDED: the proposition must be recoverable from the sentence it claims to
          // come from — otherwise a writer can narrate board furniture and declare
          // something prettier. Inflection-tolerant on purpose: restating a sentence
          // ALWAYS changes verb forms ("the arrow shows energy flowing" -> "energy flows"),
          // and rejecting that would punish exactly the honest paraphrase this rule wants.
          const saidStems = new Set([...contentWordsOf(citedText)].map(stemOf));
          const ungrounded = [...contentWordsOf(`${cause} ${effect}`)].filter((w) => !saidStems.has(stemOf(w)));
          if (ungrounded.length > 0) {
            violations.push(`${label}: the declared cause/effect says "${ungrounded.join(', ')}", which the cited line never says — declare the mechanism your sentence actually states, or rewrite the sentence to state it`);
          }
          // C2 MATERIAL: the proposition may not be built out of drawing words the source
          // never uses. Same self-calibration as rules A and B — a diagram-conventions
          // lesson whose source really is about arrows keeps every one of them.
          const drawnCause = foreignBoardWords(cause, sourceWords);
          const drawnEffect = foreignBoardWords(effect, sourceWords);
          if (drawnCause.length > 0 || drawnEffect.length > 0) {
            const word = drawnCause[0] ?? drawnEffect[0];
            const half = drawnCause.length > 0 ? 'cause' : 'effect';
            violations.push(`${label}: the ${half} you state is about the DRAWING ("${word}"), not the material — point at the ${word} in your sentence if it helps, but the mechanism itself must explain what ${move.chunkId} says happens (e.g. ${named.join(', ')})`);
          }
          // C3 ABOUT THE CHUNK: sharper than the sentence-level check above, because the
          // pointing words are gone — what remains must be this chunk's own material.
          if (![...contentWordsOf(`${cause} ${effect}`)].some((w) => chunkWords.has(w))) {
            violations.push(`${label}: the declared cause/effect never speaks ${move.chunkId}'s own content — explain WHY using the chunk's terms (e.g. ${named.join(', ')})`);
          }
        }
      }
    }
  });

  for (const [lineId, types] of typesByLine) {
    if (types.size > 2) {
      violations.push(`voice line ${lineId} is cited by ${types.size} different move types (${[...types].join(', ')}) — one line cannot carry more than 2 moves; spread the teaching across distinct sentences`);
    }
  }
  return violations;
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
