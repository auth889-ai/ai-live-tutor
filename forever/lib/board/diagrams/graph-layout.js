// Real graph/tree layout via Dagre (pure, no DOM -> unit-tested). Turns a {nodes, edges}
// spec into positioned nodes for React Flow — proper binary-tree / BST / graph / linked-list
// layout, far better than hand-rolled. React Flow (GraphView) renders the result and can
// animate node states later (BFS/DFS/sorting).

import dagre from '@dagrejs/dagre';

const NODE_H = 44;

export function layoutGraph({ nodes = [], edges = [], direction = 'TB' } = {}) {
  if (nodes.length === 0) throw new Error('graph needs at least one node');

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: 40, ranksep: 55, marginx: 10, marginy: 10 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    const label = String(node.label ?? node.id);
    g.setNode(String(node.id), { width: Math.max(48, label.length * 10 + 24), height: NODE_H, label });
  }
  for (const edge of edges) g.setEdge(String(edge.from), String(edge.to));

  dagre.layout(g);

  return {
    nodes: nodes.map((node) => {
      const laid = g.node(String(node.id));
      return { id: String(node.id), label: String(node.label ?? node.id), x: Math.round(laid.x - laid.width / 2), y: Math.round(laid.y - laid.height / 2), width: Math.round(laid.width), height: NODE_H };
    }),
    edges: edges.map((edge, index) => ({ id: `e${index}`, from: String(edge.from), to: String(edge.to), label: edge.label ? String(edge.label) : '' })),
    width: Math.round(g.graph().width ?? 0),
    height: Math.round(g.graph().height ?? 0),
  };
}
