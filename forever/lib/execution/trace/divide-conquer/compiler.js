// PLAYBACK STAGE of the divide-&-conquer tool: compile recorded call/return/line events into a
// validated ExecutionTrace that drives TWO views in lock-step (the researched split-merge
// design): the ARRAY carries the focus band — cells outside the active call's segment dim
// (USFCA's highlightRange), live values mutate, swaps flash — while the GRAPH grows the
// recursion tree of segments, each call a node labeled with its real bounds, each return
// landing its sorted band on the node. One step object feeds both; they can never disagree.

import { validateExecutionTrace } from '../../../board/execution/execution-trace.js';

import { narrateMoves, narrateSwap, narrateWrite, narrateIntroduced, narrateUpdated } from '../pointer-walk/narrate.js';
import { narrateStart, narrateCall, narrateReturn, narrateDone } from './narrate.js';

// compileDivideConquer({ events, result, code, entry?, fn, pointers?, language })
// events/result: from parseDivideEvents. fn: the recursive function's name (labels the tree).
// pointers: declared index variables (i, j, k, pivot ...) shown riding the array.
export function compileDivideConquer({ events, result, code, entry = null, fn = 'sort', pointers = [], language = 'python' } = {}) {
  if (!Array.isArray(events) || events.length === 0) throw new Error('divide & conquer recorded no events');
  const truncated = events[events.length - 1]?.truncated === true;
  if (truncated) events = events.slice(0, -1);
  const lineCount = String(code ?? '').split('\n').length;
  const inRange = (l) => Number.isInteger(l) && l >= 1 && l <= lineCount;

  // Pass 1 — the call tree (every recursive call, with its real segment bounds).
  const calls = new Map();
  for (const ev of events) {
    if (ev.type === 'call' && Number.isInteger(ev.id)) {
      calls.set(ev.id, { id: ev.id, parent: Number.isInteger(ev.parent) ? ev.parent : null, lo: ev.lo, hi: ev.hi });
    }
  }
  if (calls.size === 0) throw new Error(`divide & conquer saw no calls of "${fn}" — check the declared function name`);
  const nid = (id) => `c${id}`;
  const labelOf = (c) => `${fn}(${c.lo ?? '?'}..${c.hi ?? '?'})`;
  const nodes = [...calls.values()].map((c) => ({ id: nid(c.id), label: labelOf(c) }));
  const edges = [...calls.values()].filter((c) => c.parent != null).map((c) => ({ from: nid(c.parent), to: nid(c.id) }));

  // The declared array view = the FIRST real snapshot (before any mutation).
  const firstArr = events.find((e) => e.type === 'line' && Array.isArray(e.array) && e.array.length > 0)?.array;
  if (!firstArr) throw new Error('divide & conquer recorded no array snapshots — the algorithm must mutate ONE array in place');
  const base = [...firstArr];
  const inArray = (v) => Number.isInteger(v) && v >= 0 && v < base.length;

  // Pass 2 — steps. Both views' state accumulates here and is snapshotted per step.
  const steps = [];
  const revealed = [];
  const finished = [];
  const returned = {};
  const activeStack = []; // call objects, root -> current
  let values = [...base];
  let prevScalars = {};

  const band = () => {
    const top = activeStack[activeStack.length - 1];
    if (!top || !inArray(top.lo) || !inArray(top.hi)) return [];
    const out = [];
    for (let i = 0; i < base.length; i += 1) if (i < top.lo || i > top.hi) out.push(i);
    return out;
  };
  const segText = (c) => {
    const seg = inArray(c.lo) && inArray(c.hi) ? values.slice(c.lo, c.hi + 1) : [];
    const shown = seg.slice(0, 8).map((v) => JSON.stringify(v)).join(', ');
    return `[${shown}${seg.length > 8 ? ', …' : ''}]`;
  };
  const snap = ({ line, explanation, arrayOver = {}, activeEdge, activeEdgeReverse, variables = {} }) => {
    const top = activeStack[activeStack.length - 1] ?? null;
    const dimmed = band(); // cells OUTSIDE the active call's segment — faded, not eliminated
    return {
      line,
      explanation,
      array: { values: [...values], ...(dimmed.length ? { dimmed } : {}), pointers: {}, ...arrayOver },
      graph: {
        current: top ? nid(top.id) : null,
        visited: [...finished],
        revealed: [...revealed],
        returned: { ...returned },
        pointers: top ? { call: nid(top.id) } : {},
      },
      stack: activeStack.map(labelOf),
      ...(activeEdge ? { activeEdge } : {}),
      ...(activeEdgeReverse ? { activeEdgeReverse: true } : {}),
      variables,
    };
  };

  for (const ev of events) {
    if (!inRange(Number(ev.line))) continue;
    const line = Number(ev.line);

    if (ev.type === 'call' && calls.has(ev.id)) {
      const c = calls.get(ev.id);
      const parent = c.parent != null ? calls.get(c.parent) : null;
      activeStack.push(c);
      revealed.push(nid(c.id));
      const size = inArray(c.lo) && inArray(c.hi) ? c.hi - c.lo + 1 : 0;
      steps.push(snap({
        line,
        explanation: narrateCall({ label: labelOf(c), parentLabel: parent ? labelOf(parent) : null, lo: c.lo, hi: c.hi, size }),
        activeEdge: parent ? [nid(parent.id), nid(c.id)] : null,
      }));
      continue;
    }

    if (ev.type === 'return' && calls.has(ev.id)) {
      const c = calls.get(ev.id);
      const parent = c.parent != null ? calls.get(c.parent) : null;
      returned[nid(c.id)] = segText(c);
      finished.push(nid(c.id));
      if (activeStack[activeStack.length - 1]?.id === c.id) activeStack.pop();
      steps.push(snap({
        line,
        explanation: narrateReturn({ label: labelOf(c), segmentText: segText(c), parentLabel: parent ? labelOf(parent) : null }),
        activeEdge: parent ? [nid(c.id), nid(parent.id)] : null,
        activeEdgeReverse: Boolean(parent), // returning UP a declared parent->child edge
      }));
      continue;
    }

    if (ev.type !== 'line') continue;
    const locals = ev.locals && typeof ev.locals === 'object' ? ev.locals : {};
    const snapshot = Array.isArray(ev.array) && ev.array.length === base.length ? ev.array : null;
    const written = snapshot ? values.map((v, i) => (JSON.stringify(v) !== JSON.stringify(snapshot[i]) ? i : -1)).filter((i) => i >= 0) : [];
    const moved = pointers.filter((p) => inArray(locals[p]) && locals[p] !== prevScalars[p]);
    const changedScalars = Object.entries(locals).filter(([k, v]) => !pointers.includes(k) && JSON.stringify(prevScalars[k]) !== JSON.stringify(v));
    if (written.length === 0 && moved.length === 0 && changedScalars.length === 0) continue;
    if (snapshot) values = [...snapshot];

    const parts = [];
    if (moved.length > 0) parts.push(narrateMoves(moved, locals, prevScalars, values));
    if (written.length === 2) parts.push(narrateSwap(written, values));
    else if (written.length > 0) parts.push(narrateWrite(written, values));
    const introduced = changedScalars.filter(([k]) => !(k in prevScalars));
    const updated = changedScalars.filter(([k]) => k in prevScalars);
    if (introduced.length > 0) parts.push(narrateIntroduced(introduced));
    if (updated.length > 0) parts.push(narrateUpdated(updated));
    prevScalars = { ...prevScalars, ...locals };

    const pos = Object.fromEntries(pointers.filter((p) => inArray(locals[p])).map((p) => [p, locals[p]]));
    steps.push(snap({
      line,
      explanation: parts.join(' '),
      arrayOver: {
        pointers: pos,
        ...(written.length === 2 ? { swapped: written } : {}),
        ...(written.length > 0 && written.length !== 2 ? { comparing: written } : {}),
      },
      variables: Object.fromEntries(changedScalars.filter(([, v]) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')),
    }));
  }
  if (steps.length === 0) throw new Error('divide & conquer saw no activity — check fn/arrayVar against the code');

  if (entry) {
    steps.unshift({ ...steps[0], explanation: narrateStart({ entry }), variables: {} });
  }
  steps.push(snap({
    line: steps[steps.length - 1].line,
    explanation: narrateDone({ result, values, truncated }),
  }));

  return validateExecutionTrace({
    language,
    code: String(code ?? ''),
    views: { array: { values: base }, graph: { nodes, edges, directed: true } },
    steps,
  }, 'divide-conquer trace');
}
