'use client';

// Real data-structure visualizer: React Flow renders a Dagre-laid-out graph/tree (binary
// tree, BST, graph, linked list). Clean node/edge rendering, far better than hand-drawn SVG.
//
// DRY-RUN TRACE (VisuAlgo-style): when content.trace is present, the graph ANIMATES through
// the algorithm step by step — the current node highlights, visited nodes stay marked, named
// pointers (low/mid/high, slow/fast) ride ON the nodes, and the step note is captioned — all
// driven by the lesson clock (progress -> step index) so it's synced to the tutor's words.
// This is "point and explain while the algorithm walks the tree", not a static picture.

import { useEffect, useMemo } from 'react';
import { ReactFlow, ReactFlowProvider, Background, MarkerType, useNodesInitialized, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { layoutGraph } from '../../../lib/board/diagrams/graph-layout.js';
import { wantsTreeLayout, layoutTree } from '../../../lib/board/diagrams/tree-layout.js';

// Resolve the visual state at the current clock position. Prefer an EXPLICIT step bound to the
// active narration line (activeStep) — that's true voice-sync; the current node marks exactly
// when the tutor says it. Fall back to write-progress, then highlightSequence, then activeNode.
function resolveState({ content, progress, activeNode, activeStep }) {
  const trace = Array.isArray(content.trace) && content.trace.length ? content.trace : null;
  if (trace) {
    const idx = activeStep != null
      ? Math.max(0, Math.min(trace.length - 1, activeStep))
      : Math.min(trace.length - 1, Math.floor(progress * trace.length + 1e-9));
    const step = trace[Math.max(0, idx)];
    // Accumulate every node marked current up to and including this step -> a growing visited path,
    // even when the model didn't spell out `visited` on each step.
    const path = new Set((step.visited ?? []).map(String));
    for (let i = 0; i <= idx; i += 1) if (trace[i].current != null) path.add(String(trace[i].current));
    const current = step.current != null ? String(step.current) : null;
    if (current) path.delete(current); // current wins its own colour
    // pointerAt: nodeId -> ['low','mid'] labels riding on it this step.
    const pointerAt = new Map();
    for (const [name, nid] of Object.entries(step.pointers ?? {})) {
      const key = String(nid);
      if (!pointerAt.has(key)) pointerAt.set(key, []);
      pointerAt.get(key).push(name);
    }
    const activeEdge = Array.isArray(step.activeEdge) ? step.activeEdge.map(String) : null;
    return { current, visited: path, pointerAt, note: step.note, stepNum: idx + 1, stepTotal: trace.length, activeEdge };
  }
  const seq = Array.isArray(content.highlightSequence) ? content.highlightSequence.map(String) : null;
  if (seq) {
    const n = Math.floor(progress * seq.length + 1e-9);
    const visited = new Set(seq.slice(0, n));
    const current = n > 0 ? seq[n - 1] : null;
    if (current) visited.delete(current);
    return { current, visited, pointerAt: new Map(), note: null, stepNum: 0, stepTotal: 0 };
  }
  return {
    current: activeNode != null ? String(activeNode) : null,
    visited: new Set(),
    pointerAt: new Map(),
    note: null,
    stepNum: 0,
    stepTotal: 0,
  };
}

// ReactFlow needs a ReactFlowProvider ABOVE the component that calls its hooks, so the exported
// GraphView is a thin provider wrapper around the real inner view.
export function GraphView(props) {
  return (
    <ReactFlowProvider>
      <GraphViewInner {...props} />
    </ReactFlowProvider>
  );
}

function GraphViewInner({ content, progress = 1, activeNode = null, activeStep = null }) {
  const laid = useMemo(() => {
    try {
      const spec = { nodes: content.nodes ?? [], edges: content.edges ?? [] };
      // Branching rooted trees (BST, heap, recursion trees) get the tidy-tree layout — true
      // left/right child positions. Everything else (cycles, DAGs, linked lists) stays on dagre.
      return wantsTreeLayout(spec) ? layoutTree(spec) : layoutGraph({ ...spec, direction: content.direction ?? 'TB' });
    } catch {
      return null;
    }
  }, [content]);

  // THE FIX for "tree invisible while playing, appears on pause": the `fitView` prop only fits on
  // the first render, which — inside the player's animated/crossfading container — happens before
  // the nodes are measured, so it fits to nothing. useNodesInitialized() fires once the nodes have
  // real width/height; we then fitView() for real. Re-runs on every (re)mount and layout change.
  const nodesInitialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  const nodeCount = laid?.nodes.length ?? 0;
  useEffect(() => {
    if (nodesInitialized && nodeCount > 0) fitView({ padding: 0.2, duration: 0 });
  }, [nodesInitialized, nodeCount, fitView]);

  if (!laid) return <div style={{ color: '#c0392b', fontSize: 13 }}>diagram unavailable</div>;

  const { current, visited, pointerAt, note, stepNum, stepTotal, activeEdge = null } = resolveState({ content, progress, activeNode, activeStep });
  const hasTrace = Boolean(note);

  const nodeColor = (id) => {
    if (id === current) return { border: '#d35400', bg: '#ffd9a8', fg: '#8a3a12' }; // where the tutor is now
    if (visited.has(id)) return { border: '#27ae60', bg: '#eafaf0', fg: '#1c6b3a' }; // already walked
    if (hasTrace) return { border: '#b8b0a0', bg: '#fbf8f2', fg: '#8a8172' }; // not yet reached
    return { border: '#c0392b', bg: '#fffdf8', fg: '#3a3327' }; // plain diagram (no trace)
  };

  const nodes = laid.nodes.map((n) => {
    const c = nodeColor(n.id);
    const isCurrent = n.id === current;
    return {
      id: n.id,
      position: { x: n.x, y: n.y },
      data: { label: n.label },
      style: {
        width: n.width,
        height: n.height,
        borderRadius: 10,
        border: `${isCurrent ? 3 : 2}px solid ${c.border}`,
        background: c.bg,
        color: c.fg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        whiteSpace: 'pre-line',
        fontFamily: 'ui-monospace, monospace',
        fontWeight: 600,
        fontSize: 14,
        // NOTE: never put `transform` here — ReactFlow uses transform:translate() to POSITION the
        // node, so a scale() would clobber the position (nodes collapse to the origin). Emphasis
        // is via border width + glow only.
        boxShadow: isCurrent ? '0 0 0 6px rgba(211,84,0,0.32), 0 2px 12px rgba(211,84,0,0.4)' : 'none',
        transition: 'background 0.3s, border-color 0.3s, color 0.3s, box-shadow 0.3s',
      },
    };
  });
  const POINTER_COLORS = ['#8e44ad', '#2980b9', '#c0392b', '#16a085'];
  let pointerIndex = 0;
  for (const [nid, names] of pointerAt) {
    const base = laid.nodes.find((n) => n.id === nid);
    if (!base) continue;
    for (const name of names) {
      const color = POINTER_COLORS[pointerIndex % POINTER_COLORS.length];
      const pad = 9 + (pointerIndex % 2) * 7; // two rings on one node stay visible
      pointerIndex += 1;
      nodes.push({
        id: `ptr-${name}`, // STABLE identity per pointer -> glide, not teleport
        position: { x: base.x - pad, y: base.y - pad },
        data: { label: name },
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: 10,
        style: {
          width: base.width + pad * 2,
          height: base.height + pad * 2,
          borderRadius: 999,
          border: `3px solid ${color}`,
          background: 'transparent',
          color,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          paddingBottom: 1,
          fontFamily: 'ui-monospace, monospace',
          fontWeight: 800,
          fontSize: 10,
          pointerEvents: 'none',
          boxShadow: `0 0 12px ${color}44`,
          transition: 'transform 0.45s cubic-bezier(0.4, 0, 0.2, 1), width 0.3s, height 0.3s',
        },
      });
    }
  }

  const isActiveEdge = (e) =>
    activeEdge && ((activeEdge[0] === e.from && activeEdge[1] === e.to) || (content.directed === false && activeEdge[0] === e.to && activeEdge[1] === e.from));
  const edges = laid.edges.map((e) => {
    const traversing = isActiveEdge(e); // the edge the algorithm walks THIS step
    const active = traversing || e.from === current || e.to === current || (visited.has(e.from) && visited.has(e.to));
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      label: e.label,
      animated: traversing || e.from === current || e.to === current,
      markerEnd: content.directed !== false ? { type: MarkerType.ArrowClosed, color: active ? '#d35400' : '#8a6d3b' } : undefined,
      style: { stroke: traversing ? '#e8604c' : active ? '#d35400' : '#8a6d3b', strokeWidth: traversing ? 4 : active ? 2.5 : 1.5, transition: 'stroke 0.3s, stroke-width 0.3s' },
    };
  });

  const height = Math.min(460, Math.max(200, laid.height + 40));
  return (
    <div>
      {hasTrace ? (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6, fontSize: 11.5, fontFamily: 'ui-monospace, monospace', color: '#5a4a2a' }}>
          <LegendChip swatch={{ background: '#ffd9a8', border: '2px solid #d35400' }} label="current" />
          <LegendChip swatch={{ background: '#eafaf0', border: '2px solid #27ae60' }} label="visited" />
          <LegendChip swatch={{ background: '#fbf8f2', border: '2px solid #b8b0a0' }} label="not yet" />
          <LegendChip swatch={{ background: 'transparent', borderBottom: '3px solid #e8604c', borderRadius: 0, height: 3, marginTop: 6 }} label="active edge" />
        </div>
      ) : null}
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
      {hasTrace ? (
        <div
          style={{
            marginTop: 8,
            padding: '8px 12px',
            border: '1px solid #e8ddc9',
            borderRadius: 10,
            background: '#fffaf0',
            fontFamily: 'ui-monospace, monospace',
            fontSize: 13,
            color: '#5a4a2a',
            display: 'flex',
            gap: 10,
            alignItems: 'baseline',
          }}
        >
          <span style={{ color: '#d35400', fontWeight: 700, whiteSpace: 'nowrap' }}>
            Step {stepNum}/{stepTotal}
          </span>
          <span>{note}</span>
        </div>
      ) : null}
    </div>
  );
}

function LegendChip({ swatch, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 14, height: 14, borderRadius: 4, ...swatch }} />
      {label}
    </span>
  );
}
