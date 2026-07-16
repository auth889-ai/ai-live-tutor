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
  narrateUnion, narrateIndegree, narrateCollection, narrateNodeState, narrateDone,
} from './narrate.js';
import { detectNodeStateVars, createNodeStateTracker } from './node-state.js';

export const GRAPH_LENS_ROLES = Object.freeze(['current', 'dist', 'visited', 'pq', 'queue', 'stack', 'parent', 'indegree']);

// STRUCTURE-BUILD PHASE DETECTOR: the index of the LAST event at which an adjacency-shaped
// local was still gaining members — everything up to it is BUILD_STRUCTURE, not algorithm.
// Adjacency-shaped means: a dict whose keys are ALL node ids with array values, or a
// list-of-lists whose row count equals the node count on EVERY sighting (rows fixed, members
// grow). Frontiers/queues disqualify themselves by shrinking or by growing their row count
// (a seen-list of (node,mask) tuples grows ROWS; an adjacency never does). A structure
// mutated mid-walk would over-suppress — that run degrades honestly to the next lens.
function structureBuildEnd(events, ids) {
  const shapes = new Map(); // name -> {ok, isList, rows, prevCount}
  let last = -1;
  events.forEach((e, i) => {
    const locals = e.locals && typeof e.locals === 'object' ? e.locals : {};
    for (const [name, v] of Object.entries(locals)) {
      let s = shapes.get(name);
      if (s?.ok === false) continue;
      let count = null;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const keys = Object.keys(v);
        const vals = Object.values(v);
        if (keys.length > 0 && keys.every((k) => ids.has(String(k))) && vals.every(Array.isArray)) {
          count = vals.reduce((a, arr) => a + arr.length, 0);
        }
      } else if (Array.isArray(v) && v.length === ids.size && v.every(Array.isArray)) {
        count = v.reduce((a, arr) => a + arr.length, 0);
      }
      if (count === null) {
        if (v !== undefined && v !== null && s) shapes.set(name, { ok: false }); // shape broke mid-run
        continue;
      }
      if (!s) s = { ok: true, prevCount: count };
      else if (count < s.prevCount) s = { ok: false }; // shrank: a frontier, not a structure
      else {
        if (count > s.prevCount) last = i;
        s.prevCount = count;
      }
      shapes.set(name, s);
    }
  });
  return last;
}

// DECLARED-ROLE BEHAVIOR VALIDATION (live-caught on LC1192: the tracer declared
// visited:"disc" and stack:"time" — disc is the discovery-time ARRAY, time a step counter.
// Trusting the labels rendered a junk frontier panel and locked disc out of the nodeState
// channel, because lens vars are excluded from aux detection). A declared role must BEHAVE
// like its role in the recording or it is dropped; the freed variable then falls through to
// the aux nodeState detector, which reads behavior, not names. Same tests the universal
// graph-adjacency detector applies — declared and derived paths now share one truth bar.
function dropMisdeclaredRoles(roles, events, graph) {
  const ids = new Set((graph?.nodes ?? []).map((n) => String(n.id)));
  const isNodeVal = (v) => (typeof v === 'string' || typeof v === 'number') && ids.has(String(v));
  const snapsOf = (name) => events
    .map((e) => (e.locals && typeof e.locals === 'object' ? e.locals[name] : undefined))
    .filter((v) => v !== undefined && v !== null);

  const behaves = {
    current(snaps) {
      const scalars = snaps.filter((v) => typeof v === 'string' || typeof v === 'number');
      return scalars.length > 0 && scalars.every(isNodeVal);
    },
    visited(snaps) {
      const arrays = snaps.filter(Array.isArray);
      if (arrays.length < 2) return false;
      if (!arrays.every((s) => s.every(isNodeVal))) return false; // disc's -1 scaffold fails here
      return arrays.every((s, i) => i === 0 || s.length >= arrays[i - 1].length);
    },
    frontier(snaps) {
      const arrays = snaps.filter(Array.isArray);
      if (arrays.length < 2) return false;
      if (!arrays.every((s) => s.every((m) => isNodeVal(m) || (Array.isArray(m) && m.some(isNodeVal))))) return false;
      let grew = false;
      let shrank = false;
      for (let i = 1; i < arrays.length; i += 1) {
        if (arrays[i].length > arrays[i - 1].length) grew = true;
        if (arrays[i].length < arrays[i - 1].length) shrank = true;
      }
      return grew && shrank; // a counter like time=[0..] only grows — dropped
    },
    dist(snaps) {
      const dicts = snaps.filter((v) => v && typeof v === 'object' && !Array.isArray(v));
      if (dicts.length < 2) return false;
      const final = dicts.at(-1);
      return Object.keys(final).length > 0
        && Object.entries(final).every(([k, v]) => ids.has(String(k)) && typeof v === 'number');
    },
    indegree(snaps) {
      const lists = snaps.filter((v) => Array.isArray(v) && v.every((x) => Number.isInteger(x)));
      return lists.length >= 2 && lists.every((v) => v.every((x) => x >= 0));
    },
    parent(snaps) {
      const last = snaps.at(-1);
      if (Array.isArray(last)) return last.some(isNodeVal);
      if (last && typeof last === 'object') return Object.values(last).some(isNodeVal);
      return false;
    },
  };

  for (const [role, varName] of Object.entries(roles)) {
    const check = role === 'pq' || role === 'queue' || role === 'stack' ? behaves.frontier : behaves[role];
    if (!check) continue;
    if (!check(snapsOf(varName))) delete roles[role];
  }
}

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
  dropMisdeclaredRoles(roles, events, graph);
  if (Object.keys(roles).length === 0) {
    throw new Error('none of the declared lens roles match the recorded behavior (a visited set must grow with node members; a frontier must grow AND shrink; a dist table must be a node-keyed dict) — output "auto": {"entry": ...} instead and let the engine derive the roles from the run itself');
  }
  const lensNames = new Set(Object.values(roles));

  const ids = new Set(nodes.map((n) => String(n.id)));
  // Orientation-agnostic membership (a relaxation can only light an edge that EXISTS between
  // the two nodes — direction of travel may legitimately oppose a directed edge on returns).
  const edgePairs = new Set(edges.flatMap((e) => [
    `${String(e.from)}>${String(e.to)}`, `${String(e.to)}>${String(e.from)}`,
  ]));
  const edgeExists = (a, b) => edgePairs.has(`${String(a)}>${String(b)}`);
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

  // EXECUTION PHASE SEGMENTATION (external review, verified live on HEAD: Dijkstra's and
  // Tarjan's BUILD loops — `for u, v in edges: adj[u].append(v)` — were narrated as the
  // traversal: "Now 3 is taken out of the frontier" while the frontier did not exist yet,
  // because the build loop's u subscripts the adjacency exactly like the walk's u does).
  // The structure-construction phase is detected from the recording itself: while any
  // adjacency-shaped local is still GAINING members, the algorithm has not started. Events
  // in that prefix feed the trackers (so init state is known) but claim NO teaching moments.
  const buildEndIndex = structureBuildEnd(events, ids);

  // PER-NODE STATE (mockup parity, root-cause fix): any node-keyed local OUTSIDE the role
  // vocabulary (Tarjan's disc/low, union-find rank, BFS level) is detected generically and
  // ridden onto the drawing as labels under the nodes — the data the reference visualizers
  // are rich with, which the old projection silently discarded.
  const auxVars = detectNodeStateVars(events, { ids, exclude: lensNames });
  const auxTracker = auxVars.length ? createNodeStateTracker(auxVars, ids) : null;

  const steps = [];
  let current = null;
  // A take is only REAL once claimed post-build: the build loop leaves its iteration variable
  // behind (u=3 after `for u,v in times`), and the first algorithm event must not narrate that
  // leftover as "taken from the frontier" nor attribute relaxations "through" it.
  let currentClaimed = false;
  let seededAfterBuild = buildEndIndex < 0; // no build phase -> nothing stale to absorb
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
  const snap = ({ line, explanation, activeEdge, frontier, variables, events: stepEvents }) => ({
    line,
    explanation,
    // The drawn pointer follows only a CLAIMED current — a stale build-loop value must not
    // put the red ring on a node the algorithm has not actually taken.
    graph: { current: currentClaimed ? current : null, visited: [...visitOrder], pointers: currentClaimed && current ? { curr: current } : {} },
    ...(frontier ? { [frontierKey]: frontier } : {}),
    ...(activeEdge ? { activeEdge } : {}),
    ...(roles.dist ? { traceRow: distRow() } : {}),
    ...(auxTracker ? { nodeState: auxTracker.snapshot() } : {}),
    ...(stepEvents?.length ? { events: stepEvents } : {}),
    variables: variables ?? {},
  });

  for (let evIndex = 0; evIndex < events.length; evIndex += 1) {
    const ev = events[evIndex];
    const line = Number(ev.line);
    if (!Number.isInteger(line) || line < 1 || line > lineCount) continue;
    const locals = ev.locals && typeof ev.locals === 'object' ? ev.locals : {};

    // BUILD_STRUCTURE phase: the graph is still being assembled — no teaching moment may be
    // claimed here (the build loop's u is NOT a traversal pointer). Trackers still absorb
    // state silently so the first algorithm step starts from the true initial values.
    if (evIndex <= buildEndIndex) {
      const dist0 = plainObj(locals[roles.dist]);
      if (dist0) knownDist = { ...knownDist, ...Object.fromEntries(Object.entries(dist0).filter(([k]) => isNode(k))) };
      const parent0 = Array.isArray(locals[roles.parent])
        ? Object.fromEntries(locals[roles.parent].map((v, i) => [i, v]))
        : plainObj(locals[roles.parent]);
      if (parent0) prevParent = { ...parent0 };
      const indeg0 = Array.isArray(locals[roles.indegree])
        ? Object.fromEntries(locals[roles.indegree].map((v, i) => [i, v]))
        : plainObj(locals[roles.indegree]);
      if (indeg0) prevIndegree = { ...indeg0 };
      if (auxTracker) auxTracker.update(locals);
      const frontierRaw0 = frontierRole ? locals[roles[frontierRole]] : null;
      if (Array.isArray(frontierRaw0)) prevFrontier = JSON.stringify(displayFrontier(frontierRaw0));
      continue;
    }

    const parts = [];
    // TYPED EVENTS (B2): each narrated moment also emits a universal-verb event with a typed
    // target and recorded before/after — the channel the Decision column and the Director's
    // when-annotations read. Same facts as the prose, machine-readable.
    const stepEvents = [];
    const emit = (eventType, over = {}) => stepEvents.push({ eventType, provenance: { eventIndex: evIndex }, ...over });
    let activeEdge = null;

    // PHASE BOUNDARY: absorb the build loop's leftover iteration value silently — it is
    // stale state, not the algorithm's first take.
    const curRaw = roles.current !== undefined ? locals[roles.current] : undefined;
    if (!seededAfterBuild) {
      seededAfterBuild = true;
      if (isNode(curRaw)) current = String(curRaw);
    }

    // TAKE: the processing pointer lands on a new node (extract-min / dequeue / pop).
    if (isNode(curRaw) && String(curRaw) !== current) {
      current = String(curRaw);
      currentClaimed = true;
      emit('visit', { semanticRole: 'frontier_take', target: { entityId: `graphNode:${current}` } });
      const distNow = plainObj(locals[roles.dist]);
      parts.push(narrateTake({ node: name(current), via: frontierRole === 'stack' ? 'stack' : frontierRole ? 'queue' : null, dist: distNow?.[curRaw] }));
    }

    // RELAX: the distance table changed — old -> new per node, first change lights its edge.
    const dist = plainObj(locals[roles.dist]);
    if (dist) {
      const changes = Object.entries(dist).filter(([k, v]) => isNode(k) && JSON.stringify(knownDist[k]) !== JSON.stringify(v));
      for (const [k, v] of changes.slice(0, 3)) {
        // "Through X we reach Y" only when X is a CLAIMED take — a stale build-loop leftover
        // must not be credited with relaxations (the dist init reads as the table starting).
        parts.push(narrateRelax({ from: currentClaimed && current && String(k) !== current ? name(current) : null, to: name(k), oldValue: knownDist[k], newValue: v }));
        emit('relax', {
          semanticRole: knownDist[k] === undefined ? 'first_discovery' : 'improvement',
          target: { entityId: `graphNode:${String(k)}`, field: roles.dist },
          before: knownDist[k], after: v,
        });
      }
      if (changes.length > 3) parts.push(`…and ${changes.length - 3} more table updates land in this same moment — the table panel shows them all.`);
      // The relaxed edge lights up ONLY when it is a real declared edge (external review:
      // the validator checked node existence but not edge membership — an invented edge
      // rendered as confidently as a real one).
      const firstEdge = changes.find(([k]) => currentClaimed && current && String(k) !== current && edgeExists(current, String(k)));
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
          emit('finalize', { target: { entityId: `graphNode:${String(m)}` } });
          // Finalization PROVES processing: when the stale-seeded current coincides with the
          // algorithm's real first node (so no change-based take fired), the visited growth
          // is the evidence that claims it — relaxations may now attribute and light edges.
          if (!currentClaimed && current === String(m)) currentClaimed = true;
        }
      }
    }

    // UNION: a parent pointer changed (union-find) — dicts and index-keyed lists both work.
    const parentRaw = Array.isArray(locals[roles.parent])
      ? Object.fromEntries(locals[roles.parent].map((v, i) => [i, v]))
      : plainObj(locals[roles.parent]);
    if (parentRaw) {
      const changes = Object.entries(parentRaw).filter(([k, v]) => JSON.stringify(prevParent?.[k]) !== JSON.stringify(v));
      for (const [k, v] of changes.slice(0, 3)) {
        parts.push(narrateUnion({ child: name(k), root: name(v) }));
        emit('union', { target: { entityId: `graphNode:${String(k)}`, field: roles.parent }, before: prevParent?.[k], after: v });
      }
      prevParent = { ...parentRaw };
    }

    // INDEGREE: a count dropped (Kahn's) — 0 means free to schedule.
    const indegRaw = Array.isArray(locals[roles.indegree])
      ? Object.fromEntries(locals[roles.indegree].map((v, i) => [i, v]))
      : plainObj(locals[roles.indegree]);
    if (indegRaw && prevIndegree) {
      const drops = Object.entries(indegRaw).filter(([k, v]) => isNode(k) && Number(v) < Number(prevIndegree[k] ?? Infinity));
      for (const [k, v] of drops.slice(0, 3)) {
        parts.push(narrateIndegree({ node: name(k), value: v }));
        emit('write', { semanticRole: 'indegree_drop', target: { entityId: `graphNode:${String(k)}`, field: roles.indegree }, before: prevIndegree[k], after: v });
      }
    }
    if (indegRaw) prevIndegree = { ...indegRaw };

    // PER-NODE STATE WRITE: disc/low/rank/level changed — a real teaching moment (Tarjan's
    // low-update on backtrack IS the lesson), narrated with old -> new like a relaxation.
    if (auxTracker) {
      const writes = auxTracker.update(locals);
      for (const w of writes.slice(0, 3)) {
        parts.push(narrateNodeState({ varName: w.varName, node: name(w.node), oldValue: w.oldValue, newValue: w.newValue }));
        emit('write', { semanticRole: 'state_write', target: { entityId: `graphNode:${String(w.node)}`, field: w.varName }, before: w.oldValue, after: w.newValue });
      }
      if (writes.length > 3) parts.push(`…and ${writes.length - 3} more per-node labels rewrite in this same moment — read them straight off the drawing.`);
    }

    // FRONTIER: always shown when declared; a pure frontier change is still a visible moment.
    let frontier = null;
    const frontierRaw = frontierRole ? locals[roles[frontierRole]] : null;
    if (Array.isArray(frontierRaw)) {
      frontier = displayFrontier(frontierRaw);
      const key = JSON.stringify(frontier);
      if (parts.length === 0 && key !== prevFrontier) {
        parts.push(narrateCollection({ kind: frontierRole === 'stack' ? 'stack' : 'queue', items: frontier }));
        emit('collection_change', { target: { entityId: `collection:${frontierRole}` }, after: frontier });
      }
      prevFrontier = key;
    }

    if (parts.length === 0) continue;

    const variables = Object.fromEntries(
      Object.entries(locals).filter(([k, v]) => !lensNames.has(k) && (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')
        // Python repr junk ("<function dfs at 0x...>", "<object ...>") is not a value a teacher
        // would write on the board — measured live: a closure leaked into the trace table.
        // (prefix-only match: the recorder truncates long strings, so the closing ">" may be cut)
        && !(typeof v === 'string' && v.startsWith('<') && /function|object|module|method|class '| at 0x[0-9a-f]/.test(v))),
    );
    const stepOut = snap({ line, explanation: parts.join(' '), activeEdge, frontier, variables, events: stepEvents });
    // CallFrame channel passthrough (B3): the live stack + the most recent completed frame.
    if (Array.isArray(ev.frames) && ev.frames.length) {
      stepOut.frames = ev.frames;
      if (ev.lastReturn) stepOut.lastReturn = ev.lastReturn;
    }
    steps.push(stepOut);
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
    events: [{ eventType: 'solution_emit', after: result }],
  }));

  return validateExecutionTrace({
    language,
    code: String(code ?? ''),
    views: { graph: { nodes, edges, directed: graph.directed !== false } },
    steps,
  }, 'graph-walk trace');
}
