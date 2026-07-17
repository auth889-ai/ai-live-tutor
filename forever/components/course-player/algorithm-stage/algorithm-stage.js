'use client';

// AlgorithmStage — the elite DSA teaching surface, CLOCK-DRIVEN and GENERIC. One ExecutionTrace
// drives every panel from the audio clock (traceStateAtMs) so the code line, structure, pointers,
// stack/queue, DP table and trace table all advance TOGETHER, synced to the tutor's words:
//   code line active · structure (array/grid/graph: current, visited, active edge, pointers,
//   compare/swap, DP cell) · stack/queue · growing trace table · subtitle.
// Deterministic: seeking to a time reproduces the exact state. No setTimeout. Views are chosen by
// what the trace DECLARES (views.array / views.array2d / views.graph), so the same stage renders
// arrays, sorting, DP, grids, trees, graphs, recursion and linked lists — one primitive, not many.

import { useEffect, useMemo, useState } from 'react';

import { traceStateAtMs, traceStateAt } from '../../../lib/board/execution/execution-trace.js';
import { CodePanel } from '../panels/code-panel.js';
import { RetracePanel } from './retrace-panel.js';
import { ArrayView } from '../panels/array-view.js';
import { GraphView } from '../panels/graph-view.js';
import { LinkedListView } from '../panels/linked-list-view.js';
import { GridView } from './grid-view.js';
import { IntervalsView } from '../panels/intervals-view.js';
import { TraceTable } from './trace-table.js';
import { CompositionCockpit } from '../panels/composition-cockpit.js';

export function AlgorithmStage({ trace: lessonTrace, tMs = 0, progress = 1, stepIndex = null, setHold }) {
  // LIVE INSTRUMENT: the student can re-run the engine on their own input (RetracePanel);
  // the whole stage then animates THEIR scenario. liveTrace overrides the lesson's trace;
  // exploring is forced so the voice (which narrates the LESSON's trace) holds until they
  // return to the lesson.
  const [liveTrace, setLiveTrace] = useState(null);
  const trace = liveTrace ?? lessonTrace;
  // EXPLORE MODE (research-backed: stepping beats speed control — Hansen JVLC; self-paced
  // rewind/forward measurably improves comprehension). The student can leave the voice at any
  // moment, walk the dry run step by step in BOTH directions (buttons or ←/→ keys), then jump
  // back to the tutor. While exploring, playback holds — the voice never talks over the wrong
  // frame. This is the interactivity a video teacher cannot offer.
  const [explore, setExplore] = useState(null); // null = follow the voice
  // C7: when the Semantic Visual Director's ACCEPTED spec rides the trace, the student can
  // flip to the AI-composed cockpit; the deterministic stage stays the default (preview).
  const [aiCockpit, setAiCockpit] = useState(false);
  // STABLE graph content, built ONCE per trace (the playback-visibility fix): the clock ticks
  // many times a second, and rebuilding this object every tick made ReactFlow re-layout and
  // re-measure continuously — the tree only painted when playback PAUSED. With a stable
  // identity, ReactFlow settles once; per-tick changes are just the activeStep number.
  const graphContent = useMemo(() => {
    const g = trace?.views?.graph;
    if (!g) return null;
    return {
      nodes: g.nodes,
      edges: g.edges,
      directed: g.directed,
      // note = the step's real narration; GraphView renders a short clause of it as a
      // hand-drawn callout anchored to the current node (target graph.png). values = the
      // step's per-node numbers (dist/indegree) so they render ON the drawing — the
      // instructors write these beside each node and rewrite them on every improvement.
      trace: (trace.steps ?? []).map((s) => ({ note: s.explanation ?? '', ...(s.graph ?? {}), activeEdge: s.activeEdge, values: s.traceRow ?? null, nodeState: s.nodeState ?? null })),
    };
  }, [trace]);

  const total = trace?.steps?.length ?? 0;
  // Playback holds while the student explores; releases the moment they rejoin the voice.
  useEffect(() => {
    setHold?.(explore !== null);
    return () => setHold?.(false);
  }, [explore, setHold]);
  // ←/→ step the dry run while exploring (or ← starts exploring from the current frame).
  useEffect(() => {
    const onKey = (e) => {
      if (total === 0) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      setExplore((cur) => {
        const base = cur ?? currentClockIndex();
        return Math.max(0, Math.min(total - 1, base + (e.key === 'ArrowRight' ? 1 : -1)));
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!trace?.steps?.length) return null;
  // Priority: the student's explore position > explicit voice-synced step > timed clock >
  // write-progress fallback. All deterministic; none use setTimeout.
  function currentClockIndex() {
    if (stepIndex != null) return Math.max(0, Math.min(trace.steps.length - 1, stepIndex));
    if (trace.steps[0]?.startMs !== undefined) return traceStateAtMs(trace, tMs).index;
    return traceStateAt(trace, progress).index;
  }
  const index = explore !== null ? Math.max(0, Math.min(total - 1, explore)) : currentClockIndex();
  const step = trace.steps[index];
  const cockpitSpec = trace.meta?.cockpitSpec;
  if (aiCockpit && cockpitSpec) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button onClick={() => setAiCockpit(false)} style={{ alignSelf: 'flex-start', border: '1px solid #f0dcd5', borderRadius: 999, background: '#fff', color: '#8a3a12', padding: '4px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
          ← deterministic view
        </button>
        <CompositionCockpit spec={cockpitSpec} trace={trace} stepIndex={index} />
      </div>
    );
  }
  const historySteps = trace.steps.slice(0, index + 1); // full step objects, for accumulation
  const views = trace.views ?? {};

  // The VisuAlgo/mockup arrangement: the STRUCTURE owns the left (it is the lesson), with the
  // visited-order strip and the growing trace table under it; the code rides the right with the
  // step explanation and live variables directly beneath — the eye path a human tutor points:
  // tree → order → table, code → why → state. One step object feeds both columns (atomic sync).
  // Layout (target tree2.png): a top row with the STRUCTURE on the left (it is the lesson) and
  // the code + live state as a right rail; then the Dry Run Trace table FULL-WIDTH beneath, so
  // its Node/Queue/Visited/Action columns have room to breathe instead of being crushed.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ flex: '1.6 1 420px', minWidth: 320, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {views.array && step.array ? (
          <ArrayView content={{ values: views.array.values, trace: [{ note: '', ...step.array }] }} activeStep={0} />
        ) : null}
        {views.array2d && step.array2d ? <GridView view={views.array2d} step={step} history={historySteps} /> : null}
        {views.intervals ? (
          <IntervalsView
            content={{ intervals: views.intervals.intervals, trace: trace.steps.map((s) => ({ ...(s.intervals ?? {}) })) }}
            activeStep={index}
          />
        ) : null}
        {/* Mounted for the WHOLE trace, never per-step: unmounting on a step without `graph`
            state forces ReactFlow to remount, re-measure and re-fit — the flicker/invisible
            class of bugs. A step with no graph payload simply renders the tree unhighlighted. */}
        {graphContent ? <GraphView content={graphContent} activeStep={index} /> : null}
        {views.list ? (
          <LinkedListView
            content={{ trace: trace.steps.map((s) => ({ note: '', ...(s.list ?? {}) })) }}
            activeStep={index}
          />
        ) : null}
        {views.graph ? <OrderStrip step={step} nodes={views.graph.nodes ?? []} /> : null}
        {/* The Dry Run Trace sits directly under the structure (target tree2.png) in the wide
            centre column — the eye path tree → order → table. */}
        <TraceTable
          history={historySteps}
          allSteps={trace.steps}
          nodeLabels={views.graph ? Object.fromEntries((views.graph.nodes ?? []).map((n) => [String(n.id), String(n.label ?? n.id)])) : null}
        />
      </div>

      <div style={{ flex: '1 1 340px', minWidth: 300, maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <CodePanel codeObject={{ content: trace.code, language: trace.language }} revealProgress={1} activeLine={step.line} />
        <StepControls
          index={index}
          total={total}
          exploring={explore !== null}
          onStep={(delta) => setExplore(Math.max(0, Math.min(total - 1, index + delta)))}
          onJump={(to) => setExplore(Math.max(0, Math.min(total - 1, to)))}
          onFollow={() => { setLiveTrace(null); setExplore(null); }}
        />
        {trace.meta ? (
          <RetracePanel
            key={liveTrace ? 'live' : 'lesson'}
            meta={trace.meta}
            onTrace={(next) => { setLiveTrace(next); setExplore(0); }}
          />
        ) : null}
        {liveTrace ? (
          <div style={{ fontSize: 12, color: '#c0522d', fontWeight: 700 }}>
            ⚗️ your own run — step through it; “resume voice” returns to the lesson’s example
          </div>
        ) : null}
        {trace.views?.bitmask && step.maskState ? <MaskPanel maskState={step.maskState} bitmask={trace.views.bitmask} /> : null}
        {cockpitSpec ? (
          <button onClick={() => setAiCockpit(true)} style={{ alignSelf: 'flex-start', border: '1.5px solid #f0c39a', borderRadius: 999, background: 'linear-gradient(180deg,#fffdf9,#fff5ec)', color: '#8a3a12', padding: '4px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
            ✨ AI-composed cockpit (preview)
          </button>
        ) : null}
        <Caption index={index} total={trace.steps.length} text={step.explanation} />
        <Vars step={step} />
        <Collections step={step} />
      </div>
      </div>
    </div>
  );
}

// Explore controls (research: stepping beats speed control): first/prev/next/last, a scrubber
// over the steps, ←/→ keys, and a one-tap return to the voice. Prediction-friendly: a student
// can pause before a step and guess what happens next — active engagement, not passive watching.
function StepControls({ index, total, exploring, onStep, onJump, onFollow }) {
  const btn = (disabled) => ({
    border: '1px solid #f0dcd5', borderRadius: 8, background: disabled ? '#f7f2e8' : '#fff',
    color: disabled ? '#c9bda1' : '#2b211a', padding: '4px 10px', fontSize: 13, fontWeight: 800,
    cursor: disabled ? 'default' : 'pointer',
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: '1px solid #f0dcd5', borderRadius: 10, background: '#fffcfa', flexWrap: 'wrap' }}>
      <button style={btn(index === 0)} disabled={index === 0} onClick={() => onJump(0)} title="First step">⏮</button>
      <button style={btn(index === 0)} disabled={index === 0} onClick={() => onStep(-1)} title="Previous step (←)">◀</button>
      <input
        type="range"
        min={0}
        max={Math.max(0, total - 1)}
        value={index}
        onChange={(e) => onJump(Number(e.target.value))}
        style={{ flex: '1 1 90px', accentColor: '#e8604c' }}
        aria-label="Dry-run step"
      />
      <button style={btn(index >= total - 1)} disabled={index >= total - 1} onClick={() => onStep(1)} title="Next step (→)">▶</button>
      <button style={btn(index >= total - 1)} disabled={index >= total - 1} onClick={() => onJump(total - 1)} title="Last step">⏭</button>
      <span style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace', color: '#8a6d3b', whiteSpace: 'nowrap' }}>step {index + 1}/{total}</span>
      {exploring ? (
        <button
          onClick={onFollow}
          style={{ border: 'none', borderRadius: 999, background: '#e8604c', color: '#fff', padding: '5px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}
          title="Rejoin the tutor's voice"
        >
          ▶ resume voice
        </button>
      ) : (
        <span style={{ fontSize: 11.5, color: '#b3a889' }}>following voice — step to explore</span>
      )}
    </div>
  );
}

// Bitmask panel (D2, mockup: "Bitmask Legend / Current Expanded State"): the current state's
// mask as per-bit chips (filled = node covered by this path) + binary + target readout.
function MaskPanel({ maskState, bitmask }) {
  const covered = new Set(maskState.visited ?? []);
  return (
    <div style={{ border: '1px solid #f0dcd5', borderRadius: 10, background: '#fffcfa', padding: 10 }}>
      <div style={{ fontSize: 11, color: '#8e44ad', fontWeight: 700, marginBottom: 6, fontFamily: 'ui-monospace, monospace' }}>
        state mask · {maskState.binary} ({maskState.mask}) · target {(bitmask.target ?? 0).toString(2).padStart(bitmask.bits, '0')}
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {Array.from({ length: bitmask.bits }, (_, b) => String(b)).map((b) => (
          <span key={b} style={{
            minWidth: 30, textAlign: 'center', padding: '4px 8px', borderRadius: 6,
            border: `2px solid ${covered.has(b) ? '#6f3391' : '#e0d5bf'}`,
            background: covered.has(b) ? '#8e44ad' : '#fff', color: covered.has(b) ? '#fff' : '#9a9182',
            fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: 13,
          }}>
            {b}
          </span>
        ))}
      </div>
      {maskState.mask === bitmask.target ? (
        <div style={{ marginTop: 6, fontSize: 12, fontWeight: 800, color: '#20794a' }}>✓ every node covered — target state reached</div>
      ) : null}
    </div>
  );
}

function Caption({ index, total, text }) {
  return (
    <div style={{ borderRadius: 10, background: '#fff8f4', border: '1px solid #f0dcd5', overflow: 'hidden' }}>
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
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 12px', border: '1px solid #f0dcd5', borderRadius: 10, background: '#fffcfa' }}>
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
// A dict/list variable must read as JSON, not "[object Object]" (String() on an object) —
// line-sim captures real dicts/lists (pairs={...}, seen={...}), and the panel showed them broken.
function fmtValue(value) {
  if (value === null) return 'None';
  if (typeof value === 'object') { try { return JSON.stringify(value); } catch { return String(value); } }
  return String(value);
}

function Vars({ step }) {
  const vars = step.variables;
  if (!vars || typeof vars !== 'object' || Array.isArray(vars) || Object.keys(vars).length === 0) return null;
  return (
    <div style={{ border: '1px solid #f0dcd5', borderRadius: 10, background: '#fffcfa', padding: 10 }}>
      <div style={{ fontSize: 11, color: '#2f7d4a', fontWeight: 700, marginBottom: 6, fontFamily: 'ui-monospace, monospace' }}>variables</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {Object.entries(vars).map(([name, value]) => (
          <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '2px solid #2f7d4a', borderRadius: 8, background: '#fff', padding: '3px 8px', fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>
            <span style={{ color: '#8a6d3b' }}>{name}</span>
            <span style={{ fontWeight: 800, color: '#2b211a' }}>= {fmtValue(value)}</span>
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
    <div style={{ flex: '1 1 140px', border: '1px solid #f0dcd5', borderRadius: 10, background: '#fffcfa', padding: 10 }}>
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
