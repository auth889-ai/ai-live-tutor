'use client';

// Real data-structure visualizer: React Flow renders a laid-out graph/tree (binary tree, BST,
// recursion tree, graph). Trace-driven: the current node highlights, visited nodes stay marked,
// the tree GROWS node by node, return values ride edges — all a pure function of one step index.
//
// ANIMATION DESIGN (research-backed, matching recursion-tree-visualizer): the "elite" feel is
// four cheap orthogonal tricks — (1) precomputed layout so positions never shift; (2) reveal by
// MOUNT-GATING (only revealed nodes are rendered) so each node's enter keyframe fires once when
// it appears; (3) grow-in via a CSS keyframe (scale 0.4->1 + opacity) with an OVERSHOOT ease on
// an INNER div — never the ReactFlow wrapper, which owns transform:translate for positioning;
// (4) current-node highlight = color swap + a box-shadow pulse. The trace->status decisions are
// the pure, unit-tested lib/board/diagrams/graph-view-model.js (resolveTraceStep/nodeStatus/
// edgeStatus); this file only renders them.

import { memo, useEffect, useMemo } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MarkerType, useNodesInitialized, useReactFlow, useInternalNode, BaseEdge, EdgeLabelRenderer, getStraightPath } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { layoutGraph } from '../../../lib/board/diagrams/graph-layout.js';
import { layoutForce, wantsForceLayout } from '../../../lib/board/diagrams/force-layout.js';
import { wantsTreeLayout, layoutTree } from '../../../lib/board/diagrams/tree-layout.js';
import { resolveTraceStep, nodeStatus, edgeStatus, isGhostNode } from '../../../lib/board/diagrams/graph-view-model.js';

const CIRCLE = 56;

// status -> {border, bg, fg}. One source of truth for node color, shared with the legend.
// SOLID fills for the states that matter (reference visualizers use full-color nodes with
// white labels — instantly readable at a glance); "not yet" stays hollow so the frontier pops.
const STATUS_STYLE = {
  current: { border: '#b93c2b', bg: '#e8604c', fg: '#fff' },
  memoized: { border: '#6f3391', bg: '#8e44ad', fg: '#fff' },
  visited: { border: '#20794a', bg: '#2f9e5f', fg: '#fff' },
  notyet: { border: '#c9beac', bg: '#fffdf9', fg: '#9a9182' },
  plain: { border: '#c0392b', bg: '#fffcfa', fg: '#3a3327' },
};

// The visible node is an INNER div (rendered as ReactFlow node.data.label). The RF wrapper stays
// transparent and fixed-size so edges anchor to a stable box while THIS div scales in on mount
// (transform:scale is safe here — RF's transform is on the wrapper, not this element).
const NodeInner = memo(function NodeInner({ label, status, circle, fontSize, badge }) {
  const c = STATUS_STYLE[status] ?? STATUS_STYLE.plain;
  return (
    <div
      className={`algo-node algo-node--${status}`}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        borderRadius: circle ? '50%' : 10,
        // Reference weight (tree/'s vertice.tsx): 5px circle strokes — thin borders are the
        // single biggest "looks weak" factor at a glance.
        border: `${status === 'current' ? 5 : 4}px solid ${c.border}`,
        background: c.bg,
        color: c.fg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        whiteSpace: 'pre-line',
        lineHeight: 1.15,
        fontFamily: 'ui-monospace, monospace',
        fontWeight: 800,
        fontSize,
        boxShadow: status === 'notyet' || status === 'plain' ? 'none' : '0 2px 6px rgba(120,90,40,0.16)',
      }}
    >
      {label}
      {badge ? (
        <div
          className={badge.changed ? 'algo-badge algo-badge--changed' : 'algo-badge'}
          style={{
            position: 'absolute', top: '100%', left: '50%', transform: 'translate(-50%, 3px)',
            whiteSpace: 'nowrap', padding: '1px 7px', borderRadius: 8, fontSize: 11.5, fontWeight: 800,
            fontFamily: 'ui-monospace, monospace', lineHeight: 1.5, pointerEvents: 'none',
            background: badge.changed ? '#e8604c' : '#fffcfa', color: badge.changed ? '#fff' : '#5a4a2a',
            border: `1.5px solid ${badge.changed ? '#b93c2b' : '#e8d5c8'}`, boxShadow: '0 1px 4px rgba(120,90,40,0.15)',
          }}
        >
          {badge.changed && badge.old !== undefined ? <s style={{ opacity: 0.75, marginRight: 4 }}>{badge.old}</s> : null}
          {badge.text}
        </div>
      ) : null}
    </div>
  );
});

// The one <style> for the whole viewer: the grow-in keyframe (overshoot ease, plays once per
// node on mount), and the current-node pulse (box-shadow only, so it never fights the scale).
const KEYFRAMES = `
@keyframes algoNodeGrow { from { transform: scale(0.35); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes algoNodePulse { 0%,100% { box-shadow: 0 0 0 4px rgba(232,96,76,0.30), 0 3px 14px rgba(232,96,76,0.36); } 50% { box-shadow: 0 0 0 10px rgba(232,96,76,0.12), 0 4px 20px rgba(232,96,76,0.5); } }
.algo-node { transform-origin: center; animation: algoNodeGrow 0.26s cubic-bezier(0.65,0,0.265,1.55) both; transition: background 0.3s, border-color 0.3s, color 0.3s; }
.algo-node--current { animation: algoNodeGrow 0.26s cubic-bezier(0.65,0,0.265,1.55) both, algoNodePulse 1.7s ease-in-out 0.26s infinite; }
`;

// Rim-to-rim straight edge — the reference's pointOnLine trick (tree/'s directed-edge trims
// each end to the circle radius so arrowheads TOUCH the circle instead of floating at the
// wrapper's fixed top/bottom handles). Label renders as a bold pill at the midpoint.
function FloatingEdge({ id, source, target, markerEnd, style, label, labelStyle }) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t || source === target) return null;
  const cx = (n) => n.internals.positionAbsolute.x + (n.measured?.width ?? 0) / 2;
  const cy = (n) => n.internals.positionAbsolute.y + (n.measured?.height ?? 0) / 2;
  const x1 = cx(s); const y1 = cy(s); const x2 = cx(t); const y2 = cy(t);
  const d = Math.max(1, Math.hypot(x2 - x1, y2 - y1));
  const ux = (x2 - x1) / d; const uy = (y2 - y1) / d;
  const rs = (s.measured?.width ?? 56) / 2;
  const rt = (t.measured?.width ?? 56) / 2 + 3; // + arrow breathing room
  const [path, labelX, labelY] = getStraightPath({
    sourceX: x1 + ux * rs, sourceY: y1 + uy * rs,
    targetX: x2 - ux * rt, targetY: y2 - uy * rt,
  });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {label ? (
        <EdgeLabelRenderer>
          <div style={{
            position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            background: '#fffcfa', borderRadius: 7, padding: '1px 6px', pointerEvents: 'none',
            fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: 13,
            color: labelStyle?.fill ?? '#5a4a2a', boxShadow: '0 1px 4px rgba(120,90,40,0.18)',
          }}>
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const EDGE_TYPES = { floating: FloatingEdge };

// Build the ReactFlow node/edge arrays for one resolved step. Pure over (laid, content, state);
// called from a useMemo so element identity is stable between clock ticks.
function buildFlowElements(laid, content, state) {
  const { pointerAt, returned, note, current } = state;
  const hasTrace = state.stepTotal > 0;

  const nodes = [];
  for (const n of laid.nodes) {
    const status = nodeStatus(n.id, state);
    if (status === 'ghost') continue; // MOUNT-GATE: unrevealed nodes are absent, then grow in
    const circle = hasTrace;
    const value = returned[n.id];
    const label = value !== undefined ? `${n.label}\n= ${JSON.stringify(value)}` : n.label;
    // The instructor move: per-node numbers (dist/indegree) live ON the drawing, and an
    // improvement renders as the crossed-out old value next to the new one (their "7 -> 3").
    const raw = state.values[n.label] ?? state.values[n.id];
    const prev = state.prevValues[n.label] ?? state.prevValues[n.id];
    const badge = raw !== undefined && raw !== null && raw !== ''
      ? {
        text: String(raw),
        changed: JSON.stringify(prev) !== JSON.stringify(raw),
        old: prev !== undefined && prev !== null && prev !== '' ? String(prev) : undefined,
      }
      : null;
    const longest = Math.max(...String(label).split('\n').map((l) => l.length));
    // Reference sizing (tree/): text starts HUGE and scales down to fit — bold labels carry
    // the drawing. Cap raised now that labels are compact (varying args only).
    const fontSize = circle ? Math.max(10, Math.min(21, Math.floor((CIRCLE - 10) / Math.max(1, longest * 0.6)))) : 14;
    nodes.push({
      id: n.id,
      position: circle ? { x: n.x + (n.width - CIRCLE) / 2, y: n.y + (n.height - CIRCLE) / 2 } : { x: n.x, y: n.y },
      data: { label: <NodeInner label={label} status={status} circle={circle} fontSize={fontSize} badge={badge} /> },
      // The wrapper is invisible + fixed-size: edges anchor to it while NodeInner animates.
      style: { width: circle ? CIRCLE : n.width, height: circle ? CIRCLE : n.height, background: 'transparent', border: 'none', padding: 0, boxShadow: 'none' },
    });
  }

  // Named-pointer rings (low/mid/high, slow/fast) that are NOT on the current node.
  const POINTER_COLORS = ['#8e44ad', '#2980b9', '#c0392b', '#16a085'];
  let pointerIndex = 0;
  for (const [nid, names] of pointerAt) {
    const base = laid.nodes.find((n) => n.id === nid);
    if (!base || isGhostNode(nid, state)) continue;
    for (const name of names) {
      const color = POINTER_COLORS[pointerIndex % POINTER_COLORS.length];
      const pad = 9 + (pointerIndex % 2) * 7;
      pointerIndex += 1;
      nodes.push({
        id: `ptr-${name}`,
        position: { x: base.x - pad, y: base.y - pad },
        data: { label: name },
        draggable: false, selectable: false, focusable: false, zIndex: 10,
        style: {
          width: base.width + pad * 2, height: base.height + pad * 2, borderRadius: 999,
          border: `3px solid ${color}`, background: 'transparent', color,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 1,
          fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: 10, pointerEvents: 'none',
          boxShadow: `0 0 12px ${color}44`,
          transition: 'transform 0.45s cubic-bezier(0.4, 0, 0.2, 1), width 0.3s, height 0.3s',
        },
      });
    }
  }

  // Clean digital per-step callout anchored above-right of the current node (target graph.png,
  // NOT handwritten): a short clause of THIS step's real narration.
  if (hasTrace && current && note) {
    const base = laid.nodes.find((n) => n.id === current);
    if (base) {
      const clause = String(note).split(/(?<=[.:])\s/)[0].split(/\s+/).slice(0, 9).join(' ');
      nodes.push({
        id: '__callout__',
        position: { x: base.x + base.width * 0.9 + 22, y: base.y - 66 },
        data: { label: clause },
        draggable: false, selectable: false, focusable: false, zIndex: 40,
        style: {
          width: 184, background: 'linear-gradient(180deg,#fffdf9,#fff5ec)', border: '1.5px solid #f0c39a',
          borderRadius: 11, padding: '6px 10px', boxShadow: '0 6px 18px rgba(211,84,0,0.18)',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontSize: 11.5, fontWeight: 600, lineHeight: 1.3,
          color: '#8a3a12', textAlign: 'left', whiteSpace: 'normal', pointerEvents: 'none',
        },
      });
    }
  }

  const edges = [];
  for (const e of laid.edges) {
    const status = edgeStatus(e, state, content.directed);
    if (status === 'ghost') continue; // edge into the unrevealed future is absent
    const traversing = status === 'traversing';
    const active = traversing || status === 'active';
    // Reference weight (tree/'s directed-edge): 5px STRAIGHT lines, bold labels with a light
    // halo so they read over the stroke, arrowheads sized to the stroke.
    edges.push({
      id: e.id,
      source: e.from,
      target: e.to,
      type: hasTrace ? 'floating' : 'straight', // circles get rim-to-rim edges; static boxes keep plain lines
      label: e.label || (returned[e.to] !== undefined ? `↑ ${JSON.stringify(returned[e.to])}` : ''),
      labelStyle: { fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: 13, fill: traversing ? '#b93c2b' : active ? '#20794a' : '#5a4a2a' },
      labelBgStyle: { fill: '#fffcfa', fillOpacity: 0.92 },
      labelBgPadding: [6, 3],
      labelBgBorderRadius: 7,
      // Algorithm Visualizer's trail rule: ONLY the edge being traversed right now animates;
      // edges already walked settle into the solid visited color (a calm green trail), so the
      // eye is drawn to the one moving thing instead of a screen of flashing dashes.
      animated: traversing,
      markerEnd: content.directed !== false ? { type: MarkerType.ArrowClosed, width: 16, height: 16, color: traversing ? '#d35400' : active ? '#2f9e5f' : '#7a6248' } : undefined,
      style: { stroke: traversing ? '#e8604c' : active ? '#2f9e5f' : '#7a6248', strokeWidth: traversing ? 5 : active ? 4 : 3, transition: 'stroke 0.3s, stroke-width 0.3s' },
    });
  }

  return { nodes, edges };
}

// ReactFlow needs a ReactFlowProvider above the hooks; memo() so the clock's per-tick re-renders
// don't reach it (it re-renders only when the step actually changes).
export const GraphView = memo(function GraphView(props) {
  return (
    <ReactFlowProvider>
      <GraphViewInner {...props} />
    </ReactFlowProvider>
  );
});

function GraphViewInner({ content, progress = 1, activeNode = null, activeStep = null }) {
  const laid = useMemo(() => {
    try {
      const spec = { nodes: content.nodes ?? [], edges: content.edges ?? [] };
      if (wantsTreeLayout(spec)) return layoutTree(spec);
      // General graphs (cycles, cross-edges, undirected) get the ORGANIC force layout the
      // reference visualizers use; only clean layered DAGs fall through to dagre rows.
      if (wantsForceLayout(spec, content.directed)) return layoutForce(spec);
      return layoutGraph({ ...spec, direction: content.direction ?? 'LR' });
    } catch {
      return null;
    }
  }, [content]);

  const state = useMemo(
    () => resolveTraceStep({ content, progress, activeNode, activeStep }),
    [content, progress, activeNode, activeStep],
  );
  const flow = useMemo(() => (laid ? buildFlowElements(laid, content, state) : null), [laid, content, state]);

  // onInit + a settle fit reliably frame the whole graph once nodes are measured (the
  // useNodesInitialized effect alone did not fire in static, non-clock renders).
  const nodesInitialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  const nodeCount = flow?.nodes.length ?? 0;
  useEffect(() => {
    if (!nodesInitialized || nodeCount === 0) return undefined;
    fitView({ padding: 0.2, duration: 0, maxZoom: 1.1, minZoom: 0.15 });
    const settle = setTimeout(() => fitView({ padding: 0.2, duration: 0, maxZoom: 1.1, minZoom: 0.15 }), 420);
    return () => clearTimeout(settle);
  }, [nodesInitialized, nodeCount, fitView]);

  if (!laid || !flow) return <div style={{ color: '#c0392b', fontSize: 13 }}>diagram unavailable</div>;

  const { nodes, edges } = flow;
  const { note, stepNum, stepTotal } = state;
  const hasTrace = stepTotal > 0;
  const height = Math.min(560, Math.max(240, laid.height + 60));

  return (
    <div>
      <style>{KEYFRAMES}</style>
      {hasTrace ? (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6, fontSize: 11.5, fontFamily: 'ui-monospace, monospace', color: '#5a4a2a' }}>
          <LegendChip swatch={{ background: '#e8604c', border: '2px solid #b93c2b' }} label="current" />
          <LegendChip swatch={{ background: '#2f9e5f', border: '2px solid #20794a' }} label="visited" />
          <LegendChip swatch={{ background: '#fffdf9', border: '2px solid #c9beac' }} label="not yet" />
          {state.memo.size > 0 ? <LegendChip swatch={{ background: '#8e44ad', border: '2px solid #6f3391' }} label="from memo" /> : null}
          {Object.keys(state.returned).length > 0 ? <LegendChip swatch={{ background: '#2f9e5f', border: '2px solid #20794a' }} label="= returned value" /> : null}
          <LegendChip swatch={{ background: 'transparent', borderBottom: '3px solid #e8604c', borderRadius: 0, height: 3, marginTop: 6 }} label="crossing now" />
          <LegendChip swatch={{ background: 'transparent', borderBottom: '3px solid #2f9e5f', borderRadius: 0, height: 3, marginTop: 6 }} label="walked" />
        </div>
      ) : null}
      <div style={{ height, border: '1px solid #f0dcd5', borderRadius: 12, background: '#fffcfa' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          edgeTypes={EDGE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
          minZoom={0.15}
          onInit={(instance) => instance.fitView({ padding: 0.2, maxZoom: 1.1, minZoom: 0.15 })}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          // SCROLLABLE, never cut: a big tree/graph can be DRAGGED to pan and zoomed with the
          // controls, so no part is ever permanently clipped (the array/grid/table boxes already
          // scroll via overflow:auto; the canvas needs pan+zoom instead). zoomOnScroll stays off
          // so the page still scrolls normally when the cursor is over the graph.
          panOnDrag
          zoomOnScroll={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#efe6d3" gap={20} />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </div>
      {hasTrace ? (
        <div style={{ marginTop: 8, padding: '8px 12px', border: '1px solid #f0dcd5', borderRadius: 10, background: '#fff8f4', fontFamily: 'ui-monospace, monospace', fontSize: 13, color: '#5a4a2a', display: 'flex', gap: 10, alignItems: 'baseline' }}>
          <span style={{ color: '#d35400', fontWeight: 700, whiteSpace: 'nowrap' }}>Step {stepNum}/{stepTotal}</span>
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
