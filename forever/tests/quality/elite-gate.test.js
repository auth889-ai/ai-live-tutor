// ELITE GATE — the tests that DECIDE eliteness instead of claiming it.
//
// The reference visualizers (recursion.vercel.app, Vista, Dijkstra Visualizer) show ONE caption
// line and a graph. Forever's bar is higher: every real trace must deliver all four axes at
// once — a moving code pointer, a step-by-step explanation in real sentences, visible state
// that actually changes (the trace table / structure), and a structural drawing whose
// highlights reference real nodes. These run over the REAL fixture traces produced by
// scripts/gen-trace-fixtures.mjs (actual python3 executions), so a regression in any engine
// fails here before anyone has to eyeball a screenshot.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { wantsForceLayout } from '../../lib/board/diagrams/force-layout.js';

const traces = JSON.parse(readFileSync(new URL('../../app/dev/gallery/traces.json', import.meta.url), 'utf8'));

const STATE_FIELDS = ['graph', 'array', 'array2d', 'list', 'stack', 'queue', 'traceRow', 'variables'];
const stateOf = (s) => JSON.stringify(STATE_FIELDS.map((f) => s[f] ?? null));

test('fixtures exist: the gallery covers every engine family', () => {
  assert.ok(traces.length >= 12, `expected the full engine gallery, got ${traces.length} traces`);
});

for (const entry of traces) {
  const { name, trace } = entry;
  const steps = trace.steps;
  const codeLines = String(trace.code || '').split('\n').length;

  test(`[pointer] ${name} — code pointer valid on every step and actually moves`, () => {
    for (const [i, s] of steps.entries()) {
      assert.ok(Number.isInteger(s.line) && s.line >= 1 && s.line <= codeLines,
        `step ${i + 1} points at line ${s.line} but the code has ${codeLines} lines`);
    }
    if (steps.length >= 10) {
      const distinct = new Set(steps.map((s) => s.line)).size;
      assert.ok(distinct >= 2, `${steps.length} steps but the pointer never moves (only line ${steps[0].line})`);
    }
  });

  test(`[explanation] ${name} — every step narrated in real sentences, not repeated filler`, () => {
    let words = 0;
    for (const [i, s] of steps.entries()) {
      const text = String(s.explanation || '').trim();
      assert.ok(text.length > 0, `step ${i + 1} has no explanation`);
      const w = text.split(/\s+/).length;
      assert.ok(w >= 4, `step ${i + 1} explanation is a fragment ("${text}")`);
      words += w;
    }
    assert.ok(words / steps.length >= 8, `average explanation is ${(words / steps.length).toFixed(1)} words — caption-level, not teaching-level`);
    const unique = new Set(steps.map((s) => s.explanation)).size;
    assert.ok(unique / steps.length >= 0.6, `only ${unique}/${steps.length} explanations are distinct — reads like copy-paste`);
  });

  test(`[table/state] ${name} — every step shows state, and the state visibly moves`, () => {
    for (const [i, s] of steps.entries()) {
      if (i === 0) continue; // step 1 may be the framing/intro before anything moves
      const visible = STATE_FIELDS.some((f) => s[f] != null && Object.keys(s[f]).length > 0);
      assert.ok(visible, `step ${i + 1} carries no visible state (nothing for the table or structure to show)`);
    }
    if (steps.length >= 3) {
      let changed = 0;
      for (let i = 1; i < steps.length; i += 1) if (stateOf(steps[i]) !== stateOf(steps[i - 1])) changed += 1;
      assert.ok(changed / (steps.length - 1) >= 0.4,
        `state changes on only ${changed}/${steps.length - 1} transitions — the dry run barely moves`);
    }
  });

  const g = trace.views?.graph;
  if (g) {
    test(`[visual] ${name} — drawing highlights reference real structure nodes`, () => {
      assert.ok(g.nodes.length > 0, 'graph view has no nodes');
      const ids = new Set(g.nodes.map((n) => String(n.id)));
      let highlighted = 0;
      for (const [i, s] of steps.entries()) {
        const cur = s.graph?.current;
        if (cur != null) {
          highlighted += 1;
          assert.ok(ids.has(String(cur)), `step ${i + 1} highlights "${cur}" which is not in the drawn structure`);
        }
        for (const v of s.graph?.visited ?? []) assert.ok(ids.has(String(v)), `step ${i + 1} marks unknown node "${v}" visited`);
        if (s.activeEdge) {
          const [from, to] = Array.isArray(s.activeEdge) ? s.activeEdge : [s.activeEdge.from, s.activeEdge.to];
          assert.ok(ids.has(String(from)) && ids.has(String(to)),
            `step ${i + 1} animates edge ${from}->${to} outside the structure`);
        }
      }
      assert.ok(highlighted > 0, 'no step ever highlights a current node — the drawing never comes alive');
      const finalVisited = steps[steps.length - 1].graph?.visited ?? [];
      assert.ok(finalVisited.length > 0 || steps.some((s) => (s.graph?.visited ?? []).length > 0),
        'visited never accumulates — no sense of progress in the drawing');
    });
  }
}

test('[layout] cyclic graphs draw organically (reference style), clean trees stay tidy', () => {
  const dijkstra = traces.find((t) => /dijkstra/i.test(t.name))?.trace.views.graph;
  const tree = traces.find((t) => /AUTO-TREE/i.test(t.name))?.trace.views.graph;
  assert.ok(dijkstra && tree, 'need both the Dijkstra and AUTO-TREE fixtures');
  assert.equal(wantsForceLayout(dijkstra, true), true, 'Dijkstra graph (cycles) must get the organic force layout');
  assert.equal(wantsForceLayout(tree, true), false, 'a binary tree must stay hierarchical');
});

test('[visual] weighted graphs show their weights on the edges (reference parity)', () => {
  const dijkstra = traces.find((t) => /dijkstra/i.test(t.name))?.trace.views.graph;
  assert.ok(dijkstra, 'need the Dijkstra fixture');
  for (const e of dijkstra.edges) {
    assert.ok(String(e.label ?? '').length > 0, `edge ${e.from}->${e.to} has no weight label — the numbers the algorithm compares are invisible`);
  }
});
