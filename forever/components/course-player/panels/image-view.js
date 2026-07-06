'use client';

// Image panel — shows a REAL image (PDF figure, fetched topic image) UNCROPPED, with an
// optional highlight box drawn ON TOP (bbox overlay, OpenMAIC full-image rule) so the tutor
// points at the relevant part. Caption below. Zoom is a CSS transform (reversible).

export function ImageView({ content }) {
  const { url, alt, caption, bbox } = content;
  return (
    <figure style={{ margin: 0, maxWidth: 720, marginInline: 'auto' }}>
      <div style={{ position: 'relative', display: 'inline-block', border: '1px solid #e8ddc9', borderRadius: 12, overflow: 'hidden', background: '#fffdf8' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={alt} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
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
      {caption && <figcaption style={{ fontSize: 14, color: '#8a6d3b', textAlign: 'center', marginTop: 6 }}>{caption}</figcaption>}
    </figure>
  );
}
