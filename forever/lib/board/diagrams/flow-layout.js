// Flowchart/cycle -> React Flow nodes+edges with dagre positions (pure, tested). The fix for
// the live-reported cramped/cut diagrams: Mermaid clips long labels (a flowchart step carrying
// real math like "z = 1.5×4 + 1.0×2 − 4 = 4" gets truncated in a hand-drawn node); React Flow
// nodes are HTML — text WRAPS, boxes grow, dagre spaces them, and the student can drag/zoom.
// Mermaid stays for what it is genuinely good at (sequence/state/class/ER from code).

import dagre from '@dagrejs/dagre';

const NODE_W = 240;
const LINE_H = 20;
const PAD_V = 26;

function asLabel(step) {
  if (typeof step === 'string') return step;
  return String(step?.label ?? step?.text ?? step?.id ?? '');
}

// Estimate node height from wrapped text so dagre reserves REAL space (no overlap): ~34 chars
// per line at the node width/font; every explicit newline starts a new line.
export function estimateNodeHeight(label) {
  const lines = String(label).split('\n')
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 34)), 0);
  return PAD_V + lines * LINE_H;
}

export function layoutFlow(content) {
  const steps = Array.isArray(content.steps) ? content.steps : [];
  const cycle = content.diagramType === 'cycle';
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'TB', nodesep: 46, ranksep: 56, marginx: 12, marginy: 12 });
  graph.setDefaultEdgeLabel(() => ({}));

  const nodes = steps.map((step, i) => {
    const id = typeof step === 'object' && step?.id ? String(step.id) : `step_${i + 1}`;
    const label = asLabel(step);
    return { id, label, height: estimateNodeHeight(label) };
  });
  for (const node of nodes) graph.setNode(node.id, { width: NODE_W, height: node.height });

  const edges = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    edges.push({ id: `e_${nodes[i].id}_${nodes[i + 1].id}`, source: nodes[i].id, target: nodes[i + 1].id });
    graph.setEdge(nodes[i].id, nodes[i + 1].id);
  }
  // A cycle closes the loop back to the start (photosynthesis, water cycle, TCP retransmit).
  if (cycle && nodes.length > 2) {
    edges.push({ id: `e_${nodes.at(-1).id}_${nodes[0].id}`, source: nodes.at(-1).id, target: nodes[0].id });
    graph.setEdge(nodes.at(-1).id, nodes[0].id);
  }

  dagre.layout(graph);

  return {
    nodes: nodes.map((node) => {
      const pos = graph.node(node.id);
      return {
        id: node.id,
        position: { x: pos.x - NODE_W / 2, y: pos.y - node.height / 2 },
        data: { label: node.label },
        width: NODE_W,
        height: node.height,
      };
    }),
    edges,
  };
}
