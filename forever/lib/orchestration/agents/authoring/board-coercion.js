// BOARD COERCION — deterministic shape normalization between the Board Director's draft and
// contract validation. Measured 2026-07-11: 62% of all dropped scenes died on MECHANICAL
// shape slips (a comparison row with 2 values where columns demand 3; cell text stuffed under
// arbitrary keys; a renderHint synonym) — content that was fine, shaped slightly wrong, then
// dropped after one failed repair round. Normalizing shape is not inventing content: nothing
// here adds a fact, it only moves/pads/renames what the model already wrote. Anything beyond
// these safe moves still goes to the LLM repair round and, failing that, drops loudly.

import { RENDER_HINTS } from '../../../board/objects/board-objects.js';

// Common renderHint synonyms the model reaches for — mapped to the legal vocabulary.
const HINT_ALIASES = Object.freeze({
  flowchart: 'diagram', graph: 'diagram', chart: 'diagram', sequence: 'diagram', mermaid: 'diagram',
  bullets: 'list', bullet_list: 'list', bulletpoints: 'list',
  formula: 'math', equation: 'math', katex: 'math', latex: 'math',
  note: 'callout', tip: 'callout', warning: 'callout', insight: 'callout',
  snippet: 'code', codeblock: 'code',
  mcq: 'quiz', question: 'quiz',
  trace_table: 'table', comparison: 'table',
});

const isScalar = (v) => v === null || ['number', 'string', 'boolean'].includes(typeof v);
const cellText = (v) => (v === null || v === undefined ? '' : isScalar(v) ? String(v) : JSON.stringify(v));

export function coerceBoardObjects(objects) {
  if (!Array.isArray(objects)) return objects;
  return objects.filter((o) => o && typeof o === 'object').map((object) => {
    const out = { ...object };

    // renderHint synonyms -> legal hints (only when the original is NOT already legal).
    if (typeof out.renderHint === 'string' && !RENDER_HINTS.includes(out.renderHint)) {
      const alias = HINT_ALIASES[out.renderHint.toLowerCase().trim()];
      if (alias) out.renderHint = alias;
    }

    const content = out.content;
    if (!content || typeof content !== 'object') return out;

    // Tabular rows (comparison/trace/table): the label column is implicit and every row must
    // carry exactly one value per column. Fix the two measured slips:
    //   1. cell text stuffed under arbitrary keys instead of "values" -> gather them in order
    //   2. arity off by a little -> pad with '' / trim extras (never invent, never silently
    //      merge — an empty cell is visibly empty and the critics can still object to it)
    if (Array.isArray(content.columns) && Array.isArray(content.rows)) {
      const expected = content.columns.length;
      out.content = {
        ...content,
        rows: content.rows.filter((r) => r && typeof r === 'object').map((row) => {
          const r = { ...row };
          if (typeof r.label !== 'string') {
            const label = r.label ?? r.name ?? r.title;
            if (isScalar(label)) r.label = String(label);
          }
          if (!Array.isArray(r.values)) {
            const gathered = Object.entries(r)
              .filter(([k, v]) => !['label', 'name', 'title'].includes(k) && isScalar(v))
              .map(([, v]) => v);
            if (gathered.length > 0) r.values = gathered;
          }
          if (Array.isArray(r.values) && r.values.length !== expected) {
            r.values = [...r.values.slice(0, expected), ...Array(Math.max(0, expected - r.values.length)).fill('')];
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
