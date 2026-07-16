// ProblemStructureSpec (contract 0 of the cockpit-composition architecture, locked
// 2026-07-16): the FORMAL read of what persistently exists in a trace, with a TYPED IDENTITY
// for every visual entity. The invariant it serves is already engine law — trace.views is
// declared once and steps only reference it — but bindings and layout policy need more than
// the law: they need to ask "does graphNode:4 exist?" and "what KIND of structure is primary?"
// without re-deriving it from raw views each time.
//
// Typed ids exist because graph node 4, array index 4 and call frame 4 are NOT the same
// object (reviewer requirement): a binding that says "4" can resolve to the wrong thing; a
// binding that says "graphNode:4" cannot.
//
// Additive layer: views stay the wire format; this module never mutates a trace.

// entityId('graphNode', 4) -> "graphNode:4" · entityId('gridCell', 1, 2) -> "gridCell:1:2"
// entityId('edge', 4, 6) -> "edge:4->6" (edges read as from->to, their natural notation).
export function entityId(type, ...parts) {
  if (!type || parts.length === 0) throw new Error('entityId needs a type and at least one part');
  if (type === 'edge') {
    if (parts.length !== 2) throw new Error('edge entity ids are edge:<from>-><to>');
    return `edge:${String(parts[0])}->${String(parts[1])}`;
  }
  return `${type}:${parts.map(String).join(':')}`;
}

export function parseEntityId(id) {
  if (typeof id !== 'string') return null;
  if (id.startsWith('edge:')) {
    const m = id.slice(5).split('->');
    if (m.length !== 2 || !m[0] || !m[1]) return null;
    return { type: 'edge', from: m[0], to: m[1] };
  }
  const parts = id.split(':');
  if (parts.length < 2 || !parts[0] || parts.slice(1).some((p) => p === '')) return null;
  return { type: parts[0], parts: parts.slice(1) };
}

// The persistent structure kinds a trace can declare, in PRIMARY order — when several views
// coexist (array + graph), the structurally richest one leads the layout.
const KIND_ORDER = ['graph', 'grid', 'intervals', 'list', 'array'];

// structureSpecFrom(trace) -> {
//   kind: 'graph'|'grid'|'intervals'|'list'|'array'|null,   // primary structure (null = pure line trace)
//   views: [{kind, meta, entities: [typedId]}],
//   entities: Set<typedId>                                   // union across views
// }
export function structureSpecFrom(trace) {
  const views = trace?.views ?? {};
  const specs = [];

  if (views.graph) {
    const nodes = views.graph.nodes ?? [];
    const edges = views.graph.edges ?? [];
    const labels = nodes.map((n) => String(n.label ?? n.id));
    specs.push({
      kind: 'graph',
      meta: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        directed: views.graph.directed !== false,
        // chooseLayout policy inputs (dense/long-label graphs route to a stronger engine).
        avgLabelLength: labels.length ? labels.reduce((a, l) => a + l.length, 0) / labels.length : 0,
      },
      entities: [
        ...nodes.map((n) => entityId('graphNode', n.id)),
        ...edges.map((e) => entityId('edge', e.from, e.to)),
      ],
    });
  }
  if (views.array2d) {
    const { rows, cols } = views.array2d;
    const entities = [];
    for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) entities.push(entityId('gridCell', r, c));
    specs.push({ kind: 'grid', meta: { rows, cols }, entities });
  }
  if (views.intervals) {
    const list = views.intervals.intervals ?? [];
    specs.push({ kind: 'intervals', meta: { count: list.length }, entities: list.map((_, i) => entityId('interval', i)) });
  }
  if (views.list) {
    const nodes = views.list.nodes ?? [];
    specs.push({ kind: 'list', meta: { length: nodes.length }, entities: nodes.map((n) => entityId('listNode', n.id)) });
  }
  if (views.array) {
    const values = views.array.values ?? [];
    specs.push({ kind: 'array', meta: { length: values.length }, entities: values.map((_, i) => entityId('arrayCell', i)) });
  }

  specs.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  return {
    kind: specs[0]?.kind ?? null,
    views: specs,
    entities: new Set(specs.flatMap((s) => s.entities)),
  };
}

// The typed entities one STEP references (what changes), for the invariant check
// "references ⊆ structure" — the mechanical form of "StructureSpec defines what exists,
// TraceEvent defines what changes".
export function stepEntityRefs(step) {
  const refs = new Set();
  if (!step || typeof step !== 'object') return refs;
  const g = step.graph;
  if (g?.current != null) refs.add(entityId('graphNode', g.current));
  for (const v of g?.visited ?? []) refs.add(entityId('graphNode', v));
  for (const nid of Object.values(g?.pointers ?? {})) refs.add(entityId('graphNode', nid));
  if (Array.isArray(step.activeEdge) && step.activeEdge.length === 2) {
    refs.add(entityId('edge', step.activeEdge[0], step.activeEdge[1]));
  }
  for (const nid of Object.keys(step.nodeState ?? {})) refs.add(entityId('graphNode', nid));
  const a2 = step.array2d;
  for (const cell of a2?.highlight ?? []) {
    if (Array.isArray(cell) && cell.length === 2) refs.add(entityId('gridCell', cell[0], cell[1]));
  }
  if (Array.isArray(a2?.write) && a2.write.length === 2) refs.add(entityId('gridCell', a2.write[0], a2.write[1]));
  const arr = step.array;
  if (Number.isInteger(arr?.current)) refs.add(entityId('arrayCell', arr.current));
  for (const idx of Object.values(arr?.pointers ?? {})) {
    if (Number.isInteger(idx)) refs.add(entityId('arrayCell', idx));
  }
  return refs;
}
