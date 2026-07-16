'use client';

// COMPOSITION COCKPIT (C3): renders a validated SemanticVisualSpec over ONE engine trace —
// the deterministic merge (Layer 3) on screen. Every value comes through resolveBinding
// (missing renders as an em-dash with the reason in the tooltip, NEVER a fake number);
// an invalid spec renders nothing and the caller falls back to the default cockpit.

import { useMemo } from 'react';

import { GraphView } from './graph-view.js';
import { CallStackPanel } from './call-stack-panel.js';
import { resolveBinding } from '../../../lib/board/composition/binding.js';
import { normalizeSpec } from '../../../lib/board/composition/panel-registry.js';

function PanelTitle({ children, color = '#d35400' }) {
  return <div style={{ fontSize: 11, color, fontWeight: 700, marginBottom: 6, fontFamily: 'ui-monospace, monospace' }}>{children}</div>;
}

function Cell({ result }) {
  if (result.status === 'resolved') return <span style={{ fontWeight: 800 }}>{String(result.value)}</span>;
  return <span title={result.reason ?? result.status} style={{ color: '#c9bda1' }}>—</span>;
}

function StateTable({ panel, frame, nodes }) {
  return (
    <div style={{ border: '1px solid #f0dcd5', borderRadius: 10, background: '#fffcfa', padding: 10, overflowX: 'auto' }}>
      <PanelTitle color="#2f7d4a">{panel.title ?? 'State'}</PanelTitle>
      <table style={{ borderCollapse: 'collapse', fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>
        <thead>
          <tr>
            <th style={{ padding: '3px 10px', borderBottom: '2px solid #efe6d3', textAlign: 'left', color: '#8a6d3b' }}>Node</th>
            {panel.columns.map((c) => <th key={c.label} style={{ padding: '3px 10px', borderBottom: '2px solid #efe6d3', textAlign: 'left', color: '#8a6d3b' }}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => (
            <tr key={n.id}>
              <td style={{ padding: '3px 10px', fontWeight: 800 }}>{n.label ?? n.id}</td>
              {panel.columns.map((c) => (
                <td key={c.label} style={{ padding: '3px 10px' }}>
                  <Cell result={resolveBinding(c.binding, frame, { context: { node: { id: String(n.id) } }, expect: 'scalar' })} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CompositionCockpit({ spec: rawSpec, trace, stepIndex = 0 }) {
  const norm = useMemo(() => normalizeSpec(rawSpec), [rawSpec]);
  const graphContent = useMemo(() => {
    const g = trace?.views?.graph;
    if (!g) return null;
    return {
      nodes: g.nodes, edges: g.edges, directed: g.directed,
      trace: (trace.steps ?? []).map((s) => ({ note: s.explanation ?? '', ...(s.graph ?? {}), activeEdge: s.activeEdge, values: s.traceRow ?? null, nodeState: s.nodeState ?? null })),
    };
  }, [trace]);
  if (!norm.ok || !trace?.steps?.length) return null;
  const index = Math.max(0, Math.min(trace.steps.length - 1, stepIndex));
  const frame = trace.steps[index];
  const nodes = trace.views?.graph?.nodes ?? [];

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ flex: '1.7 1 440px', minWidth: 340, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {norm.spec.panels.filter((p) => p.type === 'graph').map((p, i) => (
          <div key={`g${i}`}>
            <PanelTitle>{p.title ?? 'Graph'}</PanelTitle>
            {graphContent ? <GraphView content={graphContent} activeStep={index} /> : null}
          </div>
        ))}
      </div>
      <div style={{ flex: '1 1 320px', minWidth: 280, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {norm.spec.panels.map((p, i) => {
          if (p.type === 'call-stack') return <CallStackPanel key={i} frames={frame.frames} lastReturn={frame.lastReturn} title={p.title ?? 'Call Stack'} />;
          if (p.type === 'state-table') return <StateTable key={i} panel={p} frame={frame} nodes={nodes} />;
          if (p.type === 'queue') {
            return (
              <div key={i} style={{ border: '1px solid #f0dcd5', borderRadius: 10, background: '#fffcfa', padding: 10 }}>
                <PanelTitle color="#2980b9">{p.title ?? 'Queue'}</PanelTitle>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {(frame.queue ?? []).map((v, k) => (
                    <span key={k} style={{ padding: '4px 8px', border: '2px solid #2980b9', borderRadius: 6, background: '#fff', fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 13 }}>{String(v)}</span>
                  ))}
                  {(frame.queue ?? []).length === 0 ? <span style={{ color: '#b3a889', fontSize: 12, fontStyle: 'italic' }}>empty</span> : null}
                </div>
              </div>
            );
          }
          if (p.type === 'concept-card') {
            return (
              <div key={i} style={{ border: '1.5px solid #f0c39a', borderRadius: 11, background: 'linear-gradient(180deg,#fffdf9,#fff5ec)', padding: '10px 14px' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#8a3a12', marginBottom: 4 }}>💡 {p.title ?? 'Concept'}</div>
                <div style={{ fontSize: 13, color: '#5a4a2a', lineHeight: 1.5, fontFamily: 'ui-monospace, monospace' }}>{p.content}</div>
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
