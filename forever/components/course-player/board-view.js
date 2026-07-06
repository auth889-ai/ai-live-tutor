'use client';

// Reusable teaching surface: the handwriting board (SVG) plus, when the scene has code,
// a real code-editor panel beside it (the mockup's right-side layout). Both are driven by
// the same clock time via the pure action engine. No playback logic here.

import { useMemo } from 'react';

import { boardStateAt } from '../../lib/playback/engine/action-engine.js';
import { renderBoardSvg } from '../../packages/@forever/renderer/src/board-svg.js';
import { CodePanel } from './code-panel.js';

export function BoardView({ scene, tMs }) {
  const state = useMemo(() => boardStateAt(scene.timeline, tMs), [scene, tMs]);

  // The SVG board draws non-code objects (handwriting/lists/diagrams); code objects render
  // in the real editor panel, so we hide them from the SVG to avoid duplicate/plain code.
  const codeObject = scene.objects.find((object) => object.renderHint === 'code');
  const boardScene = useMemo(
    () => ({ ...scene, objects: scene.objects.filter((object) => object.renderHint !== 'code') }),
    [scene],
  );
  const svg = useMemo(() => renderBoardSvg(boardScene, state), [boardScene, state]);

  const subtitle = state.activeSpeech
    ? scene.voiceLines.find((line) => line.id === state.activeSpeech)?.text
    : '';

  const codeReveal = codeObject ? state.codeReveal.get(codeObject.id) : null;

  return (
    <>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div
          style={{ flex: codeObject ? '1 1 60%' : '1 1 100%', border: '1px solid #e8ddc9', borderRadius: 12, overflow: 'hidden', background: '#fdf8f0' }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        {codeObject && codeReveal && (
          <div style={{ flex: '1 1 40%', minWidth: 300 }}>
            <CodePanel
              codeObject={codeObject}
              revealProgress={codeReveal.progress}
              outputShown={state.outputShown.has(codeObject.id)}
            />
          </div>
        )}
      </div>
      <div style={{ minHeight: 30, padding: '10px 4px', color: '#7a4a12', fontStyle: 'italic', fontSize: 15 }}>
        {subtitle}
      </div>
    </>
  );
}
