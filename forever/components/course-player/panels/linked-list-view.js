'use client';

// LinkedListView — the dedicated chain renderer (the reason the linked-list engine was not
// shipped weak on the graph view). Python Tutor's positional-invariance rule, applied: each
// node box sits at its FIRST-APPEARANCE position forever; between steps only the next-arrows
// and the named pointer badges move. A reversal therefore reads as arrows flipping one by one
// across a row of stationary boxes — exactly how a human tutor draws it. Orphaned nodes fade
// but stay visible (the garbage-collection teaching moment); the arrow rewired THIS step
// flashes coral.

const W = 64; // box width
const H = 44; // box height
const GAP = 44; // horizontal gap between boxes (arrows live here)
const TOP = 46; // space above boxes for pointer badges
const ARC = 34; // how high a non-adjacent arrow arcs above the boxes

function resolveState({ content, activeStep }) {
  const trace = Array.isArray(content.trace) && content.trace.length ? content.trace : null;
  if (!trace) return null;
  const idx = Math.max(0, Math.min(trace.length - 1, activeStep ?? trace.length - 1));
  return { step: trace[idx], stepNum: idx + 1, stepTotal: trace.length };
}

export function LinkedListView({ content, activeStep = null }) {
  const resolved = resolveState({ content, activeStep });
  if (!resolved) return <div style={{ color: '#c0392b', fontSize: 13 }}>chain unavailable</div>;
  const { step, stepNum, stepTotal } = resolved;
  const nodes = Array.isArray(step.nodes) ? step.nodes : [];
  const pointers = step.pointers && typeof step.pointers === 'object' ? step.pointers : {};

  // Box positions: index in the (first-appearance ordered) node list — stable across steps.
  const posOf = new Map(nodes.map((n, i) => [String(n.id), i]));
  const xCenter = (i) => i * (W + GAP) + W / 2;
  const width = Math.max(1, nodes.length) * (W + GAP);
  const height = TOP + H + 40;

  // Pointer badges grouped per node (plus the "None" pointers listed after the chain).
  const badgesAt = new Map();
  const nullPointers = [];
  for (const [name, nid] of Object.entries(pointers)) {
    if (nid == null) {
      nullPointers.push(name);
    } else {
      const key = String(nid);
      if (!badgesAt.has(key)) badgesAt.set(key, []);
      badgesAt.get(key).push(name);
    }
  }

  return (
    <div style={{ border: '1px solid #e8ddc9', borderRadius: 12, background: '#fffdf8', padding: 14 }}>
      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <svg width={width} height={height} style={{ display: 'block' }}>
          {/* next-arrows first (under the boxes' text but visually between them) */}
          {nodes.map((n) => {
            if (n.next == null) return null;
            const from = posOf.get(String(n.id));
            const to = posOf.get(String(n.next));
            if (from === undefined || to === undefined) return null;
            const y = TOP + H / 2;
            const color = n.rewired ? '#e8604c' : n.orphan ? '#d8cdb8' : '#8a6d3b';
            const sw = n.rewired ? 3.5 : 2;
            const x1 = xCenter(from) + W / 2;
            const x2 = xCenter(to) - W / 2;
            if (to === from + 1) {
              // adjacent: straight arrow through the gap
              return (
                <g key={`e-${n.id}`}>
                  <line x1={x1} y1={y} x2={x2 - 7} y2={y} stroke={color} strokeWidth={sw} style={{ transition: 'stroke 0.3s' }} />
                  <polygon points={`${x2},${y} ${x2 - 8},${y - 4.5} ${x2 - 8},${y + 4.5}`} fill={color} />
                </g>
              );
            }
            // non-adjacent (or backward): arc above the boxes so direction stays readable
            const sx = xCenter(from);
            const tx = xCenter(to);
            const yTop = TOP - 8;
            return (
              <g key={`e-${n.id}`}>
                <path
                  d={`M ${sx} ${TOP} C ${sx} ${yTop - ARC}, ${tx} ${yTop - ARC}, ${tx} ${TOP - 2}`}
                  fill="none" stroke={color} strokeWidth={sw} style={{ transition: 'stroke 0.3s' }}
                />
                <polygon points={`${tx},${TOP} ${tx - 4.5},${TOP - 9} ${tx + 4.5},${TOP - 9}`} fill={color} />
              </g>
            );
          })}
          {/* node boxes at fixed positions; orphans fade in place */}
          {nodes.map((n, i) => {
            const x = xCenter(i) - W / 2;
            const names = badgesAt.get(String(n.id));
            return (
              <g key={n.id} style={{ opacity: n.orphan ? 0.32 : 1, transition: 'opacity 0.3s' }}>
                {names ? (
                  <>
                    <text x={xCenter(i)} y={TOP - 26} textAnchor="middle" fontSize="11" fontWeight="800" fill="#d35400" fontFamily="ui-monospace, monospace">
                      {names.join(',')}
                    </text>
                    <text x={xCenter(i)} y={TOP - 13} textAnchor="middle" fontSize="10" fill="#d35400">▼</text>
                  </>
                ) : null}
                <rect
                  x={x} y={TOP} width={W} height={H} rx={9}
                  fill={names ? '#ffd9a8' : '#fff8e6'}
                  stroke={n.rewired ? '#e8604c' : names ? '#d35400' : '#c9a227'}
                  strokeWidth={n.rewired || names ? 3 : 2}
                  strokeDasharray={n.orphan ? '5 4' : 'none'}
                  style={{ transition: 'fill 0.3s, stroke 0.3s' }}
                />
                <text x={xCenter(i)} y={TOP + H / 2 + 5} textAnchor="middle" fontSize="15" fontWeight="700" fill="#3a3327" fontFamily="ui-monospace, monospace">
                  {String(n.value ?? '?')}
                </text>
                {n.next == null && !n.orphan ? (
                  <text x={xCenter(i) + W / 2 + 12} y={TOP + H / 2 + 4} textAnchor="middle" fontSize="12" fill="#b3a889" fontFamily="ui-monospace, monospace">∅</text>
                ) : null}
                <text x={xCenter(i)} y={TOP + H + 15} textAnchor="middle" fontSize="10" fill="#a89b7d" fontFamily="ui-monospace, monospace">{n.id}</text>
              </g>
            );
          })}
        </svg>
      </div>
      {nullPointers.length > 0 ? (
        <div style={{ fontSize: 12, color: '#8a6d3b', fontFamily: 'ui-monospace, monospace', marginTop: 2 }}>
          {nullPointers.join(', ')} → None
        </div>
      ) : null}
      {step.note ? (
        <div style={{ marginTop: 10, padding: '8px 12px', border: '1px solid #e8ddc9', borderRadius: 10, background: '#fffaf0', fontFamily: 'ui-monospace, monospace', fontSize: 13, color: '#5a4a2a', display: 'flex', gap: 10, alignItems: 'baseline' }}>
          <span style={{ color: '#d35400', fontWeight: 700, whiteSpace: 'nowrap' }}>Step {stepNum}/{stepTotal}</span>
          <span>{step.note}</span>
        </div>
      ) : null}
    </div>
  );
}
