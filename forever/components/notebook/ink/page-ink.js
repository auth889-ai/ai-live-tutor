'use client';

// PAGE INK — Xournal++'s core law brought to the document: THE PAGE ITSELF IS WRITABLE.
// A transparent stroke layer sits over the white document card; the ✍️ pen toggle in the
// topbar turns it on. Strokes persist per page as a hidden drawing block (origin
// 'page-ink') the moment the pen lifts — no save button, like real paper.
// Coordinates are normalized by the page WIDTH on both axes, so ink keeps its shape at
// any screen size and stays anchored to the top as the document grows.

import { useEffect, useRef, useState } from 'react';

const VW = 1000; // virtual width of the ink coordinate space

function parseInk(block) {
  try {
    const d = JSON.parse(block?.content ?? '');
    return d?.paper === 'overlay' ? (d.layers?.[0]?.items ?? []) : [];
  } catch { return []; }
}

export function PageInk({ nb, page, inkBlock, active, color, penWidth = 3, onDirty }) {
  const [strokes, setStrokes] = useState(() => parseInk(inkBlock));
  const [aspect, setAspect] = useState(0.6); // height/width of the host, tracked live
  const [tool, setTool] = useState('pen');   // 'pen' draws · 'type' puts handwriting where you click
  const [typing, setTyping] = useState(null); // {x, y, left, top} — an open text entry on the page
  const hostRef = useRef(null);
  const blockIdRef = useRef(inkBlock?._id ?? null);
  const drawingRef = useRef(false);
  const saveTimer = useRef(null);

  // adopt server state only when the PAGE changes — never mid-writing
  useEffect(() => {
    setStrokes(parseInk(inkBlock));
    blockIdRef.current = inkBlock?._id ?? null;
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (inkBlock?._id && !blockIdRef.current) blockIdRef.current = inkBlock._id; }, [inkBlock?._id]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0) setAspect(r.height / r.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const save = (items) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const content = JSON.stringify({ version: 2, paper: 'overlay', layers: [{ name: 'Ink', visible: true, items }] });
      if (blockIdRef.current) {
        await fetch(`/api/notebooks/${nb}/blocks/${blockIdRef.current}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
      } else {
        const r = await fetch(`/api/notebooks/${nb}/blocks`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'drawing', content, source: 'typed', origin: 'page-ink', title: 'Page ink', page }),
        });
        const d = await r.json().catch(() => null);
        if (d?.block?._id) blockIdRef.current = d.block._id;
      }
      onDirty?.();
    }, 500);
  };

  const norm = (e) => {
    const r = hostRef.current.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.width];
  };
  const down = (e) => {
    if (!active) return;
    e.preventDefault();
    if (tool === 'type') {
      // typed handwriting: click the paper, type, Enter — text lands where you clicked
      const r = hostRef.current.getBoundingClientRect();
      const [x, y] = norm(e);
      setTyping({ x, y, left: e.clientX - r.left, top: e.clientY - r.top });
      return;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawingRef.current = true;
    const [x, y] = norm(e);
    setStrokes((cur) => [...cur, { kind: 'stroke', tool: 'pen', color, width: penWidth, points: [x, y] }]);
  };
  const commitTyping = (text) => {
    const t = String(text ?? '').trim();
    if (t && typing) {
      setStrokes((cur) => {
        const next = [...cur, { kind: 'text', x: typing.x, y: typing.y, text: t.slice(0, 200), size: 34, color }];
        save(next);
        return next;
      });
    }
    setTyping(null);
  };
  const move = (e) => {
    if (!active || !drawingRef.current) return;
    const [x, y] = norm(e);
    setStrokes((cur) => {
      const next = [...cur];
      const last = next[next.length - 1];
      next[next.length - 1] = { ...last, points: [...last.points, x, y] };
      return next;
    });
  };
  const up = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    setStrokes((cur) => { save(cur); return cur; });
  };
  const undo = () => setStrokes((cur) => { const next = cur.slice(0, -1); save(next); return next; });

  const vh = Math.max(1, aspect * VW);
  return (
    <div ref={hostRef} data-page-ink={active ? 'on' : 'off'}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      style={{ position: 'absolute', inset: 0, zIndex: 5, pointerEvents: active ? 'auto' : 'none', touchAction: active ? 'none' : 'auto', cursor: active ? 'crosshair' : 'default', borderRadius: 14 }}>
      <svg viewBox={`0 0 ${VW} ${vh}`} preserveAspectRatio="xMidYMin meet" style={{ width: '100%', height: '100%', display: 'block' }}>
        {strokes.map((s, i) => {
          if (s.kind === 'text') {
            return <text key={i} x={(s.x * VW).toFixed(1)} y={(s.y * VW).toFixed(1)} fontSize={s.size ?? 34} fill={s.color}
              fontFamily='var(--caveat), "Segoe Script", "Comic Sans MS", cursive'>{s.text}</text>;
          }
          return s.points.length === 2
            ? <circle key={i} cx={s.points[0] * VW} cy={s.points[1] * VW} r={Math.max(1.4, s.width / 1.4)} fill={s.color} />
            : <polyline key={i}
                points={s.points.map((v) => (v * VW).toFixed(1)).join(' ').replace(/(\S+) (\S+) ?/g, '$1,$2 ')}
                fill="none" stroke={s.color} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round" />;
        })}
      </svg>
      {typing ? (
        <input autoFocus placeholder="type — Enter to write it on the page"
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === 'Enter') commitTyping(e.currentTarget.value); if (e.key === 'Escape') setTyping(null); }}
          onBlur={(e) => commitTyping(e.currentTarget.value)}
          style={{ position: 'absolute', left: typing.left, top: typing.top - 18, width: 300, border: 'none', borderBottom: `2px dashed ${color}`, outline: 'none', background: 'transparent', color,
            fontFamily: 'var(--caveat), "Segoe Script", "Comic Sans MS", cursive', fontSize: 25, fontWeight: 600 }} />
      ) : null}
      {active ? (
        <div style={{ position: 'absolute', top: 10, right: 12, display: 'flex', gap: 6 }} onPointerDown={(e) => e.stopPropagation()}>
          <button onClick={() => setTool('pen')}
            style={{ border: tool === 'pen' ? 'none' : '1px solid #EBD9C4', borderRadius: 999, background: tool === 'pen' ? color : '#FFFFFFEE', color: tool === 'pen' ? '#fff' : '#77695B', padding: '4px 12px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>✒️ draw</button>
          <button onClick={() => setTool('type')}
            style={{ border: tool === 'type' ? 'none' : '1px solid #EBD9C4', borderRadius: 999, background: tool === 'type' ? color : '#FFFFFFEE', color: tool === 'type' ? '#fff' : '#77695B', padding: '4px 12px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>⌨️ type</button>
          {strokes.length > 0 ? (
            <button onClick={undo}
              style={{ border: '1px solid #EBD9C4', borderRadius: 999, background: '#FFFFFFEE', color: '#77695B', padding: '4px 12px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>↶ undo</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
