'use client';

// Array dry-run visualizer — the canonical DSA animation (binary search, two-pointer, sliding
// window, sorting). A row of index-labelled cells; a trace WALKS it step by step driven by the
// lesson clock: named pointers (low/mid/high, i/j, slow/fast) point at cells, eliminated cells
// grey out, the current cell highlights orange, and the step note is captioned — synced to the
// tutor's words so it feels like a teacher moving their finger across the array.

// Resolve the visual state at the current clock position. activeStep (bound to the active
// narration line) wins over write-progress so pointers move exactly as the tutor speaks.
function resolveState({ content, progress, activeStep }) {
  const trace = Array.isArray(content.trace) && content.trace.length ? content.trace : null;
  if (!trace) return { pointerAt: new Map(), eliminated: new Set(), current: null, note: null, stepNum: 0, stepTotal: 0 };
  const idx = activeStep != null
    ? Math.max(0, Math.min(trace.length - 1, activeStep))
    : Math.min(trace.length - 1, Math.max(0, Math.floor(progress * trace.length + 1e-9)));
  const step = trace[idx];
  const eliminated = new Set((step.eliminated ?? []).map(Number));
  const pointerAt = new Map(); // cell index -> ['low','mid'] labels
  for (const [name, i] of Object.entries(step.pointers ?? {})) {
    const key = Number(i);
    if (!pointerAt.has(key)) pointerAt.set(key, []);
    pointerAt.get(key).push(name);
  }
  return {
    pointerAt,
    eliminated,
    comparing: new Set((step.comparing ?? []).map(Number)), // sorting: cells being compared
    swapped: new Set((step.swapped ?? []).map(Number)), // sorting: cells just swapped
    sorted: new Set((step.sorted ?? []).map(Number)), // sorting: cells locked in final place
    current: step.current != null ? Number(step.current) : null,
    liveValues: Array.isArray(step.values) ? step.values : null, // in-place algos: REAL contents at this step
    note: step.note,
    stepNum: idx + 1,
    stepTotal: trace.length,
  };
}

export function ArrayView({ content, progress = 1, activeStep = null }) {
  const values = Array.isArray(content.values) ? content.values : [];
  if (!values.length) return <div style={{ color: '#c0392b', fontSize: 13 }}>array unavailable</div>;

  const { pointerAt, eliminated, comparing, swapped, sorted, current, liveValues, note, stepNum, stepTotal } = resolveState({ content, progress, activeStep });
  const hasTrace = Boolean(note);
  // In-place algorithms (sorting, partitioning) carry the REAL array contents per step — the
  // cells rearrange in front of the student; static algorithms keep the declared values.
  const shown = liveValues && liveValues.length === values.length ? liveValues : values;

  return (
    <div style={{ border: '1px solid #e8ddc9', borderRadius: 12, background: '#fffdf8', padding: 14 }}>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
        {shown.map((value, i) => {
          const pointers = pointerAt.get(i);
          const isCurrent = i === current;
          const isEliminated = eliminated.has(i);
          const isComparing = comparing.has(i);
          const isSwapped = swapped.has(i);
          const isSorted = sorted.has(i);
          // priority: current > swapped > comparing > sorted > eliminated > default
          const border = isCurrent ? '#d35400' : isSwapped ? '#c0392b' : isComparing ? '#c9a227' : isSorted ? '#27ae60' : isEliminated ? '#d8cdb8' : '#c9a227';
          const bg = isCurrent ? '#ffd9a8' : isSwapped ? '#fdd9d2' : isComparing ? '#fdeaa7' : isSorted ? '#eafaf0' : isEliminated ? '#f3eee2' : '#fff8e6';
          const fg = isEliminated ? '#b3a889' : isSorted ? '#1c6b3a' : '#5a4a2a';
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 44 }}>
              {/* pointer badges ride above the cell they point at */}
              <div style={{ height: 20, fontSize: 11, fontWeight: 700, color: '#d35400', whiteSpace: 'nowrap' }}>
                {pointers ? pointers.join(',') : ''}
              </div>
              <div style={{ height: 12, color: '#d35400', lineHeight: '12px' }}>{pointers ? '▼' : ''}</div>
              <div
                style={{
                  minWidth: 40,
                  height: 40,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: `2px solid ${border}`,
                  borderRadius: 8,
                  background: bg,
                  color: fg,
                  fontFamily: 'ui-monospace, monospace',
                  fontWeight: 700,
                  fontSize: 15,
                  textDecoration: isEliminated ? 'line-through' : 'none',
                  boxShadow: isCurrent ? '0 0 0 4px rgba(211,84,0,0.18)' : 'none',
                  transition: 'background 0.3s, border-color 0.3s, box-shadow 0.3s, color 0.3s',
                }}
              >
                {String(value)}
              </div>
              <div style={{ marginTop: 3, fontSize: 11, color: '#a89b7d', fontFamily: 'ui-monospace, monospace' }}>{i}</div>
            </div>
          );
        })}
      </div>
      {hasTrace ? (
        <div
          style={{
            marginTop: 10,
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
