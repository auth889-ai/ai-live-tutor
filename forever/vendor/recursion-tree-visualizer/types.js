// VENDORED from brpapa/recursion-tree-visualizer (MIT) — lambda/src/types.ts.
// TypeScript type declarations ported to JSDoc typedefs; runtime-free, kept as the single
// written-down contract for the node model every vendored file (and the Forever adapter)
// speaks. See SOURCE.md in this directory for provenance.

/**
 * @typedef {Object} Vertex
 * @property {any[]} argsList  vertices[u].argsList: array of param values of vertex u
 * @property {{ childId: number, weight?: any }[]} adjList
 *   vertices[u].adjList: [{childId, weight}, ...], where u -w-> childId and w is the value
 *   fn(...vertices[childId].argsList) returned to u
 * @property {boolean} memoized  was this vertex answered from memory?
 */

/**
 * @typedef {Record<number, Vertex>} Vertices
 * Key: vertex id — the callId; an edge u -> v exists ONLY because call v opened while call u
 * was the innermost open frame (the caller/callee relationship, recorded, never inferred).
 */

/** @typedef {{ vertices: Vertices, fnResult: any }} InitialTree */

/** @typedef {[number, number]} Point  [x,y] */

/**
 * @typedef {Object} IntermediateTree
 * @property {InitialTree} tree
 * @property {Record<number, Point>} coords  coords[u]: grid coordinate of vertex u
 * @property {Point} bottomRight
 */

export {};
