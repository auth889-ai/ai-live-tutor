// Diagram content contract (pure, tested). Validates the structured shortcuts (flowchart,
// cycle, tree, comparison, trace) AND raw Mermaid (any of Mermaid's 26 diagram types) so
// the Board Director can render sequence/class/state/ER/architecture/timeline/... diagrams.
// "Mermaid-First" (research): raw mermaid must DECLARE a known diagram type on line one.

export const STRUCTURED_TYPES = Object.freeze(['flowchart', 'cycle', 'tree', 'comparison', 'trace']);

// Diagram-type keywords Mermaid understands (first token of the code).
export const MERMAID_KEYWORDS = Object.freeze([
  'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram', 'stateDiagram-v2',
  'erDiagram', 'journey', 'gantt', 'pie', 'mindmap', 'timeline', 'sankey', 'sankey-beta',
  'requirementDiagram', 'quadrantChart', 'gitGraph', 'C4Context', 'architecture', 'architecture-beta',
  'xychart', 'xychart-beta', 'block', 'block-beta', 'packet', 'packet-beta', 'kanban', 'treemap', 'mindmap',
]);

export function validateDiagramContent(content, context = 'diagram') {
  if (!content || typeof content !== 'object') throw new Error(`${context} content must be an object`);
  const type = content.diagramType;

  if (type === 'mermaid') {
    if (typeof content.code !== 'string' || !content.code.trim()) {
      throw new Error(`${context} mermaid diagram needs a non-empty code string`);
    }
    const firstToken = content.code.trim().split(/[\s\n{(]/)[0];
    if (!MERMAID_KEYWORDS.includes(firstToken)) {
      throw new Error(`${context} mermaid code must declare a known diagram type (got "${firstToken}")`);
    }
    return content;
  }
  if (type === 'flowchart' || type === 'cycle') {
    if (!Array.isArray(content.steps) || content.steps.length === 0) throw new Error(`${context} ${type} needs steps[]`);
    return content;
  }
  if (type === 'tree') {
    if (!content.root?.label) throw new Error(`${context} tree needs root.label`);
    return content;
  }
  if (type === 'comparison' || type === 'trace') {
    if (!Array.isArray(content.columns) || !Array.isArray(content.rows)) throw new Error(`${context} ${type} needs columns[] and rows[]`);
    return content;
  }
  if (type === 'graph') {
    if (!Array.isArray(content.nodes) || content.nodes.length === 0) throw new Error(`${context} graph needs nodes[]`);
    if (!Array.isArray(content.edges)) throw new Error(`${context} graph needs edges[]`);
    const ids = new Set(content.nodes.map((n) => String(n.id)));
    for (const e of content.edges) {
      if (!ids.has(String(e.from)) || !ids.has(String(e.to))) throw new Error(`${context} graph edge references a missing node`);
    }
    // Optional traversal animation (BFS/DFS/visit order): node ids highlighted in sequence.
    if (content.highlightSequence !== undefined) {
      if (!Array.isArray(content.highlightSequence)) throw new Error(`${context} graph highlightSequence must be an array`);
      for (const nid of content.highlightSequence) {
        if (!ids.has(String(nid))) throw new Error(`${context} graph highlightSequence references a missing node`);
      }
    }
    // Optional DRY-RUN TRACE: the algorithm walking the structure step by step (VisuAlgo-style).
    // Each step is a full visual STATE — current node, visited set, named pointers (low/mid/high,
    // slow/fast) — animated on the graph and narrated. This is the real dry-run, not a static tree.
    if (content.trace !== undefined) {
      if (!Array.isArray(content.trace) || content.trace.length === 0) {
        throw new Error(`${context} graph trace must be a non-empty array of steps`);
      }
      content.trace.forEach((step, i) => {
        if (!step || typeof step !== 'object') throw new Error(`${context} graph trace step ${i} must be an object`);
        if (typeof step.note !== 'string' || !step.note.trim()) throw new Error(`${context} graph trace step ${i} needs a note`);
        if (step.current !== undefined && step.current !== null && !ids.has(String(step.current))) {
          throw new Error(`${context} graph trace step ${i} current references a missing node`);
        }
        if (step.visited !== undefined) {
          if (!Array.isArray(step.visited)) throw new Error(`${context} graph trace step ${i} visited must be an array`);
          for (const nid of step.visited) if (!ids.has(String(nid))) throw new Error(`${context} graph trace step ${i} visited references a missing node`);
        }
        if (step.pointers !== undefined) {
          if (typeof step.pointers !== 'object' || Array.isArray(step.pointers)) throw new Error(`${context} graph trace step ${i} pointers must be an object`);
          for (const nid of Object.values(step.pointers)) if (!ids.has(String(nid))) throw new Error(`${context} graph trace step ${i} pointer references a missing node`);
        }
      });
    }
    return content;
  }
  throw new Error(`${context} has unknown diagramType: ${type}`);
}
