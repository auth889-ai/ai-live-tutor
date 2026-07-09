// PLAYBACK STAGE of the trie tool: compile recorded tree snapshots into a validated
// ExecutionTrace rendered on the existing growing-tree view. The mapping is the research's
// Galles grammar on our GraphView vocabulary, zero renderer changes:
//   revealed  = attached nodes (the trie GROWS node by node; pruned nodes fade back to ghost)
//   visited   = end-of-word nodes (green — Galles' TRUE_COLOR teaching device)
//   current   = the student's cursor variable, riding under its REAL name as the pointer
//   activeEdge = the edge just walked or just created
// Beats derived by diffing consecutive snapshots: create-vs-reuse fork, end-flag set/clear
// (the app-vs-apple lesson), bottom-up prune — all from the student's real run.

import { validateExecutionTrace } from '../../../board/execution/execution-trace.js';

import {
  narrateStart, narrateWalk, narrateCreate,
  narrateEndSet, narrateEndClear, narratePrune, narrateDone,
} from './narrate.js';

// compileTrieTrace({ events, result, code, entry?, language })
export function compileTrieTrace({ events, result, code, entry = null, language = 'python' } = {}) {
  if (!Array.isArray(events) || events.length === 0) throw new Error('trie tracker recorded no events');
  const truncated = events[events.length - 1]?.truncated === true;
  if (truncated) events = events.slice(0, -1);
  const lineCount = String(code ?? '').split('\n').length;

  const order = []; // every node ever attached, first-appearance order
  const charOf = {}; // nodeId -> its incoming edge character (root has none)
  const parentOf = {}; // nodeId -> parent nodeId
  const edgeList = []; // {from, to, label} fixed at attach time
  const prefixOf = (id) => {
    const chars = [];
    let walk = id;
    while (walk && parentOf[walk] !== undefined && chars.length < 30) {
      chars.push(charOf[walk] ?? '');
      walk = parentOf[walk];
    }
    return chars.reverse().join('');
  };

  const steps = [];
  const revealed = [];
  let prevNodes = {};
  let prevCursor = null;
  let prevEnds = new Set();

  const snap = ({ line, explanation, cursor, cursorName, ends, activeEdge, variables }) => ({
    line,
    explanation,
    graph: {
      current: cursor ?? null,
      visited: [...ends],
      revealed: [...revealed],
      pointers: cursor ? { [cursorName ?? 'cur']: cursor } : {},
    },
    ...(activeEdge ? { activeEdge } : {}),
    variables: variables ?? {},
  });

  for (const ev of events) {
    const line = Number(ev.line);
    if (!Number.isInteger(line) || line < 1 || line > lineCount) continue;
    const state = ev.state && typeof ev.state === 'object' ? ev.state : {};
    const nodes = state.nodes && typeof state.nodes === 'object' ? state.nodes : {};
    const cursor = state.cursor ?? null;
    const cursorName = state.cursorName ?? null;
    const parts = [];
    let activeEdge = null;

    // ATTACH: nodes reachable now that never were before — the create beat. Root attaches
    // silently (it is the given starting point, not a teaching moment).
    for (const [id, node] of Object.entries(nodes)) {
      if (!order.includes(id)) order.push(id);
      for (const [ch, childId] of Object.entries(node.children ?? {})) {
        if (parentOf[childId] === undefined && nodes[childId]) {
          parentOf[childId] = id;
          charOf[childId] = ch;
          edgeList.push({ from: id, to: childId, label: ch });
        }
      }
    }
    const attached = Object.keys(nodes).filter((id) => !revealed.includes(id));
    for (const id of attached) {
      revealed.push(id);
      if (parentOf[id] !== undefined) {
        parts.push(narrateCreate({ char: charOf[id], prefix: prefixOf(id) }));
        activeEdge = [parentOf[id], id];
      }
    }

    // END FLAGS: set (green on) and clear (delete's unmark).
    const ends = new Set(Object.entries(nodes).filter(([, n]) => n.end === true).map(([id]) => id));
    for (const id of ends) if (!prevEnds.has(id) && prevNodes[id]) parts.push(narrateEndSet({ prefix: prefixOf(id) || '∅' }));
    for (const id of prevEnds) if (!ends.has(id) && nodes[id]) parts.push(narrateEndClear({ prefix: prefixOf(id) || '∅' }));

    // PRUNE: reachable before, gone now — fade back to ghost, bottom-up.
    for (const id of Object.keys(prevNodes)) {
      if (!nodes[id]) {
        const at = revealed.indexOf(id);
        if (at >= 0) revealed.splice(at, 1);
        parts.push(narratePrune({ prefix: prefixOf(id), char: charOf[id] ?? '?' }));
      }
    }

    // WALK: the cursor moved onto an already-existing node — the reuse beat. (A move onto a
    // just-created node is already covered by its create sentence.)
    if (cursor && cursor !== prevCursor && !attached.includes(cursor)) {
      parts.push(narrateWalk({ name: cursorName ?? 'cur', char: charOf[cursor] ?? null, prefix: prefixOf(cursor) }));
      if (parentOf[cursor] !== undefined && !activeEdge) activeEdge = [parentOf[cursor], cursor];
    }

    prevNodes = nodes;
    prevEnds = ends;
    prevCursor = cursor;
    if (parts.length === 0) continue;
    steps.push(snap({ line, explanation: parts.join(' '), cursor, cursorName, ends, activeEdge, variables: ev.variables ?? {} }));
  }
  if (steps.length === 0) throw new Error('trie tracker saw no trie activity — check root/childrenAttr/endAttr against the code');

  if (entry) {
    steps.unshift({
      line: steps[0].line,
      explanation: narrateStart({ entry }),
      graph: { current: null, visited: [], revealed: [], pointers: {} },
      variables: {},
    });
  }

  // Terminal read-back: collect the stored words from the FINAL snapshot (DFS to green nodes).
  const words = [];
  (function dfs(id, prefix) {
    if (!prevNodes[id] || words.length >= 12) return;
    if (prevNodes[id].end) words.push(prefix || '∅');
    const kids = Object.entries(prevNodes[id].children ?? {}).sort(([a], [b]) => a.localeCompare(b));
    for (const [ch, child] of kids) dfs(child, prefix + ch);
  })(order[0], '');
  steps.push(snap({
    line: steps[steps.length - 1].line,
    explanation: narrateDone({ result, words, truncated }),
    cursor: null,
    cursorName: null,
    ends: prevEnds,
  }));

  // Edges sorted alphabetically per parent — the canonical textbook drawing (research rec).
  const orderIdx = new Map(order.map((id, i) => [id, i]));
  edgeList.sort((a, b) => (orderIdx.get(a.from) - orderIdx.get(b.from)) || a.label.localeCompare(b.label));
  return validateExecutionTrace({
    language,
    code: String(code ?? ''),
    views: {
      graph: {
        nodes: order.map((id) => ({ id, label: charOf[id] ?? '∅' })),
        edges: edgeList,
        directed: true,
      },
    },
    steps,
  }, 'trie trace');
}
