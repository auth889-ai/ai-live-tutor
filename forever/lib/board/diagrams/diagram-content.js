// Diagram content contract (pure, tested). Validates the structured shortcuts (flowchart,
// cycle, tree, comparison, trace) AND raw Mermaid (any of Mermaid's 26 diagram types) so
// the Board Director can render sequence/class/state/ER/architecture/timeline/... diagrams.
// "Mermaid-First" (research): raw mermaid must DECLARE a known diagram type on line one.

import { validateArrayContent } from '../arrays/array-content.js';

export const STRUCTURED_TYPES = Object.freeze(['flowchart', 'cycle', 'tree', 'comparison', 'trace']);

// Diagram-type keywords Mermaid understands (first token of the code).
export const MERMAID_KEYWORDS = Object.freeze([
  'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram', 'stateDiagram-v2',
  'erDiagram', 'journey', 'gantt', 'pie', 'mindmap', 'timeline', 'sankey', 'sankey-beta',
  'requirementDiagram', 'quadrantChart', 'gitGraph', 'C4Context', 'architecture', 'architecture-beta',
  'xychart', 'xychart-beta', 'block', 'block-beta', 'packet', 'packet-beta', 'kanban', 'treemap', 'mindmap',
]);

// A GRID/MATRIX concept (DP table, game board, 2D state) as a real value grid — never a
// node-edge graph (live screenshot: a 3x4 DP table drawn as scattered coordinate boxes with
// orphans floating loose). rows = 2D array of scalar cell values ('' for not-yet-filled);
// optional labels + highlighted cells. Rendered as a table-grid (the tool law: 2-D DP needs
// a grid renderer, not React Flow).
function validateGridDiagram(content, context) {
  const rows = content.rows;
  if (!Array.isArray(rows) || rows.length < 1 || !rows.every((r) => Array.isArray(r) && r.length >= 1)) {
    throw new Error(`${context} (grid) needs rows: a 2D array of cell values`);
  }
  const cols = rows[0].length;
  if (!rows.every((r) => r.length === cols)) throw new Error(`${context} (grid) rows must all have the same length`);
  if (rows.length > 24 || cols > 24) throw new Error(`${context} (grid) exceeds 24x24 — pick a smaller teaching example`);
  const scalar = (v) => ['number', 'string', 'boolean'].includes(typeof v);
  if (!rows.every((r) => r.every(scalar))) throw new Error(`${context} (grid) cells must be scalars ('' for empty)`);
  for (const key of ['rowLabels', 'colLabels']) {
    if (content[key] !== undefined && (!Array.isArray(content[key]) || !content[key].every((l) => typeof l === 'string'))) {
      throw new Error(`${context} (grid) ${key} must be an array of strings`);
    }
  }
  if (content.highlight !== undefined) {
    const ok = Array.isArray(content.highlight) && content.highlight.every((c) => Array.isArray(c) && c.length === 2
      && Number.isInteger(c[0]) && c[0] >= 0 && c[0] < rows.length && Number.isInteger(c[1]) && c[1] >= 0 && c[1] < cols);
    if (!ok) throw new Error(`${context} (grid) highlight must be in-bounds [row,col] cells`);
  }
  return content;
}

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
    if (firstToken === 'xychart' || firstToken === 'xychart-beta') validateXyChartRanges(content.code, context);
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
  if (type === 'array') return validateArrayContent(content, context);
  if (type === 'comparison' || type === 'trace') {
    if (!Array.isArray(content.columns) || !Array.isArray(content.rows)) throw new Error(`${context} ${type} needs columns[] and rows[]`);
    // Column HEADERS must be plain strings (live-caught: object headers crashed the
    // player page with duplicate React keys — coercion unwraps {name}/{label} first).
    content.columns.forEach((col, i) => {
      if (typeof col !== 'string' || !col.trim()) {
        throw new Error(`${context} ${type} column ${i} must be a non-empty STRING header (got ${JSON.stringify(col)?.slice(0, 60)})`);
      }
    });
    // Every row must FILL the table: label + one value per remaining column. A malformed
    // row (values stuffed under an arbitrary key) rendered as EMPTY CELLS in production —
    // reject it with a repairable message instead.
    const expected = content.columns.length; // columns are VALUE headers; the label column is implicit
    content.rows.forEach((row, i) => {
      if (!row || typeof row !== 'object' || typeof row.label !== 'string' || !row.label.trim()) {
        throw new Error(`${context} ${type} row ${i} needs a "label" string`);
      }
      if (!Array.isArray(row.values) || row.values.length !== expected) {
        throw new Error(
          `${context} ${type} row ${i} ("${row.label}") must have "values" as an array of exactly ${expected} entr${expected === 1 ? 'y' : 'ies'} — one per column (the label column is implicit; put cell text INSIDE values, never as extra keys)`,
        );
      }
      // EMPTY CELLS are how header mismatches ship: a model that repeats the label as a
      // column pads the last cell with "" to satisfy the count. Live-caught (Supply&Demand
      // lesson: "Quantity Supplied" column rendered blank in every row). Reject with a
      // restructure instruction, not just a refill instruction.
      row.values.forEach((cell, j) => {
        if (typeof cell !== 'string' || !cell.trim()) {
          throw new Error(
            `${context} ${type} row ${i} ("${row.label}") column "${content.columns[j] ?? j}" is empty — every cell needs real text. If a column has no data, REMOVE that column; if the row label already carries a column's value (e.g. label "$2" under a "Price" column), drop that column instead of padding cells`,
          );
        }
      });
    });
    return content;
  }
  if (type === 'graph') {
    if (!Array.isArray(content.nodes) || content.nodes.length === 0) throw new Error(`${context} graph needs nodes[]`);
    if (!Array.isArray(content.edges)) throw new Error(`${context} graph needs edges[]`);
    const ids = new Set(content.nodes.map((n) => String(n.id)));
    // Errors name the offending id AND the known ids — a repair pass can only fix what it can see.
    const known = () => `(known node ids: ${[...ids].join(', ')})`;
    for (const e of content.edges) {
      if (!ids.has(String(e.from)) || !ids.has(String(e.to))) {
        throw new Error(`${context} graph edge ${e.from}->${e.to} references a missing node ${known()}`);
      }
    }
    // Optional traversal animation (BFS/DFS/visit order): node ids highlighted in sequence.
    if (content.highlightSequence !== undefined) {
      if (!Array.isArray(content.highlightSequence)) throw new Error(`${context} graph highlightSequence must be an array`);
      for (const nid of content.highlightSequence) {
        if (!ids.has(String(nid))) throw new Error(`${context} graph highlightSequence "${nid}" references a missing node ${known()}`);
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
          throw new Error(`${context} graph trace step ${i} current "${step.current}" references a missing node ${known()}`);
        }
        if (step.visited !== undefined) {
          if (!Array.isArray(step.visited)) throw new Error(`${context} graph trace step ${i} visited must be an array`);
          for (const nid of step.visited) if (!ids.has(String(nid))) throw new Error(`${context} graph trace step ${i} visited "${nid}" references a missing node ${known()}`);
        }
        if (step.pointers !== undefined) {
          if (typeof step.pointers !== 'object' || Array.isArray(step.pointers)) throw new Error(`${context} graph trace step ${i} pointers must be an object`);
          for (const [name, nid] of Object.entries(step.pointers)) {
            if (!ids.has(String(nid))) throw new Error(`${context} graph trace step ${i} pointer "${name}":"${nid}" references a missing node ${known()}`);
          }
        }
      });
    }
    return content;
  }
  if (type === 'grid') return validateGridDiagram(content, context);
  throw new Error(
    `${context} has unknown diagramType: ${type} — use one of ${STRUCTURED_TYPES.join('/')}/graph/array/grid, or diagramType "mermaid" with the diagram source in content.code (first line declaring its Mermaid type, e.g. "xychart-beta" or "sequenceDiagram")`,
  );
}

// xychart is a LIMITED grammar (title / x-axis / y-axis / line / bar only) and silently
// renders garbage outside it. Live-caught (Supply&Demand lesson): unsupported "point"
// annotations, and a line whose values ran past the declared y-axis top. Both reject with
// instructions a repair pass can act on.
function validateXyChartRanges(code, context) {
  const nums = (text) => (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  let yMin = null;
  let yMax = null;
  for (const raw of code.split('\n').slice(1)) {
    const line = raw.trim();
    if (!line) continue;
    const keyword = line.split(/[\s"]/)[0];
    if (!['title', 'x-axis', 'y-axis', 'line', 'bar'].includes(keyword)) {
      throw new Error(
        `${context} xychart supports ONLY title/x-axis/y-axis/line/bar — "${keyword}" is not xychart syntax. Mark key points with a callout object or a labeled series instead`,
      );
    }
    if (keyword === 'y-axis') {
      const range = nums(line.includes('[') ? line.slice(line.indexOf('[')) : line);
      if (range.length >= 2) { yMin = Math.min(...range); yMax = Math.max(...range); }
    }
    if ((keyword === 'line' || keyword === 'bar') && yMin !== null && line.includes('[')) {
      const values = nums(line.slice(line.indexOf('[')));
      const outlier = values.find((v) => v < yMin || v > yMax);
      if (outlier !== undefined) {
        throw new Error(
          `${context} xychart ${keyword} value ${outlier} lies outside the declared y-axis range ${yMin}–${yMax} — extend the y-axis or fix the series data (an off-scale line renders as a lie)`,
        );
      }
    }
  }
}
