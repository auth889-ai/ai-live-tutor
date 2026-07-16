// STABLE EVENT TAXONOMY (contract 1 completion, locked plan B2): every teaching moment a
// compiler narrates now also carries a TYPED event — a universal verb from ONE vocabulary,
// plus lens-specific meaning in `semanticRole` and a typed target (B1 entity ids). The split
// is what keeps the Semantic Visual Director reusable: a generic renderer understands
// "write"; the Tarjan cockpit's `when:` annotations understand "low_link_update" — without
// every lens inventing its own verb dialect (reviewer rule: no grid_take/graph_take/heap_take).
//
// Shape of one event (all facts recorded, never authored):
//   { eventType, semanticRole?, target?: {entityType, entityId, field?}, before?, after?,
//     provenance?: {eventIndex} }

export const EVENT_TYPES = Object.freeze([
  'read', 'write', 'compare', 'swap', 'move_pointer',
  'enqueue', 'dequeue', 'push', 'pop', 'collection_change',
  'call', 'return', 'visit', 'edge_check', 'relax', 'finalize',
  'branch', 'backtrack', 'union', 'find', 'state_transition',
  'dependency_read', 'cell_update', 'solution_emit',
]);

const TYPES = new Set(EVENT_TYPES);

// Permissive, additive validation — throws with the step context on a malformed event.
// Entity existence is checked by the caller (the trace validator owns the id sets).
export function validateStepEvents(events, at) {
  if (!Array.isArray(events)) throw new Error(`${at} events must be an array`);
  for (const e of events) {
    if (!e || typeof e !== 'object') throw new Error(`${at} event must be an object`);
    if (!TYPES.has(e.eventType)) throw new Error(`${at} unknown eventType "${e.eventType}" — use the universal vocabulary (${EVENT_TYPES.join(', ')})`);
    if (e.semanticRole !== undefined && typeof e.semanticRole !== 'string') throw new Error(`${at} semanticRole must be a string`);
    if (e.target !== undefined) {
      if (!e.target || typeof e.target !== 'object' || typeof e.target.entityType !== 'string' || e.target.entityId === undefined) {
        throw new Error(`${at} event target needs {entityType, entityId}`);
      }
    }
  }
}
