'use client';

// CALL-STACK PANEL (C3): the mockups' "Recursion Stack" — one row per live frame, top =
// Active, below = Waiting, plus the most recently finished frame as "Done → returns X"
// (or "threw TypeError"). Pure render of step.frames / step.lastReturn — engine facts only.

const STATUS_STYLE = {
  active: { border: '#b93c2b', bg: '#fdf0ee', chip: '#e8604c', label: 'Active' },
  waiting: { border: '#c98f2d', bg: '#fdf7ec', chip: '#d9a441', label: 'Waiting' },
  returned: { border: '#20794a', bg: '#eef7f0', chip: '#2f9e5f', label: 'Done' },
  threw: { border: '#6f3391', bg: '#f6eefa', chip: '#8e44ad', label: 'Threw' },
};

function FrameRow({ frame }) {
  const s = STATUS_STYLE[frame.status] ?? STATUS_STYLE.waiting;
  const args = Object.entries(frame.arguments ?? {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: `2px solid ${s.border}`, borderRadius: 8, background: s.bg, padding: '5px 10px' }}>
      <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: 13, color: '#2b211a', flex: 1 }}>
        {frame.functionName}({args})
      </span>
      {frame.status === 'returned' && frame.returnValue !== undefined ? (
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#20794a', fontWeight: 700 }}>→ {JSON.stringify(frame.returnValue)}</span>
      ) : null}
      {frame.exception ? (
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#6f3391', fontWeight: 700 }}>{frame.exception.type}</span>
      ) : null}
      <span style={{ background: s.chip, color: '#fff', borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 800 }}>{s.label}</span>
    </div>
  );
}

export function CallStackPanel({ frames, lastReturn, title = 'Call Stack' }) {
  if (!frames?.length && !lastReturn) return null;
  const rows = [...(frames ?? [])].reverse(); // top of stack first, like the mockups
  return (
    <div style={{ border: '1px solid #f0dcd5', borderRadius: 10, background: '#fffcfa', padding: 10 }}>
      <div style={{ fontSize: 11, color: '#8e44ad', fontWeight: 700, marginBottom: 6, fontFamily: 'ui-monospace, monospace' }}>{title} (top → current)</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((f) => <FrameRow key={f.frameId} frame={f} />)}
        {lastReturn && !rows.some((f) => f.frameId === lastReturn.frameId) ? <FrameRow frame={lastReturn} /> : null}
      </div>
    </div>
  );
}
