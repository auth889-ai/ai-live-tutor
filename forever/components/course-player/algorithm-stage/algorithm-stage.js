'use client';

// AlgorithmStage — the elite DSA teaching surface, CLOCK-DRIVEN and GENERIC. One ExecutionTrace
// drives every panel from the audio clock (traceStateAtMs) so the code line, structure, pointers,
// stack/queue, DP table and trace table all advance TOGETHER, synced to the tutor's words:
//   code line active · structure (array/grid/graph: current, visited, active edge, pointers,
//   compare/swap, DP cell) · stack/queue · growing trace table · subtitle.
// Deterministic: seeking to a time reproduces the exact state. No setTimeout. Views are chosen by
// what the trace DECLARES (views.array / views.array2d / views.graph), so the same stage renders
// arrays, sorting, DP, grids, trees, graphs, recursion and linked lists — one primitive, not many.

import { traceStateAtMs, traceStateAt } from '../../../lib/board/execution/execution-trace.js';
import { CodePanel } from '../panels/code-panel.js';
import { ArrayView } from '../panels/array-view.js';
import { GraphView } from '../panels/graph-view.js';
import { GridView } from './grid-view.js';
import { TraceTable } from './trace-table.js';

export function AlgorithmStage({ trace, tMs = 0, progress = 1, stepIndex = null }) {
  if (!trace?.steps?.length) return null;
  // Priority: an explicit step (voice-synced, one line per step) > timed clock (startMs/endMs) >
  // write-progress fallback. All deterministic; none use setTimeout.
  let index;
  if (stepIndex != null) index = Math.max(0, Math.min(trace.steps.length - 1, stepIndex));
  else if (trace.steps[0]?.startMs !== undefined) index = traceStateAtMs(trace, tMs).index;
  else index = traceStateAt(trace, progress).index;
  const step = trace.steps[index];
  const historySteps = trace.steps.slice(0, index + 1); // full step objects, for accumulation
  const views = trace.views ?? {};

  // The VisuAlgo/mockup arrangement: the STRUCTURE owns the left (it is the lesson), with the
  // visited-order strip and the growing trace table under it; the code rides the right with the
  // step explanation and live variables directly beneath — the eye path a human tutor points:
  // tree → order → table, code → why → state. One step object feeds both columns (atomic sync).
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ flex: '1.4 1 380px', minWidth: 320, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {views.array && step.array ? (
          <ArrayView content={{ values: views.array.values, trace: [{ note: '', ...step.array }] }} activeStep={0} />
        ) : null}
        {views.array2d && step.array2d ? <GridView view={views.array2d} step={step} history={historySteps} /> : null}
        {views.graph && step.graph ? (
          <GraphView content={{ nodes: views.graph.nodes, edges: views.graph.edges, directed: views.graph.directed, trace: [{ note: '', ...step.graph, activeEdge: step.activeEdge }] }} activeStep={0} />
        ) : null}
        {views.graph ? <OrderStrip step={step} nodes={views.graph.nodes ?? []} /> : null}
        <TraceTable history={historySteps} />
      </div>

      <div style={{ flex: '1 1 320px', minWidth: 300, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <CodePanel codeObject={{ content: trace.code, language: trace.language }} revealProgress={1} activeLine={step.line} />
        <Caption index={index} total={trace.steps.length} text={step.explanation} />
        <Vars step={step} />
        <Collections step={step} />
      </div>
    </div>
  );
}

function Caption({ index, total, text }) {
  return (
    <div style={{ borderRadius: 10, background: '#fffaf0', border: '1px solid #e8ddc9', overflow: 'hidden' }}>
      <div style={{ padding: '6px 14px', borderBottom: '1px solid #efe6d3', fontSize: 11, fontWeight: 700, color: '#d35400', fontFamily: 'ui-monospace, monospace' }}>
        Output / Explanation · Step {index + 1} of {total}
      </div>
      <div style={{ padding: '10px 14px', fontSize: 14, color: '#5a4a2a', lineHeight: 1.5 }}>{text}</div>
    </div>
  );
}

// "BFS Order (so far)" strip from the mockup: one slot per node; visited nodes fill their slot
// in VISIT ORDER as the trace reaches them, the rest stay empty outlines — the progress of the
// traversal readable at a glance. step.graph.visited is cumulative in the trace contract.
function OrderStrip({ step, nodes }) {
  const labelOf = new Map(nodes.map((n) => [String(n.id), String(n.label ?? n.id)]));
  const visited = (step.graph?.visited ?? []).map(String);
  const slots = nodes.length;
  if (slots === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 12px', border: '1px solid #e8ddc9', borderRadius: 10, background: '#fffdf8' }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#8a6d3b', fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>Visit order (so far):</span>
      {Array.from({ length: slots }, (_, i) => {
        const id = visited[i];
        const isCurrent = id != null && String(step.graph?.current) === id && i === visited.length - 1;
        return (
          <span
            key={i}
            style={{
              minWidth: 34,
              textAlign: 'center',
              padding: '5px 8px',
              borderRadius: 8,
              fontFamily: 'ui-monospace, monospace',
              fontWeight: 800,
              fontSize: 13,
              border: id != null ? (isCurrent ? '2px solid #e8604c' : '2px solid #2f7d4a') : '2px dashed #e0d5bf',
              background: id != null ? (isCurrent ? '#fdf0ee' : '#eef7f0') : '#fff',
              color: id != null ? '#2b211a' : '#c9bda1',
            }}
          >
            {id != null ? labelOf.get(id) ?? id : ''}
          </span>
        );
      })}
    </div>
  );
}

// Variables panel (Python Tutor's essential panel): the step's key variables as chips,
// rendered from THE SAME step object as the code line, structure and caption — so
// "i=3, maxLen=2" changes at the exact moment the tutor says it. Values that changed
// since the previous step get the accent ring.
function Vars({ step }) {
  const vars = step.variables;
  if (!vars || typeof vars !== 'object' || Array.isArray(vars) || Object.keys(vars).length === 0) return null;
  return (
    <div style={{ border: '1px solid #e8ddc9', borderRadius: 10, background: '#fffdf8', padding: 10 }}>
      <div style={{ fontSize: 11, color: '#2f7d4a', fontWeight: 700, marginBottom: 6, fontFamily: 'ui-monospace, monospace' }}>variables</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {Object.entries(vars).map(([name, value]) => (
          <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '2px solid #2f7d4a', borderRadius: 8, background: '#fff', padding: '3px 8px', fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>
            <span style={{ color: '#8a6d3b' }}>{name}</span>
            <span style={{ fontWeight: 800, color: '#2b211a' }}>= {String(value)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Collections({ step }) {
  const hasStack = Array.isArray(step.stack);
  const hasQueue = Array.isArray(step.queue);
  if (!hasStack && !hasQueue) return null;
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {hasStack ? <Collection label="stack (top →)" items={[...step.stack].reverse()} accent="#8e44ad" /> : null}
      {hasQueue ? <Collection label="queue (front →)" items={step.queue} accent="#2980b9" /> : null}
    </div>
  );
}

function Collection({ label, items, accent }) {
  return (
    <div style={{ flex: '1 1 140px', border: '1px solid #e8ddc9', borderRadius: 10, background: '#fffdf8', padding: 10 }}>
      <div style={{ fontSize: 11, color: accent, fontWeight: 700, marginBottom: 6, fontFamily: 'ui-monospace, monospace' }}>{label}</div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {items.length === 0 ? (
          <span style={{ color: '#b3a889', fontSize: 12, fontStyle: 'italic' }}>empty</span>
        ) : (
          items.map((v, i) => (
            <span key={i} style={{ minWidth: 30, textAlign: 'center', padding: '4px 8px', border: `2px solid ${accent}`, borderRadius: 6, background: '#fff', color: '#3a3327', fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 13 }}>
              {String(v)}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
