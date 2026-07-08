// Graph-walk trace compiler — ANY graph algorithm (Dijkstra, Bellman-Ford, Kahn's topological
// sort, Prim, union-find, cycle detection) as a DETERMINISTIC TOOL over the student's REAL
// code. Built on the proven line-simulator machinery (sys.settrace over a real run), compiled
// through a GRAPH LENS: the model only DECLARES which variables play which role —
//   current:  the node being processed          dist:     tentative-distance dict
//   visited:  the finalized set/list            parent:   union-find / parent map
//   indegree: Kahn's incoming-edge counts       pq | queue | stack: the frontier
// — and THIS stage derives the semantic teaching moments by diffing consecutive snapshots
// (research-verified against algorithm-visualizer's own Dijkstra/Bellman-Ford/Kahn sources):
// a dist entry improves -> relax(old -> new); visited gains a member -> finalize; the current
// variable changes -> take/extract-min; parent changes -> union; indegree drops -> countdown.
// The distance table itself becomes the trace table (traceRow: one column per node — the exact
// table Striver draws beside the graph). Declared semantics, never magic names.

import { validateExecutionTrace } from '../../../board/execution/execution-trace.js';

import {
  narrateStart, narrateTake, narrateRelax, narrateFinalize,
  narrateUnion, narrateIndegree, narrateCollection, narrateDone,
} from './narrate.js';

export const GRAPH_LENS_ROLES = Object.freeze(['current', 'dist', 'visited', 'pq', 'queue', 'stack', 'parent', 'indegree']);

// compileGraphWalk({ events, result, code, entry?, graph, lens, language })
// events/result: from parseLineEvents (line-simulator run). graph: the declared views.graph
// (node ids MUST equal the node keys the student's code uses). lens: role -> variable name.
export function compileGraphWalk({ events, result, code, entry = null, graph, lens = {}, language = 'python' } = {}) {
  if (!Array.isArray(events) || events.length === 0) throw new Error('graph walk recorded no events');
  const truncated = events[events.length - 1]?.truncated === true;
  if (truncated) events = events.slice(0, -1);
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  if (nodes.length === 0) throw new Error('graph walk needs the declared graph (views.graph)');
  const roles = Object.fromEntries(
    Object.entries(lens).filter(([role, varName]) => GRAPH_LENS_ROLES.includes(role) && typeof varName === 'string' && varName),
  );
  if (Object.keys(roles).length === 0) throw new Error(`graph walk needs a lens: at least one of ${GRAPH_LENS_ROLES.join(', ')}`);
  const lensNames = new Set(Object.values(roles));

  const ids = new Set(nodes.map((n) => String(n.id)));
  const labelOf = new Map(nodes.map((n) => [String(n.id), String(n.label ?? n.id)]));
  const name = (id) => labelOf.get(String(id)) ?? String(id);
  const isNode = (v) => (typeof v === 'string' || typeof v === 'number') && ids.has(String(v));
  const plainObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
  const lineCount = String(code ?? '').split('\n').length;

  // The frontier: a heap renders SORTED (index 0 is the min but the rest of a raw heapq list
  // is NOT — research pitfall), a queue/stack renders in true order.
  const frontierRole = roles.pq ? 'pq' : roles.queue ? 'queue' : roles.stack ? 'stack' : null;
  const frontierKey = frontierRole === 'stack' ? 'stack' : 'queue'; // ExecutionTrace collection slot
  const displayItem = (item) => (Array.isArray(item) ? item.join(':') : String(item));
  const displayFrontier = (raw) => {
    const items = raw.map((item) => item);
    if (frontierRole === 'pq') {
      items.sort((a, b) => {
        const av = Array.isArray(a) ? Number(a[0]) : Number(a);
        const bv = Array.isArray(b) ? Number(b[0]) : Number(b);
        if (Number.isFinite(av) && Number.isFinite(bv)) return av - bv;
        return String(a).localeCompare(String(b));
      });
    }
    return items.map(displayItem);
  };

  const steps = [];
  let current = null;
  const visitOrder = []; // finalize ORDER is ours to track — sets are unordered (research pitfall)
  let knownDist = {};
  let prevParent = null;
  let prevIndegree = null;
  let prevFrontier = null;

  const distRow = () => {
    const row = { at: current ? name(current) : '—' };
    for (const [k, v] of Object.entries(knownDist)) if (isNode(k)) row[name(k)] = v;
    return row;
  };
  const snap = ({ line, explanation, activeEdge, frontier, variables }) => ({
    line,
    explanation,
    graph: { current, visited: [...visitOrder], pointers: current ? { curr: current } : {} },
    ...(frontier ? { [frontierKey]: frontier } : {}),
    ...(activeEdge ? { activeEdge } : {}),
    ...(roles.dist ? { traceRow: distRow() } : {}),
    variables: variables ?? {},
  });

  for (const ev of events) {
    const line = Number(ev.line);
    if (!Number.isInteger(line) || line < 1 || line > lineCount) continue;
    const locals = ev.locals && typeof ev.locals === 'object' ? ev.locals : {};
    const parts = [];
    let activeEdge = null;

    // TAKE: the processing pointer lands on a new node (extract-min / dequeue / pop).
    const curRaw = roles.current !== undefined ? locals[roles.current] : undefined;
    if (isNode(curRaw) && String(curRaw) !== current) {
      current = String(curRaw);
      const distNow = plainObj(locals[roles.dist]);
      parts.push(narrateTake({ node: name(current), via: frontierRole === 'stack' ? 'stack' : frontierRole ? 'queue' : null, dist: distNow?.[curRaw] }));
    }

    // RELAX: the distance table changed — old -> new per node, first change lights its edge.
    const dist = plainObj(locals[roles.dist]);
    if (dist) {
      const changes = Object.entries(dist).filter(([k, v]) => isNode(k) && JSON.stringify(knownDist[k]) !== JSON.stringify(v));
      for (const [k, v] of changes.slice(0, 3)) {
        parts.push(narrateRelax({ from: current && String(k) !== current ? name(current) : null, to: name(k), oldValue: knownDist[k], newValue: v }));
      }
      if (changes.length > 3) parts.push(`…and ${changes.length - 3} more table updates land in this same moment — the table panel shows them all.`);
      const firstEdge = changes.find(([k]) => current && String(k) !== current);
      if (firstEdge) activeEdge = [current, String(firstEdge[0])];
      if (changes.length > 0) knownDist = { ...knownDist, ...Object.fromEntries(changes.filter(([k]) => isNode(k))) };
    }

    // FINALIZE: the visited set gained members — record OUR order (event order, deterministic).
    const visitedRaw = locals[roles.visited];
    if (Array.isArray(visitedRaw)) {
      for (const m of visitedRaw) {
        if (isNode(m) && !visitOrder.includes(String(m))) {
          visitOrder.push(String(m));
          parts.push(narrateFinalize({ node: name(m) }));
        }
      }
    }

    // UNION: a parent pointer changed (union-find) — dicts and index-keyed lists both work.
    const parentRaw = Array.isArray(locals[roles.parent])
      ? Object.fromEntries(locals[roles.parent].map((v, i) => [i, v]))
      : plainObj(locals[roles.parent]);
    if (parentRaw) {
      const changes = Object.entries(parentRaw).filter(([k, v]) => JSON.stringify(prevParent?.[k]) !== JSON.stringify(v));
      for (const [k, v] of changes.slice(0, 3)) parts.push(narrateUnion({ child: name(k), root: name(v) }));
      prevParent = { ...parentRaw };
    }

    // INDEGREE: a count dropped (Kahn's) — 0 means free to schedule.
    const indegRaw = Array.isArray(locals[roles.indegree])
      ? Object.fromEntries(locals[roles.indegree].map((v, i) => [i, v]))
      : plainObj(locals[roles.indegree]);
    if (indegRaw && prevIndegree) {
      const drops = Object.entries(indegRaw).filter(([k, v]) => isNode(k) && Number(v) < Number(prevIndegree[k] ?? Infinity));
      for (const [k, v] of drops.slice(0, 3)) parts.push(narrateIndegree({ node: name(k), value: v }));
    }
    if (indegRaw) prevIndegree = { ...indegRaw };

    // FRONTIER: always shown when declared; a pure frontier change is still a visible moment.
    let frontier = null;
    const frontierRaw = frontierRole ? locals[roles[frontierRole]] : null;
    if (Array.isArray(frontierRaw)) {
      frontier = displayFrontier(frontierRaw);
      const key = JSON.stringify(frontier);
      if (parts.length === 0 && key !== prevFrontier) parts.push(narrateCollection({ kind: frontierRole === 'stack' ? 'stack' : 'queue', items: frontier }));
      prevFrontier = key;
    }

    if (parts.length === 0) continue;

    const variables = Object.fromEntries(
      Object.entries(locals).filter(([k, v]) => !lensNames.has(k) && (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')),
    );
    steps.push(snap({ line, explanation: parts.join(' '), activeEdge, frontier, variables }));
  }
  if (steps.length === 0) throw new Error('graph walk saw no lensed state change — check the lens variable names against the code');

  // The tutor's opening frame beat, then the terminal read-back.
  if (entry) {
    steps.unshift({
      line: steps[0].line,
      explanation: narrateStart({ entry }),
      graph: { current: null, visited: [], pointers: {} },
      ...(roles.dist ? { traceRow: { at: '—' } } : {}),
      variables: {},
    });
  }
  steps.push(snap({
    line: steps[steps.length - 1].line,
    explanation: narrateDone({ result, orderNames: visitOrder.map(name), truncated }),
    frontier: null,
    variables: {},
  }));

  return validateExecutionTrace({
    language,
    code: String(code ?? ''),
    views: { graph: { nodes, edges, directed: graph.directed !== false } },
    steps,
  }, 'graph-walk trace');
}
