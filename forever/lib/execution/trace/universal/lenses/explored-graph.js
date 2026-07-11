// EXPLORED-GRAPH LENS — detector/compiler pair #12 of the record-once/detect-later engine:
// IMPLICIT graphs (Word Ladder, Open the Lock, Minimum Genetic Mutation), where the graph
// never exists in memory — neighbors are GENERATED on the fly, so there is no adjacency to
// detect. What the recording does hold is the causality of discovery: whichever state was
// just popped from the frontier is the PARENT of every state discovered before the next pop.
// That parent-pointer tree is the researched standard for teaching BFS exploration (the
// layer-by-layer picture every BFS guide draws), and the proven structure compiler already
// animates growing trees — nodes appearing, the cursor riding, visited accumulating.
//
// Two-signal detection, strict enough not to steal:
//   frontier = a breathing list whose members are scalar states (or tuples carrying one)
//   seen     = a monotonically GROWING collection of scalar states overlapping the frontier's
// A result accumulator does not overlap the frontier; a static word list never grows; BFS
// over a REAL adjacency also matches — and loses correctly, because graph-adjacency (0.88)
// and the other structural lenses outrank this one (0.83).

import { compileStructureTrace } from '../../structure/compiler.js';

const isScalar = (v) => typeof v === 'string' || typeof v === 'number';
// A frontier member's STATE: the member itself, or the first string (else first scalar) inside.
const stateOf = (m) => {
  if (isScalar(m)) return String(m);
  if (Array.isArray(m)) {
    const s = m.find((x) => typeof x === 'string') ?? m.find(isScalar);
    return s === undefined ? null : String(s);
  }
  return null;
};

// Decide the lens from the recording. Returns null or:
//   { lens: 'explored-graph', confidence, frontier: {name, kind}, seenVar }
export function detectExploredGraph(recording, { code = '' } = {}) {
  const lines = (recording?.events ?? []).filter((e) => e.ev === 'line');
  if (lines.length === 0) return null;
  const names = new Set(lines.flatMap((e) => Object.keys(e.locals)));

  // Breathing frontiers whose every member carries a state.
  const frontiers = [];
  for (const name of names) {
    let grew = false;
    let shrank = false;
    let statesOk = true;
    let prevLen = null;
    let sightings = 0;
    for (const e of lines) {
      const v = e.locals[name];
      if (!Array.isArray(v)) continue;
      sightings += 1;
      if (!v.every((m) => stateOf(m) !== null)) statesOk = false;
      if (prevLen !== null) {
        if (v.length > prevLen) grew = true;
        if (v.length < prevLen) shrank = true;
      }
      prevLen = v.length;
    }
    if (statesOk && grew && shrank && sightings >= 3) frontiers.push(name);
  }
  if (frontiers.length === 0) return null;

  // Growing scalar-membered seen sets; the real one OVERLAPS its frontier's states.
  let best = null;
  for (const frontierName of frontiers) {
    const frontierStates = new Set(
      lines.flatMap((e) => (Array.isArray(e.locals[frontierName]) ? e.locals[frontierName].map(stateOf) : [])),
    );
    for (const name of names) {
      if (name === frontierName) continue;
      const snaps = lines.map((e) => e.locals[name]).filter(Array.isArray);
      if (snaps.length < 2) continue;
      if (!snaps.every((s) => s.every(isScalar))) continue;
      if (!snaps.every((s, i) => i === 0 || s.length >= snaps[i - 1].length)) continue;
      const final = snaps.at(-1);
      if (final.length < 3 || final.length <= snaps[0].length) continue;
      const overlap = final.filter((x) => frontierStates.has(String(x))).length;
      if (overlap < 2) continue; // a result accumulator does not live on the frontier
      if (!best || overlap > best.overlap) {
        const kind = /\bpopleft\b|\.pop\(0\)/.test(code) ? 'queue' : 'stack';
        best = { frontierName, seenVar: name, kind, overlap };
      }
    }
  }
  if (!best) return null;
  return { lens: 'explored-graph', confidence: 0.83, frontier: { name: best.frontierName, kind: best.kind }, seenVar: best.seenVar };
}

// Rebuild the discovery tree from recorded causality, then delegate the animation.
export function compileExploredGraph({ recording, plan, code, entry = null, language = 'python' }) {
  if (!plan || plan.lens !== 'explored-graph') throw new Error('compileExploredGraph needs a plan from detectExploredGraph');
  const lines = (recording?.events ?? []).filter((e) => e.ev === 'line');
  const fifo = plan.frontier.kind === 'queue';

  const known = new Map(); // state -> {label, refs: [['child', state]]}
  const discover = (state, parent) => {
    if (state === null || known.has(state)) return;
    known.set(state, { label: state, refs: [] });
    if (parent && known.has(parent)) known.get(parent).refs.push(['child', state]);
  };

  const events = [];
  let prevFrontier = null;
  let current = null;
  for (const e of lines) {
    const frontier = Array.isArray(e.locals[plan.frontier.name]) ? e.locals[plan.frontier.name] : null;
    const seen = Array.isArray(e.locals[plan.seenVar]) ? e.locals[plan.seenVar] : null;

    // A pop moves the cursor: the departed member is the state being processed NOW —
    // everything discovered until the next pop is its child.
    if (frontier && prevFrontier && frontier.length < prevFrontier.length) {
      const gone = fifo ? prevFrontier[0] : prevFrontier[prevFrontier.length - 1];
      const state = stateOf(gone);
      if (state !== null) current = state;
    }
    if (seen) for (const m of seen) discover(String(m), current);
    if (frontier) for (const m of frontier) discover(stateOf(m), current);
    if (frontier) prevFrontier = frontier;

    if (known.size === 0) continue;
    const nodes = {};
    for (const [id, n] of known) nodes[id] = { label: n.label, refs: [...n.refs] };
    events.push({
      line: e.line,
      state: { kind: 'obj', nodes, pointers: current ? { node: current } : {} },
      variables: Object.fromEntries(Object.entries(e.locals).filter(([, v]) => ['number', 'string', 'boolean'].includes(typeof v))),
    });
  }
  if (recording?.events?.at(-1)?.truncated === true) events.push({ truncated: true });
  return compileStructureTrace({ events, result: recording.result, code, entry, language });
}
