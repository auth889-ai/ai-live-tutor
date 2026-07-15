// BOARD COERCION — deterministic shape normalization between the Board Director's draft and
// contract validation. Measured 2026-07-11: 62% of all dropped scenes died on MECHANICAL
// shape slips (a comparison row with 2 values where columns demand 3; cell text stuffed under
// arbitrary keys; a renderHint synonym) — content that was fine, shaped slightly wrong, then
// dropped after one failed repair round. Normalizing shape is not inventing content: nothing
// here adds a fact, it only moves/pads/renames what the model already wrote. Anything beyond
// these safe moves still goes to the LLM repair round and, failing that, drops loudly.

import { RENDER_HINTS } from '../../../board/objects/board-objects.js';
import { LAYOUT_REGIONS } from '../../../board/layout/layout-regions.js';
import { MERMAID_KEYWORDS } from '../../../board/diagrams/diagram-content.js';

// Scene roles whose whole point is invented teaching devices (hooks, analogies, recaps,
// practice questions, conceptual visualizations) — an unsourced object here is a teaching
// device the model forgot to label, not a fact to fabricate proof for. Everywhere else
// (worked_example, dry_run, concept scenes teaching source facts) a missing sourceRef
// still fails loudly. Live-extended 2026-07-13: practice/edge_cases/visualize scenes died
// for unsourced INVENTED devices ("tradeoff_question", "queue_visualization").
const TEACHING_DEVICE_ROLES = new Set(['motivate', 'intuition', 'hook', 'recap', 'practice', 'edge_cases', 'visualize']);

// Common renderHint synonyms the model reaches for — mapped to the legal vocabulary.
const HINT_ALIASES = Object.freeze({
  flowchart: 'diagram', graph: 'diagram', xychart: 'chart', sequence: 'diagram', mermaid: 'diagram',
  bullets: 'list', bullet_list: 'list', bulletpoints: 'list',
  formula: 'math', equation: 'math', katex: 'math', latex: 'math',
  note: 'callout', tip: 'callout', warning: 'callout', insight: 'callout',
  snippet: 'code', codeblock: 'code',
  mcq: 'quiz', question: 'quiz',
  trace_table: 'table', comparison: 'table',
});

const isScalar = (v) => v === null || ['number', 'string', 'boolean'].includes(typeof v);
const cellText = (v) => (v === null || v === undefined ? '' : isScalar(v) ? String(v) : JSON.stringify(v));

// Widen a chart axis just enough to cover its own series data (modest overshoot only).
function extendAxis(axis, values) {
  if (!axis || !Number.isFinite(axis.min) || !Number.isFinite(axis.max) || axis.min >= axis.max || values.length === 0) return axis;
  const span = axis.max - axis.min;
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  if (dataMin < axis.min - 2 * span || dataMax > axis.max + 2 * span) return axis; // wrong data -> repair
  return {
    ...axis,
    min: Math.min(axis.min, dataMin),
    max: Math.max(axis.max, dataMax),
  };
}

export function coerceBoardObjects(objects, { layout = null, brief = null, chunkIds = [] } = {}) {
  if (!Array.isArray(objects)) return objects;
  const knownChunks = new Set(chunkIds);
  return objects.filter((o) => o && typeof o === 'object').map((object) => {
    const out = { ...object };

    // The model INVENTS descriptive chunk ids ("ice_cream_demand_supply_example") instead
    // of copying the given ones (live v9: killed 4 objects). With exactly ONE chunk in
    // scope the citation intent is unambiguous — repoint it. Multi-chunk packs keep the
    // loud failure (guessing a citation would fabricate provenance).
    if (out.sourceRef && typeof out.sourceRef === 'object' && knownChunks.size === 1
      && !knownChunks.has(out.sourceRef.chunkId)) {
      out.sourceRef = { ...out.sourceRef, chunkId: [...knownChunks][0] };
    }

    // renderHint synonyms -> legal hints (only when the original is NOT already legal).
    if (typeof out.renderHint === 'string' && !RENDER_HINTS.includes(out.renderHint)) {
      const alias = HINT_ALIASES[out.renderHint.toLowerCase().trim()];
      if (alias) out.renderHint = alias;
    }

    // sourceRef written as a bare chunk id string is the object shape mislabeled —
    // same citation, wrong wrapper (live v8: killed 3 objects across 2 scenes).
    if (typeof out.sourceRef === 'string' && out.sourceRef.trim()) {
      out.sourceRef = { chunkId: out.sourceRef.trim() };
    }

    // A "diagram" whose content is axes+series IS a chart the model mislabeled (live v8:
    // a supply-curve shift died as diagramType undefined) — route it to the chart contract.
    if (out.renderHint === 'diagram' && out.content && typeof out.content === 'object'
      && Array.isArray(out.content.series) && out.content.xAxis && out.content.yAxis) {
      out.renderHint = 'chart';
    }

    // lineNumber is 0-indexed; models think 1-indexed and write lineNumber 10 into a 10-line
    // region (measured: killed a recap scene). Clamping into range moves nothing but the slot.
    const maxLines = layout ? LAYOUT_REGIONS[layout]?.[out.region]?.maxLines : undefined;
    if (Number.isInteger(out.lineNumber) && Number.isInteger(maxLines)) {
      out.lineNumber = Math.min(Math.max(out.lineNumber, 0), maxLines - 1);
    }

    // An unsourced object in a teaching-device scene is an unlabeled analogy — label it
    // (grounding:"analogy") rather than dropping the scene. Never invents a citation.
    if (!out.sourceRef && out.decorative !== true && out.grounding === undefined
      && TEACHING_DEVICE_ROLES.has(brief?.pedagogicalRole)) {
      out.grounding = 'analogy';
    }

    // An unsourced MANIPULABLE is a teaching device by nature — its curve is computed by the
    // ENGINE's whitelisted formula, so the number on screen is self-verifying; the sourceRef
    // rule exists for facts a model asserts, not math the engine performs (live-caught: the
    // Math build's tangent-line explorer died for a missing sourceRef in a worked_example
    // scene, which TEACHING_DEVICE_ROLES does not cover).
    if (out.renderHint === 'manipulable' && !out.sourceRef && out.decorative !== true
      && out.grounding === undefined) {
      out.grounding = 'analogy';
    }

    // A quiz whose fields unambiguously declare its kind but forgot the tag falls through to
    // the MCQ validator and dies "needs at least 2 choices" (live-caught: the Math build's
    // practice quiz was descriptive-shaped, kind-less, and its death killed the whole scene).
    // The shape IS the intent — stamp it. Never guesses between kinds: both patterns present
    // leaves the object untouched for the loud failure.
    if (out.renderHint === 'quiz' && out.content && typeof out.content === 'object' && !out.content.kind) {
      const looksDescriptive = typeof out.content.scenario === 'string' && Array.isArray(out.content.rubricPoints);
      const looksTeachBack = typeof out.content.audience === 'string' && Array.isArray(out.content.dimensions);
      if (looksDescriptive && !looksTeachBack) out.content = { ...out.content, kind: 'descriptive' };
      if (looksTeachBack && !looksDescriptive) out.content = { ...out.content, kind: 'teach_back' };
    }

    // A scene TITLE/heading is structure, not a factual claim — an unsourced one is
    // decorative, not a dropped scene (live-caught twice: coder-plus omits sourceRef on
    // titles, and writes objectType "scene_title"/"title" as freely as "text"). Matched by
    // id OR objectType naming itself a title. The Grounding Auditor still reviews every object.
    const titleish = /(^|_)(title|heading)($|_)/i;
    if (!out.sourceRef && out.decorative !== true && out.grounding === undefined
      && (titleish.test(String(out.id ?? '')) || titleish.test(String(out.objectType ?? '')))
      && (out.renderHint === 'text' || out.renderHint === undefined || String(out.objectType ?? '').includes('title'))) {
      out.decorative = true;
    }

    const content = out.content;
    if (!content || typeof content !== 'object') return out;

    // Mermaid grammar written with its KEYWORD as the diagramType ({diagramType:"xychart",
    // code:"xychart-beta…"}) is the mermaid shape mislabeled — same content, wrong tag
    // (live-caught: killed 5 of 9 scenes in one build). Only when real code is present;
    // a structured chart without code still goes to LLM repair.
    if (typeof content.diagramType === 'string' && MERMAID_KEYWORDS.includes(content.diagramType)
      && typeof content.code === 'string' && content.code.trim()) {
      out.content = { ...content, diagramType: 'mermaid' };
    }

    // CHART AXES AUTO-EXTEND: a curve point just past the declared axis (live: [350, 0] on a
    // 0–300 x-axis) is an axis mis-sized for the model's own data — widening the WINDOW is
    // presentation, not data invention. Only for modest overshoot (≤2x the declared span);
    // a wildly out-of-range point means wrong DATA, which must go to repair, not be hidden.
    if (out.renderHint === 'chart' && Array.isArray(content.series)) {
      const xs = [];
      const ys = [];
      for (const s of content.series) {
        for (const p of Array.isArray(s?.points) ? s.points : []) {
          if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) { xs.push(p[0]); ys.push(p[1]); }
        }
      }
      out.content = {
        ...out.content,
        xAxis: extendAxis(content.xAxis, xs),
        yAxis: extendAxis(content.yAxis, ys),
      };
    }

    // Tabular rows (comparison/trace/table): the label column is implicit and every row must
    // carry exactly one value per column. Fix the measured slips:
    //   1. cell text stuffed under arbitrary keys instead of "values" -> gather them in order
    //   2. EXTRA values -> trim. Short rows are LEFT SHORT: padding with "" fed the
    //      empty-cell gate and deterministically killed the object (live v8 death loop);
    //      the arity error message is actionable, so element repair fills real content.
    if (Array.isArray(content.columns) && Array.isArray(content.rows)) {
      const expected = content.columns.length;
      out.content = {
        ...content,
        // Object headers ({name}/{label}) are the string mislabeled — unwrap them
        // (live-caught: they crashed the player page as duplicate React keys).
        columns: content.columns.map((col) => (col && typeof col === 'object'
          ? String(col.label ?? col.name ?? col.title ?? col.text ?? JSON.stringify(col))
          : String(col ?? ''))),
        rows: content.rows.filter((r) => r && typeof r === 'object').map((row) => {
          const r = { ...row };
          if (typeof r.label !== 'string') {
            const label = r.label ?? r.name ?? r.title;
            if (isScalar(label)) r.label = String(label);
          }
          if (!Array.isArray(r.values)) {
            // Seen in production AFTER the first coercion pass: values as an OBJECT of cells
            // ({"brute": "...", "graph": "..."}) — same content, wrong container.
            if (r.values && typeof r.values === 'object') {
              r.values = Object.values(r.values).filter(isScalar);
            } else {
              const gathered = Object.entries(r)
                .filter(([k, v]) => !['label', 'name', 'title'].includes(k) && isScalar(v))
                .map(([, v]) => v);
              if (gathered.length > 0) r.values = gathered;
            }
          }
          if (Array.isArray(r.values) && r.values.length > expected) {
            r.values = r.values.slice(0, expected);
          }
          if (Array.isArray(r.values)) r.values = r.values.map(cellText);
          for (const k of Object.keys(r)) if (!['label', 'values'].includes(k)) delete r[k];
          return r;
        }),
      };
    }

    // Lists: items must be strings — a model writing numbers or {text} objects meant the same list.
    if (Array.isArray(content.items)) {
      out.content = { ...out.content, items: content.items.map((item) => (isScalar(item) ? String(item) : cellText(item.text ?? item.label ?? item))) };
    }

    return out;
  });
}
