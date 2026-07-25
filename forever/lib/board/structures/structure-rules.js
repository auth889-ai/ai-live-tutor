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
  // GRID-AS-GRAPH (live screenshot: a 3x4 DP table drawn as scattered coordinate boxes):
  // a node-edge diagram whose labels are mostly (r,c) coordinate tuples IS a matrix concept —
  // reject it toward diagramType "grid" with the real cell values.
  const coordish = /^\(?\s*\d+\s*,\s*\d+\s*\)?/;
  for (const o of objects ?? []) {
    if (o?.renderHint !== 'diagram' || o.content?.diagramType !== 'graph') continue;
    const nodes = o.content.nodes ?? [];
    if (nodes.length >= 4) {
      const coordLabeled = nodes.filter((n) => coordish.test(String(n.label ?? n.id ?? '').replace(/^[A-Za-z]+\s*/, ''))).length;
      if (coordLabeled / nodes.length >= 0.6) {
        return `object ${o.id}: a grid/matrix concept is drawn as a node-edge graph of coordinate boxes — draw the MATRIX itself instead: diagramType "grid" with rows = the real 2D cell values ('' for unfilled), optional rowLabels/colLabels, and "highlight" on the cells being discussed. A table is a table, never scattered nodes.`;
      }
    }
  }
  // SLIDE-ALONE RULE (user requirement 2026-07-26: "explain like a real human tutor, not
  // just reading the slide"): a source figure may never be the whole board. A real tutor
  // shows the figure AND writes their own notes beside it — takeaways in their own words,
  // the trap to avoid, a simplifying mini-table. Deterministic and repairable.
  const images = (objects ?? []).filter((o) => o?.renderHint === 'image');
  if (images.length > 0) {
    const NOTE_HINTS = new Set(['text', 'list', 'callout', 'table', 'math', 'timeline', 'code', 'diagram']);
    const hasTutorNotes = (objects ?? []).some((o) => {
      if (!NOTE_HINTS.has(o?.renderHint) || o.objectType === 'scene_title' || o.decorative) return false;
      const body = typeof o.content === 'string' ? o.content : JSON.stringify(o.content ?? '');
      return body.length >= 40; // a real note, not a caption fragment
    });
    if (!hasTutorNotes) {
      return (
        `object ${images[0].id}: this board shows a source figure with NO tutor notes — a slide alone ` +
        `is reading, not teaching. ADD your own notes object beside the figure: a "list" of 2-4 key ` +
        `takeaways IN YOUR OWN WORDS, or a "callout" naming the common trap, or a small "table" that ` +
        `simplifies what the figure shows — derived from the figure and the source chunks, never a ` +
        `transcription of the image.`
      );
    }
  }

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
