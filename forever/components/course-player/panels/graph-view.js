'use client';

// Real data-structure visualizer: React Flow renders a Dagre-laid-out graph/tree (binary
// tree, BST, graph, linked list). Clean node/edge rendering, far better than hand-drawn SVG.
//
// DRY-RUN TRACE (VisuAlgo-style): when content.trace is present, the graph ANIMATES through
// the algorithm step by step — the current node highlights, visited nodes stay marked, named
// pointers (low/mid/high, slow/fast) ride ON the nodes, and the step note is captioned — all
// driven by the lesson clock (progress -> step index) so it's synced to the tutor's words.
// This is "point and explain while the algorithm walks the tree", not a static picture.
//
// PLAYBACK-VISIBILITY CONTRACT (the "tree invisible while playing" fix, studied at source in
// the recursion-tree-visualizer): the renderer must be a pure function of ONE scalar (the step
// index) over pre-baked data. Concretely: (1) GraphView is memo()ed so the player's clock ticks
// don't reach it — it re-renders only when the step actually changes; (2) the nodes/edges arrays
// handed to ReactFlow are useMemo()ed — every render used to mint brand-new arrays, feeding
// ReactFlow unmeasured elements many times a second so it never settled while playing and only
// painted on pause; (3) layout runs once per structure, never per tick.

import { memo, useEffect, useMemo } from 'react';
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
    // pointerAt: nodeId -> ['low','mid'] labels riding on it this step. A pointer that sits on
    // the CURRENT node is skipped — the orange current highlight already marks it, so a second
    // ring labeled "curr" is just redundant clutter (verified on the Dijkstra view).
    const pointerAt = new Map();
    for (const [name, nid] of Object.entries(step.pointers ?? {})) {
      const key = String(nid);
      if (current && key === current) continue;
      if (!pointerAt.has(key)) pointerAt.set(key, []);
      pointerAt.get(key).push(name);
    }
    const activeEdge = Array.isArray(step.activeEdge) ? step.activeEdge.map(String) : null;
    // Recursion-tree state (recursion-compiler): the tree GROWS (revealed), return values land
    // on nodes (returned), memo hits stay marked (memo).
    const revealed = Array.isArray(step.revealed) ? new Set(step.revealed.map(String)) : null;
    const returned = step.returned && typeof step.returned === 'object' && !Array.isArray(step.returned) ? step.returned : {};
    const memo = new Set(Array.isArray(step.memo) ? step.memo.map(String) : []);
    return { current, visited: path, pointerAt, note: step.note, stepNum: idx + 1, stepTotal: trace.length, activeEdge, revealed, returned, memo };
  }
  const seq = Array.isArray(content.highlightSequence) ? content.highlightSequence.map(String) : null;
  if (seq) {
    const n = Math.floor(progress * seq.length + 1e-9);
    const visited = new Set(seq.slice(0, n));
    const current = n > 0 ? seq[n - 1] : null;
    if (current) visited.delete(current);
    return { current, visited, pointerAt: new Map(), note: null, stepNum: 0, stepTotal: 0, activeEdge: null, revealed: null, returned: {}, memo: new Set() };
  }
  return {
    current: activeNode != null ? String(activeNode) : null,
    visited: new Set(),
    pointerAt: new Map(),
    note: null,
    stepNum: 0,
    stepTotal: 0,
    activeEdge: null,
    revealed: null,
    returned: {},
    memo: new Set(),
  };
}

// Build the ReactFlow node/edge arrays for one resolved step. Pure: same (laid, content, state)
// -> same arrays. Called only from a useMemo so element identity is stable between clock ticks.
function buildFlowElements(laid, content, state) {
  const { current, visited, pointerAt, activeEdge, revealed, returned, memo, note } = state;
  const hasTrace = state.stepTotal > 0;

  const nodeColor = (id) => {
    if (id === current) return { border: '#d35400', bg: '#ffd9a8', fg: '#8a3a12' }; // where the tutor is now
    if (memo.has(id)) return { border: '#8e44ad', bg: '#f3e8fb', fg: '#5b2c6f' }; // answered from memory (the DP win)
    if (visited.has(id)) return { border: '#27ae60', bg: '#eafaf0', fg: '#1c6b3a' }; // already walked
    if (hasTrace) return { border: '#b8b0a0', bg: '#fbf8f2', fg: '#8a8172' }; // not yet reached
    return { border: '#c0392b', bg: '#fffdf8', fg: '#3a3327' }; // plain diagram (no trace)
  };
  // Growing tree: nodes outside `revealed` haven't been CALLED yet — ghosts hold the layout
  // steady while the recursion builds the tree call by call in front of the student.
  const isGhost = (id) => revealed !== null && !revealed.has(id) && id !== current;

  // Trace-driven nodes render as CIRCLES (recursion-tree-visualizer's vertice.tsx: fixed
  // radius, thick stroke, bold centered value, text scaled to fit) — a tree must look like a
  // textbook tree, never a flowchart of boxes. Plain diagrams (no trace) keep rounded rects.
  const CIRCLE = 56;
  const nodes = laid.nodes.map((n) => {
    const c = nodeColor(n.id);
    const isCurrent = n.id === current;
    const value = returned[n.id];
    const label = value !== undefined ? `${n.label}\n= ${JSON.stringify(value)}` : n.label;
    const circle = hasTrace;
    const longest = Math.max(...String(label).split('\n').map((l) => l.length));
    return {
      id: n.id,
      position: circle ? { x: n.x + (n.width - CIRCLE) / 2, y: n.y + (n.height - CIRCLE) / 2 } : { x: n.x, y: n.y },
      data: { label },
      style: {
        opacity: isGhost(n.id) ? 0.12 : 1,
        width: circle ? CIRCLE : n.width,
        height: circle ? CIRCLE : n.height,
        borderRadius: circle ? '50%' : 10,
        border: `${isCurrent ? 4 : 3}px solid ${c.border}`,
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
        // Scale text into the circle (their useScaleDown trick, done with font-size).
        fontSize: circle ? Math.max(9, Math.min(17, Math.floor((CIRCLE - 12) / Math.max(1, longest * 0.62)))) : 14,
        // NOTE: never put `transform` here — ReactFlow uses transform:translate() to POSITION the
        // node, so a scale() would clobber the position (nodes collapse to the origin). Emphasis
        // is via border width + glow only.
        boxShadow: isCurrent ? '0 0 0 6px rgba(211,84,0,0.32), 0 2px 12px rgba(211,84,0,0.4)' : 'none',
        transition: 'background 0.3s, border-color 0.3s, color 0.3s, box-shadow 0.3s, opacity 0.25s ease-out',
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

  // ELITE DIGITAL CALLOUT (clean/polished like the studied tools, NOT handwritten): a crisp
  // annotation chip anchored above-right of the current node with a small pointer aimed at it,
  // showing a short clause of THIS step's real narration (dynamic, never canned). Rides the
  // graph through zoom/pan and every step.
  if (hasTrace && current && note) {
    const base = laid.nodes.find((n) => n.id === current);
    if (base) {
      const clause = String(note).split(/(?<=[.:])\s/)[0].split(/\s+/).slice(0, 9).join(' ');
      nodes.push({
        id: '__callout__',
        position: { x: base.x + base.width * 0.55 + 16, y: base.y - 58 },
        data: { label: `◤ ${clause}` },
        draggable: false, selectable: false, focusable: false, zIndex: 40,
        style: {
          width: 184,
          background: 'linear-gradient(180deg,#fffdf9,#fff5ec)',
          border: '1.5px solid #f0c39a',
          borderRadius: 11,
          padding: '6px 10px',
          boxShadow: '0 6px 18px rgba(211,84,0,0.18)',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          fontSize: 11.5,
          fontWeight: 600,
          lineHeight: 1.3,
          color: '#8a3a12',
          textAlign: 'left',
          whiteSpace: 'normal',
          pointerEvents: 'none',
        },
      });
    }
  }

  const isActiveEdge = (e) =>
    activeEdge && ((activeEdge[0] === e.from && activeEdge[1] === e.to) || (content.directed === false && activeEdge[0] === e.to && activeEdge[1] === e.from));
  const edges = laid.edges.map((e) => {
    const traversing = isActiveEdge(e); // the edge the algorithm walks THIS step
    const active = traversing || e.from === current || e.to === current || (visited.has(e.from) && visited.has(e.to));
    const ghost = isGhost(e.from) || isGhost(e.to); // edge into the unrevealed future stays hidden
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      // A finished subtree's answer rides its edge (recursion-tree-visualizer's edge label):
      // "↑ 3" on fib(4)->fib(3) the moment fib(3) returns.
      label: e.label || (returned[e.to] !== undefined ? `↑ ${JSON.stringify(returned[e.to])}` : ''),
      animated: !ghost && (traversing || e.from === current || e.to === current),
      markerEnd: content.directed !== false ? { type: MarkerType.ArrowClosed, color: active ? '#d35400' : '#8a6d3b' } : undefined,
      style: { opacity: ghost ? 0.08 : 1, stroke: traversing ? '#e8604c' : active ? '#d35400' : '#8a6d3b', strokeWidth: traversing ? 4 : active ? 2.5 : 1.5, transition: 'stroke 0.3s, stroke-width 0.3s, opacity 0.3s' },
    };
  });

  return { nodes, edges };
}

// ReactFlow needs a ReactFlowProvider ABOVE the component that calls its hooks, so the exported
// GraphView is a thin provider wrapper around the real inner view. memo(): the lesson clock
// re-renders the whole stage many times a second; this view only changes when its props do
// (content identity is stable per trace, activeStep changes once per step) — without memo the
// per-tick churn kept ReactFlow perpetually re-measuring and the tree stayed invisible in play.
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
      // Branching rooted trees (BST, heap, recursion trees) get the tidy-tree layout — true
      // left/right child positions. Everything else (cycles, DAGs like Dijkstra, linked lists)
      // lays out LEFT-TO-RIGHT: a wide-short player panel fits a horizontal chain far better
      // than a vertical one, which was clipping the last node no matter how fitView zoomed.
      return wantsTreeLayout(spec) ? layoutTree(spec) : layoutGraph({ ...spec, direction: content.direction ?? 'LR' });
    } catch {
      return null;
    }
  }, [content]);

  // One resolved step -> one stable {nodes, edges} pair. Recomputed only when the step (or the
  // structure) changes, never on unrelated parent renders.
  const state = useMemo(
    () => resolveState({ content, progress, activeNode, activeStep }),
    [content, progress, activeNode, activeStep],
  );
  const flow = useMemo(() => (laid ? buildFlowElements(laid, content, state) : null), [laid, content, state]);

  // The `fitView` prop only fits on the first render, which — inside the player's animated/
  // crossfading container — happens before the nodes are measured, so it fits to nothing.
  // useNodesInitialized() fires once the nodes have real width/height; we then fitView() for
  // real, and once more after the crossfade settles (a fit fired mid-animation measured the
  // container mid-transition and could still frame the wrong box — the "appears on pause" tail).
  const nodesInitialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  const nodeCount = laid?.nodes.length ?? 0;
  useEffect(() => {
    if (!nodesInitialized || nodeCount === 0) return undefined;
    fitView({ padding: 0.2, duration: 0, maxZoom: 1.1, minZoom: 0.15 });
    const settle = setTimeout(() => fitView({ padding: 0.2, duration: 0, maxZoom: 1.1, minZoom: 0.15 }), 420);
    return () => clearTimeout(settle);
  }, [nodesInitialized, nodeCount, fitView]);

  if (!laid || !flow) return <div style={{ color: '#c0392b', fontSize: 13 }}>diagram unavailable</div>;

  const { nodes, edges } = flow;
  const { note, stepNum, stepTotal } = state;
  const hasTrace = stepTotal > 0; // (was Boolean(note) — AlgorithmStage passes note:'' and lost the trace styling)

  // Give the canvas enough room that fitView never has to clip a tall graph; ReactFlow's
  // fitView still zooms to frame everything, but a too-short box was cropping vertical chains.
  const height = Math.min(560, Math.max(240, laid.height + 60));
  return (
    <div>
      {hasTrace ? (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6, fontSize: 11.5, fontFamily: 'ui-monospace, monospace', color: '#5a4a2a' }}>
          <LegendChip swatch={{ background: '#ffd9a8', border: '2px solid #d35400' }} label="current" />
          <LegendChip swatch={{ background: '#eafaf0', border: '2px solid #27ae60' }} label="visited" />
          <LegendChip swatch={{ background: '#fbf8f2', border: '2px solid #b8b0a0' }} label="not yet" />
          {state.memo.size > 0 ? <LegendChip swatch={{ background: '#f3e8fb', border: '2px solid #8e44ad' }} label="from memo" /> : null}
          {Object.keys(state.returned).length > 0 ? <LegendChip swatch={{ background: '#eafaf0', border: '2px solid #27ae60' }} label="= returned value" /> : null}
          <LegendChip swatch={{ background: 'transparent', borderBottom: '3px solid #e8604c', borderRadius: 0, height: 3, marginTop: 6 }} label="active edge" />
        </div>
      ) : null}
      <div style={{ height, border: '1px solid #e8ddc9', borderRadius: 12, background: '#fffdf8' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
          minZoom={0.15}
          // onInit fires once ReactFlow has mounted AND measured the nodes — the reliable moment
          // to frame the whole graph. The useNodesInitialized effect alone was not firing in
          // static (non-clock) renders, leaving the graph at raw layout coords (clipped).
          onInit={(instance) => instance.fitView({ padding: 0.2, maxZoom: 1.1, minZoom: 0.15 })}
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
