'use client';

// AlgorithmStage — the elite DSA teaching surface. ONE ExecutionTrace drives FIVE synced
// panels, all advanced together by the lesson clock (progress -> step index), so the student
// sees a real dry run the way Striver/VisuAlgo do:
//   1. Code panel      — the active line highlights
//   2. Structure panel — array/graph: current node, visited, pointers move
//   3. Collections     — stack / queue change (push/pop, enqueue/dequeue)
//   4. Trace table     — variables (i, low, mid, high...) accumulate row by row
//   5. Explanation     — the plain-English reason for THIS step (spoken in sync)
// The trace state comes from real execution (Execution Tracer), so every panel is consistent.

import { traceStateAt } from '../../../lib/board/execution/execution-trace.js';
import { CodePanel } from './code-panel.js';
import { ArrayView } from './array-view.js';
import { GraphView } from './graph-view.js';

export function AlgorithmStage({ trace, progress = 1 }) {
  if (!trace?.steps?.length) return null;
  const { step, history } = traceStateAt(trace, progress);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* explanation — the one voice-synced line for this step */}
      <div
        style={{
          padding: '10px 14px',
          borderRadius: 10,
          background: '#fffaf0',
          border: '1px solid #e8ddc9',
          fontSize: 14,
          color: '#5a4a2a',
          display: 'flex',
          gap: 10,
          alignItems: 'baseline',
        }}
      >
        <span style={{ color: '#d35400', fontWeight: 700, whiteSpace: 'nowrap' }}>Step {history.length}/{trace.steps.length}</span>
        <span>{step.explanation}</span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
        {/* left: code with the active line lit */}
        <div style={{ flex: '1 1 340px', minWidth: 300 }}>
          <CodePanel codeObject={{ content: trace.code, language: trace.language }} revealProgress={1} activeLine={step.line} />
        </div>

        {/* right: structure + collections + variables */}
        <div style={{ flex: '1 1 340px', minWidth: 300, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <StructurePanel trace={trace} step={step} />
          <CollectionsPanel step={step} />
          <VariableTable trace={trace} history={history} />
        </div>
      </div>
    </div>
  );
}

// Render the current step's structure STATE by handing our existing views a single-step trace
// (note='' so they don't draw their own caption — the stage owns the explanation line).
function StructurePanel({ trace, step }) {
  if (trace.views?.array && step.array) {
    const content = { values: trace.views.array.values, trace: [{ note: '', ...step.array }] };
    return <ArrayView content={content} progress={1} />;
  }
  if (trace.views?.graph && step.graph) {
    const g = trace.views.graph;
    const content = { nodes: g.nodes, edges: g.edges, directed: g.directed, trace: [{ note: '', ...step.graph }] };
    return <GraphView content={content} progress={1} />;
  }
  return null;
}

function CollectionsPanel({ step }) {
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
            <span
              key={i}
              style={{
                minWidth: 30,
                textAlign: 'center',
                padding: '4px 8px',
                border: `2px solid ${accent}`,
                borderRadius: 6,
                background: '#fff',
                color: '#3a3327',
                fontFamily: 'ui-monospace, monospace',
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              {String(v)}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

// The dry-run trace table: one row per step so far, columns are the union of variables seen.
function VariableTable({ trace, history }) {
  const columns = [];
  for (const h of history) for (const k of Object.keys(h.variables)) if (!columns.includes(k)) columns.push(k);
  if (columns.length === 0) return null;
  return (
    <div style={{ overflowX: 'auto', border: '1px solid #e8ddc9', borderRadius: 10, background: '#fffdf8' }}>
      <div style={{ padding: '6px 12px', fontSize: 12, color: '#8a6d3b', background: '#fdeaa7' }}>Dry run — variables at each step</div>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, fontFamily: 'ui-monospace, monospace' }}>
        <thead>
          <tr>
            <th style={vcell(true)}>#</th>
            <th style={vcell(true)}>line</th>
            {columns.map((c) => <th key={c} style={vcell(true)}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {history.map((h, i) => {
            const current = i === history.length - 1;
            return (
              <tr key={i} style={current ? { background: '#fff3d6' } : undefined}>
                <td style={{ ...vcell(false), color: '#8a6d3b' }}>{h.step}</td>
                <td style={{ ...vcell(false), color: '#8a6d3b' }}>L{h.line}</td>
                {columns.map((c) => <td key={c} style={vcell(false)}>{c in h.variables ? String(h.variables[c]) : ''}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function vcell(header) {
  return {
    border: '1px solid #e8ddc9',
    padding: '5px 10px',
    textAlign: 'left',
    background: header ? '#fdeaa7' : 'transparent',
    fontWeight: header ? 700 : 400,
  };
}
