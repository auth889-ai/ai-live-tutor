'use client';

// Real data-structure visualizer: React Flow renders a Dagre-laid-out graph/tree (binary
// tree, BST, graph, linked list). Clean node/edge rendering, far better than hand-drawn
// SVG. Read-only in a lesson (fitView, no drag); node-state animation (BFS/DFS) comes later.

import { useMemo } from 'react';
import { ReactFlow, Background, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { layoutGraph } from '../../../lib/board/diagrams/graph-layout.js';

export function GraphView({ content }) {
  const laid = useMemo(() => {
    try {
      return layoutGraph({ nodes: content.nodes ?? [], edges: content.edges ?? [], direction: content.direction ?? 'TB' });
    } catch {
      return null;
    }
  }, [content]);

  if (!laid) return <div style={{ color: '#c0392b', fontSize: 13 }}>diagram unavailable</div>;

  const nodes = laid.nodes.map((n) => ({
    id: n.id,
    position: { x: n.x, y: n.y },
    data: { label: n.label },
    style: {
      width: n.width,
      height: n.height,
      borderRadius: 10,
      border: '2px solid #c0392b',
      background: '#fffdf8',
      color: '#3a3327',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'ui-monospace, monospace',
      fontWeight: 600,
    },
  }));
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
