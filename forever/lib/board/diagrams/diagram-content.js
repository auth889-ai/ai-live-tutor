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
  throw new Error(`${context} has unknown diagramType: ${type}`);
}
