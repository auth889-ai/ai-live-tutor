// Structure-true diagram enforcement (pure, tested) — the researched classify-then-
// constrain pattern (DiagrammerGPT/StructEval): a concept about a tree/graph/linked
// structure must be drawn AS that structure (diagramType "graph" with real nodes/edges,
// which the renderer lays out and can animate), never flattened into a generic
// flowchart/cycle. Deterministic keyword classification on the scene brief; the Board
// Director's repair loop turns a violation into a corrected board.

const STRUCTURAL_CONCEPTS = /\b(binary\s+tree|bst|tree|trie|heap|graph|dag|linked\s+list|adjacency|node|traversal|bfs|dfs)\b/i;
const FLAT_TYPES = new Set(['flowchart', 'cycle']);

// Returns a repairable violation message, or null when the board is structure-true.
export function structureViolation(objects, brief) {
  const conceptText = `${brief?.title ?? ''} ${brief?.directive ?? ''}`;
  if (!STRUCTURAL_CONCEPTS.test(conceptText)) return null;

  const diagrams = (objects ?? []).filter((o) => o?.renderHint === 'diagram' && o.content?.diagramType);
  if (diagrams.length === 0) return null; // no diagram on this board — nothing to enforce
  const hasStructure = diagrams.some((o) => o.content.diagramType === 'graph');
  const flat = diagrams.find((o) => FLAT_TYPES.has(o.content.diagramType));
  if (hasStructure || !flat) return null;

  return (
    `object ${flat.id}: this scene teaches a linked STRUCTURE (${conceptText.match(STRUCTURAL_CONCEPTS)?.[0]}) ` +
    `but draws a ${flat.content.diagramType} — draw the real structure instead: diagramType "graph" with actual ` +
    `nodes (labels may carry values/roles like "root: 8" or "curr") and edges (labels like "left"/"right"/"next"). ` +
    `A human teacher draws the tree, not a flowchart about the tree.`
  );
}
