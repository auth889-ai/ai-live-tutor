'use client';

// FlowchartView — flowchart/cycle via React Flow + dagre (the cramped-Mermaid fix): HTML nodes
// WRAP long labels (real math in a step no longer clips), dagre reserves true space per node,
// and the student can pan/zoom. Progressive reveal preserved: nodes appear with the writing
// progress, in step order — the teaching rhythm the clock owns. Layout is the pure, tested
// lib/board/diagrams/flow-layout.js; this file only renders it.

import { useMemo } from 'react';
import { ReactFlow, ReactFlowProvider, Background, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { layoutFlow } from '../../../lib/board/diagrams/flow-layout.js';

const NODE_STYLE = {
  width: 240,
  padding: '10px 14px',
  borderRadius: 12,
  border: '2px solid #C9AC9E',
  background: '#FFFDFB',
  color: '#3a3327',
  fontSize: 14.5,
  lineHeight: 1.45,
  textAlign: 'center',
  whiteSpace: 'pre-wrap', // labels WRAP — the entire point of leaving Mermaid for these
  boxShadow: '0 1px 4px rgba(190,120,100,.14)',
};

export function FlowchartView({ content, progress = 1 }) {
  const laid = useMemo(() => layoutFlow(content), [content]);
  const visible = Math.max(1, Math.ceil(laid.nodes.length * progress));

  const nodes = laid.nodes.slice(0, visible).map((node, i) => ({
    ...node,
    style: { ...NODE_STYLE, ...(i === visible - 1 && progress < 1 ? { border: '2px solid #e8604c' } : {}) },
    draggable: true,
    selectable: false,
  }));
  const shown = new Set(nodes.map((n) => n.id));
  const edges = laid.edges.filter((e) => shown.has(e.source) && shown.has(e.target)).map((e) => ({
    ...e,
    animated: false,
    style: { stroke: '#B87F24', strokeWidth: 2.2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#B87F24', width: 18, height: 18 },
  }));

  const height = Math.min(560, Math.max(300, (laid.nodes.at(-1)?.position.y ?? 200) + (laid.nodes.at(-1)?.height ?? 80) + 40));

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', border: '1px solid var(--border, #EBD6CB)', borderRadius: 16, background: 'var(--surface, #FFFDFB)', overflow: 'hidden' }}>
      <div style={{ width: '100%', height }}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            fitViewOptions={{ padding: 0.12 }}
            proOptions={{ hideAttribution: true }}
            nodesConnectable={false}
            elementsSelectable={false}
            zoomOnScroll={false}
            preventScrolling={false}
          >
            <Background color="#F0DFD6" gap={22} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  );
}
