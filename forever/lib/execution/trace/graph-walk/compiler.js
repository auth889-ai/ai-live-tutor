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
function dropMisdeclaredRoles(roles, events, graph, collops = null) {
  const ids = new Set((graph?.nodes ?? []).map((n) => String(n.id)));
  const isNodeVal = (v) => (typeof v === 'string' || typeof v === 'number') && ids.has(String(v));
  const snapsOf = (name) => events
    .map((e) => (e.locals && typeof e.locals === 'object' ? e.locals[name] : undefined))
    .filter((v) => v !== undefined && v !== null);
  // Variables the recorder saw release ops from — a drain-only frontier (seeded once, only
  // popped) never grows, but its recorded releases are stronger proof than any length curve.
  const releaseVars = new Set((Array.isArray(collops) ? collops : [])
    .filter((o) => o && ['pop', 'popleft', 'heappop'].includes(o.op) && o.ret !== undefined && typeof o.n === 'string')
    .map((o) => o.n));

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
    frontier(snaps, varName) {
      const arrays = snaps.filter(Array.isArray);
      if (arrays.length < 2) return false;
      if (!arrays.every((s) => s.every((m) => isNodeVal(m) || (Array.isArray(m) && m.some(isNodeVal))))) return false;
      if (releaseVars.has(varName)) return true; // recorded releases prove the role outright
      // The pure-cycle Kahn queue: born empty, dies empty — kept only when the indegree
      // table survived its own behavior check, because that is the evidence the zero-take
      // cycle story rests on. (Frontier roles validate AFTER indegree — see the sort below.)
      if (roles.indegree && arrays.every((s) => s.length === 0)) return true;
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

  // Frontier roles validate LAST: the always-empty-queue acceptance reads roles.indegree,
  // so indegree must have passed (or been dropped) before any frontier role is judged.
  const entries = Object.entries(roles)
    .sort(([a], [b]) => Number(a === 'pq' || a === 'queue' || a === 'stack') - Number(b === 'pq' || b === 'queue' || b === 'stack'));
  for (const [role, varName] of entries) {
    const check = role === 'pq' || role === 'queue' || role === 'stack' ? behaves.frontier : behaves[role];
    if (!check) continue;
    if (!check(snapsOf(varName), varName)) delete roles[role];
  }
}

// compileGraphWalk({ events, result, code, entry?, graph, lens, collops?, language })
// events/result: from parseLineEvents (line-simulator run). graph: the declared views.graph
// (node ids MUST equal the node keys the student's code uses). lens: role -> variable name.
// collops (optional, ADDITIVE): the recorder's direct collection-operation events
// (q.popleft()/q.append(x)/seen.add(x)), each re-indexed by the caller so `at` points into
// THIS events array — the evidence channel the BFS cockpit and its invariants read.
export function compileGraphWalk({ events, result, code, entry = null, graph, lens = {}, mask = null, collops = null, language = 'python' } = {}) {
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
  dropMisdeclaredRoles(roles, events, graph, collops);
  if (Object.keys(roles).length === 0) {
    throw new Error('none of the declared lens roles match the recorded behavior (a visited set must grow with node members; a frontier must grow AND shrink; a dist table must be a node-keyed dict) — output "auto": {"entry": ...} instead and let the engine derive the roles from the run itself');
  }
  const lensNames = new Set(Object.values(roles));

  const ids = new Set(nodes.map((n) => String(n.id)));
  // Orientation-agnostic membership (a relaxation can only light an edge that EXISTS between
  // the two nodes — direction of travel may legitimately oppose a directed edge on returns).
  // Direction law: a traversal/relaxation on a DIRECTED graph may only light the declared
  // forward orientation (a reverse ride is a return and must be marked; the walk compiler
  // never emits returns, so it simply refuses the highlight). Undirected: either way.
  const forwardPairs = new Set(edges.map((e) => `${String(e.from)}>${String(e.to)}`));
  const edgePairs = graph.directed === false
    ? new Set(edges.flatMap((e) => [`${String(e.from)}>${String(e.to)}`, `${String(e.to)}>${String(e.from)}`]))
    : forwardPairs;
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

  // ═══ BFS TEACHING COCKPIT (2026-07-28, trace-proven side-state) ═══
  // When the recording carries DIRECT queue operations for the declared FIFO frontier
  // (q.popleft()/q.append(x) collops from the universal recorder), take steps gain
  // {queue, dequeued, enqueued, level} — every field read off the recorded ops, never
  // re-simulated. Stacks and heaps attach nothing (LIFO/priority order is not a queue story).
  // A member is only used when it resolves to exactly ONE node id (a scalar id, or a tuple
  // carrying exactly one) — ambiguity claims nothing.
  const nodeIdOf = (v) => {
    if (isNode(v)) return String(v);
    if (Array.isArray(v)) {
      const members = v.filter(isNode);
      if (members.length === 1) return String(members[0]);
    }
    return null;
  };
  const opsFor = (varName, ops) => (Array.isArray(collops) && varName
    ? collops.filter((o) => o && o.n === varName && ops.includes(o.op) && Number.isInteger(o.at))
      .sort((a, b) => (a.q ?? 0) - (b.q ?? 0))
    : []);
  const queueOps = frontierRole === 'queue' ? opsFor(roles.queue, ['popleft', 'append', 'appendleft']) : [];
  const dequeueOps = queueOps.filter((o) => o.op === 'popleft');
  // Evidence bar: at least one recorded dequeue and EVERY dequeue resolvable to a node —
  // a queue whose items the recorder cannot name gets no cockpit and no claims.
  const bfsEvidence = dequeueOps.length > 0 && dequeueOps.every((o) => nodeIdOf(o.ret) !== null);
  const dequeueSegs = []; // per recorded dequeue: { node, at, enqueued: [node ids] }
  const seedEnqueues = [];
  if (bfsEvidence) {
    let seg = null;
    for (const o of queueOps) {
      if (o.op === 'popleft') {
        seg = { node: nodeIdOf(o.ret), at: o.at, enqueued: [] };
        dequeueSegs.push(seg);
      } else {
        const nid = nodeIdOf(o.arg);
        if (nid === null) continue;
        if (seg) seg.enqueued.push(nid); else seedEnqueues.push(nid);
      }
    }
    // HARD INVARIANT — every inspected edge exists in the recorded adjacency: a node may
    // only join the queue while X is being processed if the declared graph actually connects
    // X and that node (orientation-agnostic membership: reverse-graph walks like eventual-
    // safe-states legitimately ride the declared edges backwards; a connection that exists
    // in NO orientation is invented, and the compiler refuses to ship it).
    for (const s of dequeueSegs) {
      for (const nid of s.enqueued) {
        if (!edgePairs.has(`${s.node}>${nid}`) && !edgePairs.has(`${nid}>${s.node}`)) {
          throw new Error(`graph-walk invariant violated: ${nid} was enqueued while processing ${s.node}, but no edge between ${s.node} and ${nid} exists in the recorded adjacency`);
        }
      }
    }
  }
  // BFS LEVELS, derived only from recorded queue ops + FIFO law: seeds (the frontier's first
  // recorded contents plus anything appended before the first dequeue) sit at level 0; a node
  // enqueued while X is processed sits at level[X] + 1. Unknown stays unknown — never guessed.
  const levelOf = new Map();
  if (bfsEvidence) {
    const firstSight = events.map((e) => (e.locals && typeof e.locals === 'object' ? e.locals[roles.queue] : undefined)).find(Array.isArray) ?? [];
    for (const item of firstSight) {
      const nid = nodeIdOf(item);
      if (nid !== null) levelOf.set(nid, 0);
    }
    for (const nid of seedEnqueues) if (!levelOf.has(nid)) levelOf.set(nid, 0);
    for (const s of dequeueSegs) {
      const base = levelOf.get(s.node);
      if (base === undefined) continue;
      for (const nid of s.enqueued) if (!levelOf.has(nid)) levelOf.set(nid, base + 1);
    }
  }
  // ═══ KAHN COCKPIT (2026-07-28): an indegree countdown + FIFO frontier is Kahn's shape —
  // steps additionally carry {indegree, topoOrder, dropped}, all read from the recorded
  // dict/counter mutations and queue ops the loop below already diffs. The cycle gate at the
  // bottom is Kahn's own termination proof, applied to the recording.
  const kahnShaped = Boolean(roles.indegree) && frontierRole === 'queue';
  const nodeIndegree = (src) => Object.fromEntries(
    Object.entries(src ?? {}).filter(([k]) => isNode(k)).map(([k, v]) => [String(k), Number(v)]),
  );

  // HARD INVARIANT — a node is marked visited only at its RECORDED discovery: when the
  // recording carries visited.append/seen.add ops, every member the compiler finalizes must
  // either be in the visited collection's first recorded sighting or have a recorded
  // discovery op at-or-before the event where it appears.
  const visitedOps = opsFor(roles.visited, ['append', 'add']);
  const discoveryAt = new Map(); // node id -> earliest recorded discovery event index
  for (const o of visitedOps) {
    const nid = nodeIdOf(o.arg);
    if (nid !== null && !discoveryAt.has(nid)) discoveryAt.set(nid, o.at);
  }
  const initialVisited = new Set();
  if (visitedOps.length > 0) {
    const firstVis = events.map((e) => (e.locals && typeof e.locals === 'object' ? e.locals[roles.visited] : undefined)).find(Array.isArray) ?? [];
    for (const m of firstVis) {
      const nid = nodeIdOf(m);
      if (nid !== null) initialVisited.add(nid);
    }
  }

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
  let maskNow = null; // latest recorded mask value (state-compression walks)
  const maskBitsOf = (m, bits) => Array.from({ length: bits }, (_, b) => b).filter((b) => (m >> b) & 1).map(String);
  let current = null;
  // A take is only REAL once claimed post-build: the build loop leaves its iteration variable
  // behind (u=3 after `for u,v in times`), and the first algorithm event must not narrate that
  // leftover as "taken from the frontier" nor attribute relaxations "through" it.
  let currentClaimed = false;
  let everTaken = false; // no take yet -> dist writes are SETUP, never relaxations
  let seededAfterBuild = buildEndIndex < 0; // no build phase -> nothing stale to absorb
  const visitOrder = []; // finalize ORDER is ours to track — sets are unordered (research pitfall)
  const processedOrder = []; // CLAIMED takes in event order — checked against the recorded dequeues
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
    ...(maskNow !== null ? { maskState: { mask: maskNow, bits: mask.bits, binary: maskNow.toString(2).padStart(mask.bits, '0'), visited: maskBitsOf(maskNow, mask.bits) } } : {}),
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
    let cockpit = null; // BFS cockpit fields for THIS step (additive, evidence-gated)
    if (isNode(curRaw) && String(curRaw) !== current) {
      current = String(curRaw);
      currentClaimed = true;
      everTaken = true;
      processedOrder.push(current);
      // HARD INVARIANT — dequeue order === recorded execution order: the K-th claimed take
      // must be the K-th node the recorded popleft actually released. A recording where the
      // two disagree is corrupted evidence, and no step may be narrated from it.
      if (bfsEvidence && dequeueSegs.length >= processedOrder.length) {
        const expected = dequeueSegs[processedOrder.length - 1].node;
        if (expected !== current) {
          throw new Error(`graph-walk invariant violated: the recorded dequeue order releases ${expected} at position ${processedOrder.length}, but execution processed ${current} there`);
        }
      }
      emit('visit', { semanticRole: 'frontier_take', target: { entityId: `graphNode:${current}` } });
      const distNow = plainObj(locals[roles.dist]);
      // The queue beat rides the take when the recorded segment backs it: dequeued/enqueued/
      // level are facts of the collops channel, and the narration names the joining nodes.
      const seg = bfsEvidence ? dequeueSegs[processedOrder.length - 1] : null;
      if (seg && seg.node === current) {
        cockpit = {
          dequeued: current,
          enqueued: [...seg.enqueued],
          ...(levelOf.has(current) ? { level: levelOf.get(current) } : {}),
        };
      }
      parts.push(narrateTake({
        node: name(current),
        via: frontierRole === 'stack' ? 'stack' : frontierRole ? 'queue' : null,
        dist: distNow?.[curRaw],
        joined: cockpit ? cockpit.enqueued.map(name) : null,
      }));
    }

    // RELAX: the distance table changed — old -> new per node, first change lights its edge.
    const dist = plainObj(locals[roles.dist]);
    if (dist) {
      const changes = Object.entries(dist).filter(([k, v]) => isNode(k) && JSON.stringify(knownDist[k]) !== JSON.stringify(v));
      for (const [k, v] of changes.slice(0, 3)) {
        // "Through X we reach Y" only when X is a CLAIMED take — a stale build-loop leftover
        // must not be credited with relaxations (the dist init reads as the table starting).
        parts.push(narrateRelax({ from: currentClaimed && current && String(k) !== current ? name(current) : null, to: name(k), oldValue: knownDist[k], newValue: v, everTaken }));
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
          // HARD INVARIANT — visited only at its RECORDED discovery: with visited-collection
          // ops in the recording, a member with neither an initial-sighting seat nor a
          // recorded append/add at-or-before this event was never discovered — refuse it.
          if (visitedOps.length > 0 && !initialVisited.has(String(m))) {
            const disc = discoveryAt.get(String(m));
            if (disc === undefined || disc > evIndex) {
              throw new Error(`graph-walk invariant violated: ${String(m)} appears in the visited set with no recorded discovery (no ${roles.visited}.append/.add op at or before this moment)`);
            }
          }
          visitOrder.push(String(m));
          parts.push(narrateFinalize({ node: name(m) }));
          emit('finalize', { target: { entityId: `graphNode:${String(m)}` } });
          // Finalization PROVES processing: when the stale-seeded current coincides with the
          // algorithm's real first node (so no change-based take fired), the visited growth
          // is the evidence that claims it — relaxations may now attribute and light edges.
          if (!currentClaimed && current === String(m)) {
            currentClaimed = true;
            processedOrder.push(current);
          }
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
    let droppedNow = null; // Kahn cockpit: this step's recorded countdowns, with attribution
    if (indegRaw && prevIndegree) {
      const drops = Object.entries(indegRaw).filter(([k, v]) => isNode(k) && Number(v) < Number(prevIndegree[k] ?? Infinity));
      for (const [k, v] of drops.slice(0, 3)) {
        parts.push(narrateIndegree({ node: name(k), value: v }));
        emit('write', { semanticRole: 'indegree_drop', target: { entityId: `graphNode:${String(k)}`, field: roles.indegree }, before: prevIndegree[k], after: v });
      }
      // `from` = the node whose processing satisfied the edge — only a CLAIMED current may
      // be credited (the same attribution law relaxations follow); otherwise null, not a guess.
      if (kahnShaped && drops.length > 0) {
        droppedNow = drops.map(([k]) => ({ node: String(k), from: currentClaimed && current && current !== String(k) ? current : null }));
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

    // MASK (state-compression): the latest recorded mask rides the step; a CHANGED mask is
    // narrated with its meaning — the mockups' "mask 01101 -> visited {0,2,3}" readout.
    if (mask && Number.isInteger(locals[mask.name])) {
      const m = locals[mask.name];
      if (m !== maskNow) {
        maskNow = m;
        const bits = maskBitsOf(m, mask.bits);
        parts.push(`The state mask is now ${m.toString(2).padStart(mask.bits, '0')} (${m}) — nodes {${bits.join(', ')}} are covered by this path${m === mask.target ? '; that is EVERY node, the target mask, so this state is the answer' : ''}.`);
        emit('state_transition', { semanticRole: 'mask_update', target: { entityId: `collection:mask` }, after: m });
      }
    }

    // FRONTIER: always shown when declared; a pure frontier change is still a visible moment.
    let frontier = null;
    const frontierRaw = frontierRole ? locals[roles[frontierRole]] : null;
    if (Array.isArray(frontierRaw)) {
      frontier = displayFrontier(frontierRaw);
      // Cockpit queue contents = the frontier as RECORDED at this event (post-dequeue for a
      // take step — line events fire before their line runs, so the pop is already visible).
      if (bfsEvidence && cockpit) cockpit.queue = [...frontier];
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
    // Kahn cockpit fields ride EVERY emitted step of a Kahn-shaped walk: the live indegree
    // table, the topological strip built so far, and this step's recorded countdowns.
    if (kahnShaped) {
      cockpit = cockpit ?? {};
      if (prevIndegree) cockpit.indegree = nodeIndegree(prevIndegree);
      cockpit.topoOrder = [...processedOrder];
      if (droppedNow) cockpit.dropped = droppedNow;
    }
    const stepOut = snap({ line, explanation: parts.join(' '), activeEdge, frontier, variables, events: stepEvents });
    // Cockpit passthrough (ADDITIVE — a new optional field; renderers that do not know it
    // are unaffected): BFS {queue, dequeued, enqueued, level} + Kahn {indegree, topoOrder,
    // dropped}, all recorded-op facts.
    if (cockpit) stepOut.cockpit = cockpit;
    // CallFrame channel passthrough (B3): the live stack + the most recent completed frame.
    if (Array.isArray(ev.frames) && ev.frames.length) {
      stepOut.frames = ev.frames;
      if (ev.lastReturn) stepOut.lastReturn = ev.lastReturn;
    }
    steps.push(stepOut);
  }
  if (steps.length === 0) throw new Error('graph walk saw no lensed state change — check the lens variable names against the code');

  // KAHN CYCLE GATE (2026-07-28): Kahn's own termination proof, applied to the recording —
  // the run ended (NOT truncated: a capped recording stops early and proves nothing) with
  // fewer scheduled nodes than the graph has, so the leftover nodes wait on incoming edges
  // that can never be satisfied. A distinct 'cycle' phase step names them, and the terminal
  // step carries cycleDetected so the close cannot read like a completed order.
  // Zero-take fix (external audit 2026-07-28, verified live): the old `processedOrder.length
  // > 0` guard made the WORST cycle — a pure cycle, where NO node ever reaches indegree 0 and
  // the queue is born empty — the one case the gate could not see. Scheduled nodes are now
  // counted from claimed takes ∪ RECORDED dequeues (a misassigned walker can under-claim;
  // recorded releases cannot), and the queue must be SEEN drained in its last sighting — a
  // run that left the loop with work still waiting proves an early break, not a cycle.
  const scheduled = new Set(processedOrder);
  for (const o of dequeueOps) {
    const nid = nodeIdOf(o.ret);
    if (nid !== null) scheduled.add(nid);
  }
  const queueSeenDrained = prevFrontier === '[]';
  // COMPLETENESS: Kahn's proof also needs every scheduled node's out-edges COUNTED DOWN — an
  // early `break` can leave the queue empty without doing that work, and the leftover nodes
  // are then interrupted, not cyclic. The recorded countdown total must equal the scheduled
  // nodes' total out-degree, or the gate refuses the claim (fail closed, never a false CYCLE).
  let recordedDrops = 0;
  if (kahnShaped) {
    const indegSnaps = events
      .map((e) => (e.locals && typeof e.locals === 'object' ? e.locals[roles.indegree] : undefined))
      .filter((v) => v !== undefined && v !== null);
    for (let i = 1; i < indegSnaps.length; i += 1) {
      const prev = indegSnaps[i - 1];
      const cur = indegSnaps[i];
      if (Array.isArray(prev) && Array.isArray(cur)) {
        for (let k = 0; k < cur.length; k += 1) {
          if (typeof prev[k] === 'number' && typeof cur[k] === 'number' && cur[k] < prev[k]) recordedDrops += prev[k] - cur[k];
        }
      } else if (plainObj(prev) && plainObj(cur)) {
        for (const [k, v] of Object.entries(cur)) {
          if (typeof prev[k] === 'number' && typeof v === 'number' && v < prev[k]) recordedDrops += prev[k] - v;
        }
      }
    }
  }
  const outDeg = new Map(nodes.map((n) => [String(n.id), 0]));
  for (const e of edges) outDeg.set(String(e.from), (outDeg.get(String(e.from)) ?? 0) + 1);
  const expectedDrops = [...scheduled].reduce((s, id) => s + (outDeg.get(id) ?? 0), 0);
  const kahnCycle = kahnShaped && !truncated && queueSeenDrained
    && recordedDrops === expectedDrops && scheduled.size < nodes.length;
  if (kahnCycle) {
    const leftover = nodes.map((n) => String(n.id)).filter((id) => !scheduled.has(id));
    const cyc = snap({
      line: steps[steps.length - 1].line,
      explanation: scheduled.size === 0
        ? `CYCLE DETECTED — Kahn's own termination proof, before a single step: not one of the ${nodes.length} nodes starts at indegree 0, so the queue is empty from the very first moment and nothing can ever be scheduled. ${leftover.map(name).join(', ')} all wait on an incoming edge — every node is someone else's prerequisite, a closed ring of waiting. That is a cycle, and no topological order exists at all.`
        : `CYCLE DETECTED — Kahn's own termination proof: the queue is empty, yet only ${scheduled.size} of ${nodes.length} nodes ever reached indegree 0. ${leftover.map(name).join(', ')} still wait on incoming edges that can never be satisfied, because they point at one another — that is a cycle, so no topological order exists. The strip built so far (${processedOrder.map(name).join(' → ')}) is the largest order the acyclic part of this graph allows.`,
      frontier: [],
      variables: {},
      events: [{ eventType: 'state_transition', semanticRole: 'cycle_detected', target: { entityId: 'collection:queue' }, after: leftover }],
    });
    cyc.phase = 'cycle';
    cyc.cockpit = {
      cycleDetected: true,
      topoOrder: [...processedOrder],
      ...(prevIndegree ? { indegree: nodeIndegree(prevIndegree) } : {}),
    };
    steps.push(cyc);
  }

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
  const doneStep = snap({
    line: steps[steps.length - 1].line,
    explanation: narrateDone({ result, orderNames: visitOrder.map(name), truncated, cycle: kahnCycle }),
    frontier: null,
    variables: {},
    events: [{ eventType: 'solution_emit', after: result }],
  });
  if (kahnShaped) {
    doneStep.cockpit = { topoOrder: [...processedOrder], ...(kahnCycle ? { cycleDetected: true } : {}) };
  }
  steps.push(doneStep);

  return validateExecutionTrace({
    language,
    code: String(code ?? ''),
    views: {
      graph: { nodes, edges, directed: graph.directed !== false },
      ...(mask ? { bitmask: { bits: mask.bits, target: mask.target } } : {}),
    },
    steps,
  }, 'graph-walk trace');
}
