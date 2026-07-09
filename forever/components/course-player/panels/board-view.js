'use client';

// Reusable teaching surface: the handwriting board (SVG) + real code editor panel (right)
// + real diagram panel (below, Mermaid/HTML table) — all driven by the same clock. Code and
// diagrams are HTML/React components (auto-layout, readable), NOT cramped SVG. The SVG board
// draws only handwriting/lists.

import { useMemo } from 'react';

import { boardStateAt } from '../../../lib/playback/engine/action-engine.js';
import { renderBoardSvg } from '../../../lib/board/renderer/board-svg.js';
import { CodePanel } from './code-panel.js';
import { DiagramPanel } from './diagram-panel.js';

export function BoardView({ scene, tMs }) {
  const state = useMemo(() => boardStateAt(scene.timeline, tMs), [scene, tMs]);

  const codeObject = scene.objects.find((o) => o.renderHint === 'code');
  const diagramObjects = scene.objects.filter((o) => o.renderHint === 'diagram');

  // SVG board draws only handwriting/lists; code + diagrams render as real components.
  const boardScene = useMemo(
    () => ({ ...scene, objects: scene.objects.filter((o) => o.renderHint !== 'code' && o.renderHint !== 'diagram') }),
    [scene],
  );
  const svg = useMemo(() => renderBoardSvg(boardScene, state), [boardScene, state]);

  const subtitle = state.activeSpeech ? scene.voiceLines.find((l) => l.id === state.activeSpeech)?.text : '';
  const codeReveal = codeObject ? state.codeReveal.get(codeObject.id) : null;
  // A diagram appears once its object starts being "written" on the clock.
  const visibleDiagrams = diagramObjects.filter((o) => state.writing.has(o.id));

  return (
    <>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div
          style={{ flex: codeObject ? '1 1 58%' : '1 1 100%', border: '1px solid #f0dcd5', borderRadius: 12, overflow: 'hidden', background: '#fdf6f3' }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        {codeObject && codeReveal && (
          <div style={{ flex: '1 1 42%', minWidth: 300 }}>
            <CodePanel codeObject={codeObject} revealProgress={codeReveal.progress} outputShown={state.outputShown.has(codeObject.id)} />
          </div>
        )}
      </div>

      {visibleDiagrams.map((object) => (
        <div key={object.id} style={{ marginTop: 12 }}>
          <DiagramPanel content={object.content} />
        </div>
      ))}

      <div style={{ minHeight: 30, padding: '10px 4px', color: '#7a4a12', fontStyle: 'italic', fontSize: 15 }}>{subtitle}</div>
    </>
  );
}
