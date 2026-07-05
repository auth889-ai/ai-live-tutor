'use client';

// Reusable board surface: renders one scene at clock time tMs via the pure renderer,
// plus the synced subtitle. No playback logic here — that's the hook's job.

import { useMemo } from 'react';

import { boardStateAt } from '../../lib/playback/engine/action-engine.js';
import { renderBoardSvg } from '../../packages/@forever/renderer/src/board-svg.js';

export function BoardView({ scene, tMs }) {
  const state = useMemo(() => boardStateAt(scene.timeline, tMs), [scene, tMs]);
  const svg = useMemo(() => renderBoardSvg(scene, state), [scene, state]);
  const subtitle = state.activeSpeech
    ? scene.voiceLines.find((line) => line.id === state.activeSpeech)?.text
    : '';

  return (
    <>
      <div
        style={{ border: '1px solid #e8ddc9', borderRadius: 12, overflow: 'hidden', background: '#fdf8f0' }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div style={{ minHeight: 30, padding: '10px 4px', color: '#7a4a12', fontStyle: 'italic', fontSize: 15 }}>
        {subtitle}
      </div>
    </>
  );
}
