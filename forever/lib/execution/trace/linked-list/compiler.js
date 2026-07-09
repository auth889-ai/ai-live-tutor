// PLAYBACK STAGE of the linked-list tool: compile recorded chain snapshots into a validated
// ExecutionTrace. The tracker recorded {pointers, nodes} per line from a REAL run; this stage
// diffs consecutive snapshots into the four teaching events (pointer-move, rewire, new-node,
// detach) and keeps the researched POSITIONAL INVARIANCE rule: a node's box position is its
// first-appearance order, forever — during a reversal the boxes stay put and only the arrows
// flip, exactly how Python Tutor lays out heap rows.

import { validateExecutionTrace } from '../../../board/execution/execution-trace.js';

import {
  narrateStart, narratePointerMove, narrateRewire,
  narrateNewNode, narrateDetach, narrateDone,
} from './narrate.js';

// compileLinkedListTrace({ events, result, code, entry?, language })
// events/result: from parseListEvents (dedicated tracker run).
export function compileLinkedListTrace({ events, result, code, entry = null, language = 'python' } = {}) {
  if (!Array.isArray(events) || events.length === 0) throw new Error('linked-list tracker recorded no events');
  const truncated = events[events.length - 1]?.truncated === true;
  if (truncated) events = events.slice(0, -1);
  const lineCount = String(code ?? '').split('\n').length;

  const order = []; // first-appearance order = box position, FOREVER (positional invariance)
  const lastKnown = {}; // nodeId -> {value, next} — orphans keep their last real state
  let prevPointers = {};
  let prevReachable = new Set();
  const steps = [];
  const label = (id) => (id == null ? null : JSON.stringify(lastKnown[id]?.value ?? '?'));

  const snapList = (reachable, pointers, rewired) => ({
    nodes: order.map((id) => ({
      id,
      value: lastKnown[id]?.value ?? null,
      next: lastKnown[id]?.next ?? null,
      ...(reachable.has(id) ? {} : { orphan: true }),
      ...(rewired.has(id) ? { rewired: true } : {}),
    })),
    pointers: { ...pointers },
  });

  for (const ev of events) {
    const line = Number(ev.line);
    if (!Number.isInteger(line) || line < 1 || line > lineCount) continue;
    const state = ev.state && typeof ev.state === 'object' ? ev.state : {};
    const nodes = state.nodes && typeof state.nodes === 'object' ? state.nodes : {};
    const pointers = state.pointers && typeof state.pointers === 'object' ? state.pointers : {};
    const parts = [];
    const rewired = new Set();

    // NEW NODES: first sight fixes the box position for the rest of the animation.
    for (const id of Object.keys(nodes)) {
      if (!order.includes(id)) {
        order.push(id);
        lastKnown[id] = { ...nodes[id] };
        if (prevReachable.size > 0) parts.push(narrateNewNode({ valueLabel: JSON.stringify(nodes[id].value ?? '?') }));
      }
    }

    // REWIRES: a known node's next-arrow changed target — the mutation that IS the algorithm.
    for (const [id, node] of Object.entries(nodes)) {
      const before = lastKnown[id];
      if (before && before.next !== node.next && prevReachable.has(id)) {
        rewired.add(id);
        parts.push(narrateRewire({
          fromValue: JSON.stringify(node.value ?? '?'),
          oldToValue: before.next == null ? null : label(before.next),
          newToValue: node.next == null ? null : JSON.stringify(nodes[node.next]?.value ?? lastKnown[node.next]?.value ?? '?'),
        }));
      }
      lastKnown[id] = { ...node };
    }

    // POINTER MOVES: the named fingers walking the chain.
    for (const [name, nid] of Object.entries(pointers)) {
      if (prevPointers[name] !== nid) {
        parts.push(narratePointerMove({ name, valueLabel: nid == null ? null : label(nid), isFirst: !(name in prevPointers) }));
      }
    }

    // DETACHES: reachable before, unreachable now — the orphan/garbage moment.
    const reachable = new Set(Object.keys(nodes));
    for (const id of prevReachable) {
      if (!reachable.has(id)) parts.push(narrateDetach({ valueLabel: label(id) }));
    }

    prevPointers = { ...pointers };
    prevReachable = reachable;
    if (parts.length === 0) continue;
    steps.push({
      line,
      explanation: parts.join(' '),
      list: snapList(reachable, pointers, rewired),
      variables: ev.variables && typeof ev.variables === 'object' ? ev.variables : {},
    });
  }
  if (steps.length === 0) throw new Error('linked-list tracker saw no chain activity — check the declared pointer roots');

  if (entry) {
    steps.unshift({
      line: steps[0].line,
      explanation: narrateStart({ entry }),
      list: { nodes: [], pointers: {} },
      variables: {},
    });
  }

  // Terminal read-back: after a reversal the real chain hangs off `prev`, not `head` — walk
  // the arrows from EVERY root and read back the longest chain (cycle-safe).
  const chainFrom = (start) => {
    const out = [];
    const seen = new Set();
    let walk = start;
    while (walk != null && lastKnown[walk] && !seen.has(walk) && out.length < 50) {
      seen.add(walk);
      out.push(String(lastKnown[walk].value ?? '?'));
      walk = lastKnown[walk].next;
    }
    return out;
  };
  const chain = Object.values(prevPointers)
    .filter((nid) => nid != null)
    .map(chainFrom)
    .reduce((best, c) => (c.length > best.length ? c : best), []);
  steps.push({
    line: steps[steps.length - 1].line,
    explanation: narrateDone({ result, chain, truncated }),
    list: steps[steps.length - 1].list,
    variables: {},
  });

  return validateExecutionTrace({
    language,
    code: String(code ?? ''),
    views: { list: { nodes: order.map((id) => ({ id })) } },
    steps,
  }, 'linked-list trace');
}
