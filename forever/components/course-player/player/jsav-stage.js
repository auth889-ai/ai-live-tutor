'use client';

// JSAV STAGE — flag-gated EXPERIMENT (NEXT_PUBLIC_JSAV_RENDERER=1; default OFF, and this
// component is not mounted by any default path, so the existing renderer is untouched when
// the flag is unset). It renders an algorithm object by replaying the abstract JSAV ops from
// lib/board/execution/jsav-adapter.js — the pure trace->ops translation is the product here.
//
// HONESTY NOTE (full JSAV runtime embedding: PARKED). The vendored library
// (vendor/jsav/src/*) is pre-module global-script code: every file is an IIFE closed over
// global `jQuery` — (function($){...}(jQuery)) — the build (vendor/jsav/Makefile) simply
// concatenates front.js + 20 modules into one script, and core.js calls `Raphael(...)` at
// init. Executing it inside Next's ESM bundle would need: jquery + jquery-ui +
// jquery.transit + raphael as npm deps exposed as window globals BEFORE a generated concat
// bundle is eval'd via an injected <script> — a side-effect global-script pipeline, not an
// import. That is brittle in this build and is therefore parked; this fallback consumes the
// SAME abstract op stream, so a real JSAV backend can be swapped in behind the same ops.
//
// The law holds either way: Forever's ExecutionTrace decides every step; this surface only
// replays the ops derived from it.

import { useMemo } from 'react';

import { traceToJsavOps } from '../../../lib/board/execution/jsav-adapter.js';

const KIND_COLORS = {
  current: '#e8604c', comparing: '#e8a13c', read: '#2980b9', chosen: '#8e44ad',
  dep: '#2980b9', sorted: '#2f7d4a', active: '#e8604c', memo: '#8e44ad',
};

// Replay the ordered ops up to (and including) stepIndex into a render model. Pure.
export function replayOps(ops, trace, stepIndex) {
  const views = trace?.views ?? {};
  const model = {
    line: null,
    message: '',
    array: Array.isArray(views.array?.values) ? { values: [...views.array.values], marks: new Map(), dims: new Set(), pointers: new Map() } : null,
    matrix: views.array2d ? {
      rows: views.array2d.rows, cols: views.array2d.cols,
      cells: Array.from({ length: views.array2d.rows }, () => Array.from({ length: views.array2d.cols }, () => '')),
      marks: new Map(),
    } : null,
    graph: views.graph ? {
      declared: views.graph.nodes ?? [],
      shown: new Set(), // tree mode: nodes revealed by addNode; graph mode: all declared
      treeMode: false,
      edges: [], // tree mode: edges added so far
      declaredEdges: (views.graph.edges ?? []).map((e) => [String(e.from), String(e.to)]),
      visited: new Set(),
      marks: new Map(),
      values: new Map(),
      backtracked: new Set(),
      activeEdge: null,
    } : null,
    collections: new Map(), // name -> items[]
  };
  if (model.graph) for (const n of model.graph.declared) model.graph.shown.add(String(n.id));

  for (const op of ops) {
    if (op.stepIndex > stepIndex) break;
    const kind = op.meta?.kind;
    switch (`${op.structure}:${op.op}`) {
      case 'code:setLine': model.line = op.target; break;
      case 'message:umsg': case 'message:note': model.message = String(op.value ?? ''); break;

      case 'array:setValue': if (model.array) model.array.values[op.target] = op.value; break;
      case 'array:swap': if (model.array) {
        const [i, j] = op.target;
        [model.array.values[i], model.array.values[j]] = [model.array.values[j], model.array.values[i]];
      } break;
      case 'array:highlight': model.array?.marks.set(op.target, kind ?? 'current'); break;
      case 'array:unhighlight': model.array?.marks.delete(op.target); break;
      case 'array:dim': model.array?.dims.add(op.target); break;
      case 'array:movePointer': model.array?.pointers.set(op.meta?.name ?? '·', op.target); break;

      case 'matrix:setValue': if (model.matrix) model.matrix.cells[op.target[0]][op.target[1]] = op.value; break;
      case 'matrix:highlight': model.matrix?.marks.set(String(op.target), kind ?? 'current'); break;
      case 'matrix:unhighlight': model.matrix?.marks.delete(String(op.target)); break;

      case 'tree:addNode': if (model.graph) {
        if (!model.graph.treeMode) { model.graph.treeMode = true; model.graph.shown.clear(); }
        model.graph.shown.add(String(op.target));
      } break;
      case 'tree:addEdge': model.graph?.edges.push([String(op.target[0]), String(op.target[1])]); break;
      case 'graph:visit': model.graph?.visited.add(String(op.target)); break;
      case 'tree:highlight': case 'graph:highlight': model.graph?.marks.set(String(op.target), kind ?? 'current'); break;
      case 'tree:unhighlight': case 'graph:unhighlight': model.graph?.marks.delete(String(op.target)); break;
      case 'tree:setNodeValue': case 'graph:setNodeValue': model.graph?.values.set(String(op.target), op.value); break;
      case 'tree:backtrack': if (op.target != null) model.graph?.backtracked.add(String(op.target)); break;
      case 'tree:traverseEdge': case 'graph:inspectEdge':
        // the ridden edge only glows on ITS step — replaying past steps leaves it quiet
        if (model.graph) model.graph.activeEdge = op.stepIndex === stepIndex ? { pair: op.target.map(String), reverse: op.meta?.reverse === true } : null;
        break;

      case 'list:push': case 'list:enqueue': {
        const name = op.meta?.collection ?? 'stack';
        model.collections.set(name, [...(model.collections.get(name) ?? []), op.value]);
        break;
      }
      case 'list:pop': {
        const name = op.meta?.collection ?? 'stack';
        model.collections.set(name, (model.collections.get(name) ?? []).slice(0, -1));
        break;
      }
      case 'list:dequeue': {
        const name = op.meta?.collection ?? 'queue';
        model.collections.set(name, (model.collections.get(name) ?? []).slice(1));
        break;
      }
      default: break; // unknown abstract ops render nothing — same safety law as the adapter
    }
  }
  return model;
}

export function JsavStage({ trace, stepIndex = 0 }) {
  const enabled = process.env.NEXT_PUBLIC_JSAV_RENDERER === '1';
  const ops = useMemo(() => (enabled && trace ? traceToJsavOps(trace) : null), [enabled, trace]);
  if (!enabled || !trace?.steps?.length || !ops) return null;
  const idx = Math.max(0, Math.min(trace.steps.length - 1, stepIndex));
  const m = replayOps(ops, trace, idx);

  return (
    <div className="jsav-stage" style={{ display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid #f0dcd5', borderRadius: 10, background: '#fffcfa', padding: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: '#8a6d3b', fontFamily: 'ui-monospace, monospace' }}>
        JSAV op renderer (experiment) · step {idx + 1}/{trace.steps.length}{m.line != null ? ` · line ${m.line}` : ''}
      </div>
      {m.array ? <ArrayRow array={m.array} /> : null}
      {m.matrix ? <MatrixGrid matrix={m.matrix} /> : null}
      {m.graph ? <GraphCanvas graph={m.graph} /> : null}
      {[...m.collections.entries()].map(([name, items]) => (
        <div key={name} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#8a6d3b', fontFamily: 'ui-monospace, monospace' }}>{name}:</span>
          {items.length === 0 ? <span style={{ fontSize: 11, color: '#b3a889', fontStyle: 'italic' }}>empty</span> : items.map((v, i) => (
            <span key={i} style={{ padding: '2px 8px', border: '1.5px solid #2980b9', borderRadius: 6, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{String(v)}</span>
          ))}
        </div>
      ))}
      {m.message ? <div style={{ fontSize: 13, color: '#5a4a2a', lineHeight: 1.45 }}>{m.message}</div> : null}
    </div>
  );
}

function ArrayRow({ array }) {
  const ptrAt = new Map();
  for (const [name, i] of array.pointers) ptrAt.set(i, [...(ptrAt.get(i) ?? []), name]);
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      {array.values.map((v, i) => {
        const mark = array.marks.get(i);
        const color = mark ? KIND_COLORS[mark] ?? '#e8604c' : '#e0d5bf';
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#c0522d', fontFamily: 'ui-monospace, monospace', minHeight: 13 }}>
              {(ptrAt.get(i) ?? []).join(',')}
            </span>
            <span style={{
              minWidth: 34, textAlign: 'center', padding: '6px 4px', borderRadius: 6,
              border: `2px solid ${color}`, fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 13,
              background: mark ? '#fff5ec' : '#fff', opacity: array.dims.has(i) ? 0.35 : 1,
            }}>{String(v)}</span>
            <span style={{ fontSize: 9.5, color: '#b3a889', fontFamily: 'ui-monospace, monospace' }}>{i}</span>
          </div>
        );
      })}
    </div>
  );
}

function MatrixGrid({ matrix }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {matrix.cells.map((row, r) => (
            <tr key={r}>
              {row.map((v, c) => {
                const mark = matrix.marks.get(String([r, c]));
                const color = mark ? KIND_COLORS[mark] ?? '#e8604c' : '#e0d5bf';
                return (
                  <td key={c} style={{
                    border: `2px solid ${color}`, minWidth: 34, textAlign: 'center', padding: '5px 6px',
                    fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 12.5,
                    background: mark ? '#fff5ec' : v !== '' ? '#eef7f0' : '#fff',
                  }}>{String(v)}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Minimal node-link canvas: declared coords when present (recursion trees carry
// Reingold-Tilford x/y), otherwise a circle layout. Enough to SEE the op stream working.
function GraphCanvas({ graph }) {
  const nodes = graph.declared.filter((n) => graph.shown.has(String(n.id)));
  if (nodes.length === 0) return null;
  const hasCoords = nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y));
  const W = 460;
  const H = Math.max(180, Math.min(320, 60 * Math.ceil(Math.sqrt(nodes.length)) + 60));
  const pos = new Map();
  if (hasCoords) {
    const xs = nodes.map((n) => n.x); const ys = nodes.map((n) => n.y);
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)]; const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    const sx = (x) => 30 + (x1 === x0 ? (W - 60) / 2 : ((x - x0) / (x1 - x0)) * (W - 60));
    const sy = (y) => 26 + (y1 === y0 ? (H - 52) / 2 : ((y - y0) / (y1 - y0)) * (H - 52));
    for (const n of nodes) pos.set(String(n.id), { x: sx(n.x), y: sy(n.y) });
  } else {
    nodes.forEach((n, i) => {
      const a = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
      pos.set(String(n.id), { x: W / 2 + Math.cos(a) * (W / 2 - 40), y: H / 2 + Math.sin(a) * (H / 2 - 30) });
    });
  }
  const edges = graph.treeMode ? graph.edges : (graph.declaredEdges ?? []);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 560 }}>
      {edges.map(([from, to], i) => {
        const a = pos.get(from); const b = pos.get(to);
        if (!a || !b) return null;
        const active = graph.activeEdge && graph.activeEdge.pair[0] === from && graph.activeEdge.pair[1] === to;
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={active ? '#e8604c' : '#c9bda1'} strokeWidth={active ? 2.5 : 1.5} />;
      })}
      {graph.activeEdge && !graph.treeMode ? (() => {
        const [f, t] = graph.activeEdge.pair;
        const a = pos.get(f); const b = pos.get(t);
        return a && b ? <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#e8604c" strokeWidth={2.5} strokeDasharray={graph.activeEdge.reverse ? '5 4' : undefined} /> : null;
      })() : null}
      {nodes.map((n) => {
        const id = String(n.id);
        const p = pos.get(id);
        const mark = graph.marks.get(id);
        const stroke = mark ? KIND_COLORS[mark] ?? '#e8604c' : graph.visited.has(id) ? '#2f7d4a' : '#c9bda1';
        return (
          <g key={id}>
            <circle cx={p.x} cy={p.y} r={16} fill={graph.visited.has(id) ? '#eef7f0' : '#fff'} stroke={stroke} strokeWidth={mark ? 2.5 : 1.5} />
            <text x={p.x} y={p.y + 4} textAnchor="middle" style={{ fontSize: 10.5, fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>
              {String(n.label ?? n.id)}
            </text>
            {graph.values.has(id) ? (
              <text x={p.x} y={p.y + 28} textAnchor="middle" style={{ fontSize: 10, fill: '#2f7d4a', fontFamily: 'ui-monospace, monospace', fontWeight: 800 }}>
                = {String(graph.values.get(id))}
              </text>
            ) : null}
            {graph.backtracked.has(id) ? (
              <text x={p.x + 18} y={p.y - 12} style={{ fontSize: 11 }}>↩</text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
