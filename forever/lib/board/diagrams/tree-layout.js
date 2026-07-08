// Tidy-tree layout via d3-hierarchy (Reingold–Tilford / Buchheim) — the layout trees DESERVE.
// Dagre is a layered-DAG engine: it centers a lone child under its parent, which visually lies
// about a BST (a left-only child must lean LEFT). This module lays out rooted trees with true
// child order and binary left/right fidelity: an only-child edge marked side:"left"/"right"
// gets an invisible phantom sibling on the other side, so the real child leans correctly —
// the same trick VisuAlgo's layoutTree plays. Pure data in/out (no DOM) -> unit-tested.
// Same return contract as layoutGraph, so GraphView can pick per-shape.

import { hierarchy, tree } from 'd3-hierarchy';

const NODE_H = 44;
const MARGIN = 10;

function nodeWidth(label) {
  return Math.max(48, String(label).length * 10 + 24);
}

// A rooted tree: exactly one root, every other node exactly one parent, no node reached twice
// (no cycles, no shared children), everything connected to the root.
export function isTree({ nodes = [], edges = [] } = {}) {
  if (nodes.length === 0 || edges.length !== nodes.length - 1) return false;
  const ids = new Set(nodes.map((n) => String(n.id)));
  const hasParent = new Set();
  const children = new Map();
  for (const e of edges) {
    const from = String(e.from);
    const to = String(e.to);
    if (!ids.has(from) || !ids.has(to) || hasParent.has(to)) return false;
    hasParent.add(to);
    if (!children.has(from)) children.set(from, []);
    children.get(from).push(to);
  }
  const roots = nodes.filter((n) => !hasParent.has(String(n.id)));
  if (roots.length !== 1) return false;
  const seen = new Set();
  const stack = [String(roots[0].id)];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) return false;
    seen.add(id);
    for (const child of children.get(id) ?? []) stack.push(child);
  }
  return seen.size === nodes.length;
}

// The layout SWITCH: tidy-tree only where it beats dagre — a rooted tree that actually
// BRANCHES. A pure chain (linked list) is technically a tree but reads best in dagre's
// requested direction (LR), so it stays out.
export function wantsTreeLayout(spec) {
  if (!isTree(spec)) return false;
  const childCount = new Map();
  for (const e of spec.edges) {
    const from = String(e.from);
    childCount.set(from, (childCount.get(from) ?? 0) + 1);
  }
  return [...childCount.values()].some((n) => n >= 2);
}

export function layoutTree({ nodes = [], edges = [] } = {}) {
  if (!isTree({ nodes, edges })) throw new Error('layoutTree needs a rooted tree (single root, one parent each, no cycles)');

  const byId = new Map(nodes.map((n) => [String(n.id), n]));
  const childEdges = new Map(); // parent -> [{to, side}] in emission order (tracer writes left-then-right)
  const hasParent = new Set();
  for (const e of edges) {
    const from = String(e.from);
    if (!childEdges.has(from)) childEdges.set(from, []);
    childEdges.get(from).push({ to: String(e.to), side: e.side === 'left' || e.side === 'right' ? e.side : null });
    hasParent.add(String(e.to));
  }
  const rootId = String(nodes.find((n) => !hasParent.has(String(n.id))).id);

  // Binary fidelity: a lone sided child gets a phantom sibling opposite it, so it leans its way.
  let phantomCount = 0;
  const childrenOf = (id) => {
    const kids = childEdges.get(id) ?? [];
    if (kids.length === 1 && kids[0].side) {
      const phantom = { id: `__phantom_${phantomCount += 1}`, phantom: true };
      return kids[0].side === 'left' ? [kids[0].to, phantom] : [phantom, kids[0].to];
    }
    const sided = kids.length === 2 && kids.every((k) => k.side);
    const ordered = sided ? [...kids].sort((a) => (a.side === 'left' ? -1 : 1)) : kids;
    return ordered.map((k) => k.to);
  };

  const maxW = Math.max(...nodes.map((n) => nodeWidth(n.label ?? n.id)));
  const root = hierarchy(rootId, (d) => (typeof d === 'string' ? childrenOf(d) : []).map((c) => c));
  tree().nodeSize([maxW + 28, NODE_H + 55])(root);

  const placed = root.descendants().filter((d) => typeof d.data === 'string');
  const minX = Math.min(...placed.map((d) => d.x));
  const laidNodes = placed.map((d) => {
    const node = byId.get(d.data);
    const label = String(node.label ?? node.id);
    const w = nodeWidth(label);
    return {
      id: d.data,
      label,
      x: Math.round(d.x - minX + MARGIN + (maxW - w) / 2),
      y: Math.round(d.y + MARGIN),
      width: w,
      height: NODE_H,
    };
  });

  return {
    nodes: laidNodes,
    edges: edges.map((e, index) => ({ id: `e${index}`, from: String(e.from), to: String(e.to), label: e.label ? String(e.label) : '' })),
    width: Math.max(...laidNodes.map((n) => n.x + n.width)) + MARGIN,
    height: Math.max(...laidNodes.map((n) => n.y + n.height)) + MARGIN,
  };
}
