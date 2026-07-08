'use client';

// Image panel — shows a REAL image (PDF figure, fetched topic image) UNCROPPED, with an
// optional highlight box drawn ON TOP (bbox overlay, OpenMAIC full-image rule) so the tutor
// points at the relevant part. Caption below. Zoom is a CSS transform (reversible).

const A_STYLE = { stroke: '#c0392b', strokeWidth: 0.9, fill: 'none', vectorEffect: 'non-scaling-stroke' };

function Annotation({ a }) {
  const { x, y, w, h } = a.bbox;
  const cx = (x + w / 2) * 100;
  const cy = (y + h / 2) * 100;
  if (a.verb === 'encircle') return <ellipse cx={cx} cy={cy} rx={(w / 2) * 100 + 2.5} ry={(h / 2) * 100 + 2.5} {...A_STYLE} strokeWidth={2.2} />;
  if (a.verb === 'underline') return <line x1={x * 100} y1={(y + h) * 100 + 1} x2={(x + w) * 100} y2={(y + h) * 100 + 1} {...A_STYLE} strokeWidth={2.2} />;
  if (a.verb === 'cross_out') return (
    <g {...A_STYLE} strokeWidth={2.2}>
      <line x1={x * 100} y1={y * 100} x2={(x + w) * 100} y2={(y + h) * 100} />
      <line x1={(x + w) * 100} y1={y * 100} x2={x * 100} y2={(y + h) * 100} />
    </g>
  );
  if (a.verb === 'highlight') return <rect x={x * 100} y={y * 100} width={w * 100} height={h * 100} fill="rgba(253,234,167,0.45)" stroke="none" />;
  if (a.verb === 'pointer') return <circle cx={cx} cy={cy} r={2.4} fill="#e8604c" stroke="#fff" strokeWidth={0.8} />;
  if (a.verb === 'arrow' || a.verb === 'label') {
    const tx = Math.min(92, Math.max(8, cx + 14));
    const ty = Math.max(6, cy - 12);
    return (
      <g>
        {a.verb === 'arrow' && <line x1={tx} y1={ty + 2} x2={cx} y2={cy} {...A_STYLE} strokeWidth={1.8} markerEnd="url(#forever-arrowhead)" />}
        <text x={tx} y={ty} fill="#c0392b" fontSize="4.6" fontWeight="700" textAnchor="middle" style={{ paintOrder: 'stroke', stroke: '#fffdf8', strokeWidth: 1.4 }}>{a.text}</text>
      </g>
    );
  }
  return null;
}

export function ImageView({ content, progress = 1 }) {
  const { url, alt, caption, bbox, page, annotations = [] } = content;
  const shown = Math.ceil(progress * annotations.length); // reveal in order across the narration window
  return (
    <figure style={{ margin: 0, maxWidth: 720, marginInline: 'auto' }}>
      <div style={{ position: 'relative', display: 'inline-block', border: '1px solid #e8ddc9', borderRadius: 12, overflow: 'hidden', background: '#fffdf8' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={alt} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
        {annotations.length > 0 && (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            <defs>
              <marker id="forever-arrowhead" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto">
                <path d="M0,0 L7,3.5 L0,7 Z" fill="#c0392b" />
              </marker>
            </defs>
            {annotations.slice(0, shown).map((a, i) => <Annotation key={i} a={a} />)}
          </svg>
        )}
        {bbox && (
          <div
            style={{
              position: 'absolute',
              left: `${bbox.x * 100}%`,
              top: `${bbox.y * 100}%`,
              width: `${bbox.w * 100}%`,
              height: `${bbox.h * 100}%`,
              border: '3px solid #c0392b',
              borderRadius: 6,
              boxShadow: '0 0 0 9999px rgba(253,248,240,0.35)',
            }}
          />
        )}
      </div>
      <figcaption style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 6 }}>
        {caption && <span style={{ fontSize: 14, color: '#8a6d3b' }}>{caption}</span>}
        {page != null && (
          <span style={{ fontSize: 11, fontWeight: 700, color: '#e8604c', border: '1px solid #f3cdc5', borderRadius: 999, padding: '2px 10px', background: '#fdf0ee', whiteSpace: 'nowrap' }}>
            Source · page {page}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
