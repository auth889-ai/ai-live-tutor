'use client';

// Dev preview: the Konva draw-on annotation layer over a synthetic figure (SVG data URI).
// Scrub the slider to control the narration reveal; Replay re-draws the pen marks in order.

import { useState } from 'react';

import { ImageView } from '../../../components/course-player/panels/image-view.js';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="420">'
  + '<rect width="720" height="420" fill="#fdf6ee"/>'
  + '<circle cx="200" cy="200" r="90" fill="#cfe6cf" stroke="#4a7d4a" stroke-width="3"/>'
  + '<rect x="420" y="120" width="200" height="140" fill="#dbe7f6" stroke="#4a6d9d" stroke-width="3"/>'
  + '<text x="200" y="205" font-size="22" text-anchor="middle" fill="#2b4a2b">nucleus</text>'
  + '<text x="520" y="195" font-size="22" text-anchor="middle" fill="#233d5c">mitochondria</text>'
  + '</svg>';

const CONTENT = {
  url: `data:image/svg+xml;utf8,${encodeURIComponent(SVG)}`,
  alt: 'cell diagram',
  caption: 'Synthetic figure — draw-on preview',
  page: 3,
  annotations: [
    { verb: 'encircle', bbox: { x: 0.155, y: 0.26, w: 0.25, h: 0.43 } },
    { verb: 'arrow', bbox: { x: 0.583, y: 0.285, w: 0.278, h: 0.333 }, text: 'the powerhouse' },
    { verb: 'underline', bbox: { x: 0.44, y: 0.41, w: 0.22, h: 0.06 } },
    { verb: 'highlight', bbox: { x: 0.155, y: 0.44, w: 0.13, h: 0.08 } },
    { verb: 'label', bbox: { x: 0.55, y: 0.62, w: 0.15, h: 0.05 }, text: 'membrane' },
  ],
};

export default function AnnotationsDevPage() {
  const [progress, setProgress] = useState(1);
  const [epoch, setEpoch] = useState(0);

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '32px 16px', display: 'grid', gap: 18 }}>
      <h1 style={{ fontSize: 22, color: '#3a3327' }}>Konva draw-on annotations — dev preview</h1>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <label style={{ fontSize: 14, color: '#5a4a2a' }}>reveal</label>
        <input type="range" min="0" max="1" step="0.05" value={progress} onChange={(e) => setProgress(Number(e.target.value))} style={{ flex: 1 }} />
        <button onClick={() => setEpoch((n) => n + 1)} style={{ padding: '8px 18px', borderRadius: 8, border: '2px solid #e8d5bb', background: '#fff', cursor: 'pointer' }}>
          ▶ Replay
        </button>
      </div>
      <ImageView key={epoch} content={CONTENT} progress={progress} />
    </div>
  );
}
