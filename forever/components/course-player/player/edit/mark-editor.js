'use client';

// Human mark editor (v1): the owner MOVES existing teaching marks by dragging them, DRAWS
// a new mark by dragging on empty image space, and DELETES with the ✕ on a selected mark.
// Human eyes are the verifier here — saved marks are stamped groundedBy:"human" server-side
// and still pass the full annotation contract. Coordinates stay normalized 0-1, so marks
// keep scaling with the responsive player exactly like AI marks.

import { useRef, useState } from 'react';

const VERB_COLORS = { encircle: '#e8604c', arrow: '#b4231f', underline: '#8a6021', cross_out: '#a33d2e', highlight: '#e0a12f', label: '#4a6d9d', pointer: '#2b7a3f' };
const NEEDS_TEXT = new Set(['label', 'arrow']);

export function MarkEditor({ url, annotations, onChange }) {
  const boxRef = useRef(null);
  const [selected, setSelected] = useState(-1);
  const [verb, setVerb] = useState('encircle');
  const drag = useRef(null); // { kind: 'move'|'draw', index, startX, startY, origin }

  const toFrac = (event) => {
    const rect = boxRef.current.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const onImagePointerDown = (event) => {
    // start DRAWING a new mark on empty space
    const p = toFrac(event);
    drag.current = { kind: 'draw', start: p };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onMarkPointerDown = (index) => (event) => {
    event.stopPropagation();
    setSelected(index);
    drag.current = { kind: 'move', index, start: toFrac(event), origin: annotations[index].bbox };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event) => {
    if (!drag.current) return;
    const p = toFrac(event);
    if (drag.current.kind === 'move') {
      const { index, start, origin } = drag.current;
      const bbox = {
        x: Math.min(1 - origin.w, Math.max(0, origin.x + (p.x - start.x))),
        y: Math.min(1 - origin.h, Math.max(0, origin.y + (p.y - start.y))),
        w: origin.w,
        h: origin.h,
      };
      onChange(annotations.map((a, i) => (i === index ? { ...a, bbox } : a)));
    } else {
      const { start } = drag.current;
      drag.current.preview = {
        x: Math.min(start.x, p.x), y: Math.min(start.y, p.y),
        w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y),
      };
      setSelected(-2); // trigger re-render for the preview rectangle
    }
  };
  const onPointerUp = () => {
    if (drag.current?.kind === 'draw' && drag.current.preview && drag.current.preview.w > 0.02 && drag.current.preview.h > 0.02) {
      const text = NEEDS_TEXT.has(verb) ? (window.prompt(`Text for this ${verb} (what does it point at?)`) || '').trim() : undefined;
      if (!NEEDS_TEXT.has(verb) || text) {
        onChange([...annotations, { verb, bbox: drag.current.preview, ...(text ? { text } : {}) }]);
        setSelected(annotations.length);
      }
    }
    drag.current = null;
  };

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5 }}>
        <span style={{ color: 'var(--ink-muted)' }}>draw new:</span>
        <select value={verb} onChange={(e) => setVerb(e.target.value)} style={{ fontSize: 11.5, padding: '2px 6px', borderRadius: 6 }}>
          {Object.keys(VERB_COLORS).map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <span style={{ color: 'var(--ink-muted)' }}>drag on the image to draw · drag a mark to move · select then ✕ to delete</span>
      </div>
      <div ref={boxRef} style={{ position: 'relative', userSelect: 'none', touchAction: 'none', cursor: 'crosshair' }}
        onPointerDown={onImagePointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <img src={url} alt="edit marks" draggable={false} style={{ width: '100%', display: 'block', borderRadius: 10, border: '1px solid var(--border)' }} />
        {annotations.map((a, i) => (
          <div key={i} onPointerDown={onMarkPointerDown(i)}
            style={{
              position: 'absolute', left: `${a.bbox.x * 100}%`, top: `${a.bbox.y * 100}%`,
              width: `${a.bbox.w * 100}%`, height: `${a.bbox.h * 100}%`, cursor: 'move',
              border: `2px ${a.groundedBy === 'human' ? 'solid' : 'dashed'} ${VERB_COLORS[a.verb] ?? '#e8604c'}`,
              borderRadius: a.verb === 'encircle' ? '50%' : 6,
              boxShadow: selected === i ? '0 0 0 2px rgba(232,96,76,.45)' : 'none',
            }}>
            <span style={{ position: 'absolute', top: -18, left: 0, fontSize: 10, fontWeight: 700, color: VERB_COLORS[a.verb] ?? '#e8604c', whiteSpace: 'nowrap' }}>
              {a.verb}{a.text ? `: ${a.text.slice(0, 24)}` : ''}
            </span>
            {selected === i && (
              <button onPointerDown={(e) => { e.stopPropagation(); onChange(annotations.filter((_, j) => j !== i)); setSelected(-1); }}
                style={{ position: 'absolute', top: -20, right: -8, border: 'none', background: '#b4231f', color: '#fff', borderRadius: '50%', width: 17, height: 17, fontSize: 10, cursor: 'pointer', lineHeight: 1 }}>
                ✕
              </button>
            )}
          </div>
        ))}
        {drag.current?.kind === 'draw' && drag.current.preview && (
          <div style={{
            position: 'absolute', left: `${drag.current.preview.x * 100}%`, top: `${drag.current.preview.y * 100}%`,
            width: `${drag.current.preview.w * 100}%`, height: `${drag.current.preview.h * 100}%`,
            border: `2px dotted ${VERB_COLORS[verb]}`, borderRadius: verb === 'encircle' ? '50%' : 6,
          }} />
        )}
      </div>
    </div>
  );
}
