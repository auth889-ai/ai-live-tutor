'use client';

// Image panel — shows a REAL image (PDF figure, fetched topic image) UNCROPPED, with the
// tutor's teaching marks drawn ON TOP (bbox overlay, OpenMAIC full-image rule). Marks now
// DRAW THEMSELVES via the Konva annotation layer (adoption #47): encircle sweeps around,
// underline strokes across, the arrow flies in — a pen, not a pop-in. Konva needs window,
// so the layer loads client-only (ssr:false); the container is measured live so mark pixel
// geometry always matches the displayed image size. Caption below; source-page badge kept.

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

const AnnotationLayer = dynamic(
  () => import('./annotation-layer.js').then((m) => m.AnnotationLayer),
  { ssr: false },
);

export function ImageView({ content, progress = 1 }) {
  const { url, alt, caption, bbox, page, annotations = [] } = content;
  const shown = Math.ceil(progress * annotations.length); // reveal in order across the narration window
  const boxRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Track the rendered image size (responsive) so mark geometry stays pixel-true.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <figure style={{ margin: 0, maxWidth: 720, marginInline: 'auto' }}>
      <div ref={boxRef} style={{ position: 'relative', display: 'inline-block', border: '1px solid #f0dcd5', borderRadius: 12, overflow: 'hidden', background: '#fffcfa' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={alt} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
        {annotations.length > 0 && (
          <AnnotationLayer annotations={annotations} shown={shown} width={size.width} height={size.height} />
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
