// Diagram layout engine (pure, deterministic). Turns a structured diagram spec into
// positioned shapes (boxes / arrows / text) inside a region — flowchart, cycle, tree,
// comparison table — the diagram types real courses use (migration flow, concept tree,
// water cycle, comparison grid from the mockups). Hand-rolled fixed-canvas layout: no heavy
// graph-layout dependency, fully testable. The renderer turns shapes -> SVG (rough.js boxes).

export const DIAGRAM_TYPES = Object.freeze(['flowchart', 'cycle', 'tree', 'comparison']);

const BOX_H = 46;
const GAP_X = 28;
const PALETTE = ['#c0392b', '#2e86c1', '#27ae60', '#8e44ad', '#d35400', '#16a085'];

export function layoutDiagram(content, region) {
  if (!DIAGRAM_TYPES.includes(content.diagramType)) {
    throw new Error(`Unknown diagramType: ${content.diagramType}`);
  }
  switch (content.diagramType) {
    case 'flowchart':
      return flowchart(content.steps ?? [], region, false);
    case 'cycle':
      return flowchart(content.steps ?? [], region, true);
    case 'tree':
      return tree(content.root, region);
    case 'comparison':
      return comparison(content, region);
    default:
      return [];
  }
}

// Horizontal steps with arrows; cycle adds a return arrow underneath.
function flowchart(steps, region, isCycle) {
  if (!steps.length) throw new Error('flowchart/cycle needs steps');
  const n = steps.length;
  const boxW = Math.max(70, Math.floor((region.w - (n - 1) * GAP_X) / n));
  const y = region.y + 20;
  const shapes = [];
  const centers = [];
  steps.forEach((step, i) => {
    const x = region.x + i * (boxW + GAP_X);
    shapes.push({ kind: 'box', x, y, w: boxW, h: BOX_H, label: String(step), color: PALETTE[i % PALETTE.length] });
    centers.push({ x: x + boxW, cx: x + boxW / 2, y: y + BOX_H / 2, left: x });
    if (i > 0) {
      const prev = centers[i - 1];
      shapes.push({ kind: 'arrow', x1: prev.x, y1: prev.y, x2: x, y2: y + BOX_H / 2 });
    }
  });
  if (isCycle && n > 1) {
    const first = centers[0];
    const last = centers[n - 1];
    const loopY = y + BOX_H + 26;
    shapes.push({ kind: 'arrow', x1: last.cx, y1: y + BOX_H, x2: last.cx, y2: loopY });
    shapes.push({ kind: 'arrow', x1: last.cx, y1: loopY, x2: first.cx, y2: loopY });
    shapes.push({ kind: 'arrow', x1: first.cx, y1: loopY, x2: first.cx, y2: y + BOX_H });
  }
  return shapes;
}

// Simple top-down tree: root centered, children spread evenly on the next row.
function tree(root, region) {
  if (!root) throw new Error('tree needs a root');
  const shapes = [];
  const rootW = 150;
  const rootX = region.x + region.w / 2 - rootW / 2;
  const rootY = region.y + 16;
  shapes.push({ kind: 'box', x: rootX, y: rootY, w: rootW, h: BOX_H, label: String(root.label), color: PALETTE[0] });

  const children = root.children ?? [];
  if (children.length) {
    const childW = Math.max(70, Math.floor((region.w - (children.length - 1) * GAP_X) / children.length));
    const childY = rootY + BOX_H + 50;
    children.forEach((child, i) => {
      const x = region.x + i * (childW + GAP_X);
      shapes.push({ kind: 'box', x, y: childY, w: childW, h: BOX_H, label: String(child.label), color: PALETTE[(i + 1) % PALETTE.length] });
      shapes.push({ kind: 'arrow', x1: rootX + rootW / 2, y1: rootY + BOX_H, x2: x + childW / 2, y2: childY });
      if (child.detail) shapes.push({ kind: 'text', x: x + childW / 2, y: childY + BOX_H + 16, text: String(child.detail), anchor: 'middle', size: 14 });
    });
  }
  return shapes;
}

// Comparison grid: columns across the top, rows below.
function comparison(content, region) {
  const columns = content.columns ?? [];
  const rows = content.rows ?? [];
  if (!columns.length || !rows.length) throw new Error('comparison needs columns and rows');
  const labelW = Math.floor(region.w * 0.34);
  const colW = Math.floor((region.w - labelW) / columns.length);
  const rowH = 34;
  const shapes = [];
  columns.forEach((col, c) => {
    shapes.push({ kind: 'text', x: region.x + labelW + c * colW + colW / 2, y: region.y + 20, text: String(col), anchor: 'middle', size: 16, bold: true });
  });
  rows.forEach((row, r) => {
    const y = region.y + 34 + r * rowH;
    shapes.push({ kind: 'text', x: region.x, y: y + 20, text: String(row.label), size: 15 });
    (row.values ?? []).forEach((value, c) => {
      shapes.push({ kind: 'text', x: region.x + labelW + c * colW + colW / 2, y: y + 20, text: String(value), anchor: 'middle', size: 15 });
    });
    shapes.push({ kind: 'rule', x1: region.x, y1: y + rowH - 6, x2: region.x + region.w, y2: y + rowH - 6 });
  });
  return shapes;
}
