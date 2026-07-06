'use client';

// Real data-structure visualizer: React Flow renders a Dagre-laid-out graph/tree (binary
// tree, BST, graph, linked list). Clean node/edge rendering, far better than hand-drawn
// SVG. Read-only in a lesson (fitView, no drag); node-state animation (BFS/DFS) comes later.

import { useMemo } from 'react';
import { ReactFlow, Background, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { layoutGraph } from '../../../lib/board/diagrams/graph-layout.js';

export function GraphView({ content, progress = 1 }) {
  const laid = useMemo(() => {
    try {
      return layoutGraph({ nodes: content.nodes ?? [], edges: content.edges ?? [], direction: content.direction ?? 'TB' });
    } catch {
      return null;
    }
  }, [content]);

  if (!laid) return <div style={{ color: '#c0392b', fontSize: 13 }}>diagram unavailable</div>;

  // Traversal animation (BFS/DFS/visit order): reveal the highlight sequence with the clock.
  const seq = Array.isArray(content.highlightSequence) ? content.highlightSequence.map(String) : null;
  const visitedCount = seq ? Math.floor(progress * seq.length + 1e-9) : 0;
  const visited = seq ? new Set(seq.slice(0, visitedCount)) : null;
  const currentId = seq && visitedCount > 0 ? seq[visitedCount - 1] : null;

  const nodeColor = (id) => {
    if (!seq) return { border: '#c0392b', bg: '#fffdf8', fg: '#3a3327' };
    if (id === currentId) return { border: '#d35400', bg: '#ffe6cc', fg: '#8a3a12' }; // current
    if (visited.has(id)) return { border: '#27ae60', bg: '#eafaf0', fg: '#1c6b3a' }; // visited
    return { border: '#b8b0a0', bg: '#fbf8f2', fg: '#8a8172' }; // unvisited
  };

  const nodes = laid.nodes.map((n) => {
    const c = nodeColor(n.id);
    return {
      id: n.id,
      position: { x: n.x, y: n.y },
      data: { label: n.label },
      style: {
        width: n.width,
        height: n.height,
        borderRadius: 10,
        border: `2px solid ${c.border}`,
        background: c.bg,
        color: c.fg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'ui-monospace, monospace',
        fontWeight: 600,
        transition: 'background 0.3s, border-color 0.3s, color 0.3s',
      },
    };
  });
  const edges = laid.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    label: e.label,
    markerEnd: content.directed !== false ? { type: MarkerType.ArrowClosed, color: '#8a6d3b' } : undefined,
    style: { stroke: '#8a6d3b' },
  }));

  const height = Math.min(460, Math.max(200, laid.height + 40));
  return (
    <div style={{ height, border: '1px solid #e8ddc9', borderRadius: 12, background: '#fffdf8' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#efe6d3" gap={20} />
      </ReactFlow>
    </div>
  );
}
