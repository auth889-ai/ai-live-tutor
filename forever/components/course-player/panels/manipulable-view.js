'use client';

// Manipulable — the "manipulate it" spine step made real (SpatialMath AI, the one winner idea
// that raises teaching quality): the student drags ONE parameter and the curve + readout
// RECOMPUTE live from a whitelisted formula the ENGINE owns — the number on screen is always
// real. Flow enforces the pedagogy: PREDICT (commit a guess) -> unlock the slider -> MANIPULATE
// -> the reveal confirms or confronts the prediction (pretesting g=0.54; Mazur's commit-first).
// Rendering reuses the tested ChartView — this component only owns the interaction.

import { useMemo, useState } from 'react';

import { toChartContent, computeReadout } from '../../../lib/board/manipulable/manipulable-content.js';
import { ChartView } from './chart-view.js';

export function ManipulableView({ content }) {
  const [value, setValue] = useState(content.param.default);
  const [picked, setPicked] = useState(null);
  const mustPredict = Boolean(content.predict) && picked === null;

  const chart = useMemo(() => toChartContent(content, value), [content, value]);
  const readout = useMemo(() => computeReadout(content.readout, value), [content, value]);
  const correct = content.predict && picked !== null && picked === content.predict.answerIndex;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {content.predict && (
        <div style={{ marginBottom: 12, padding: '12px 16px', borderRadius: 10, background: '#eaf2fb', border: '2px solid #4a90d9' }}>
          <div style={{ fontWeight: 700, color: '#1f4e79', fontSize: 15, marginBottom: picked === null ? 10 : 6 }}>
            🤔 Predict first: {content.predict.prompt}
          </div>
          {picked === null ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {content.predict.choices.map((choice, i) => (
                <button key={i} onClick={() => setPicked(i)}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '2px solid #a9cdea', background: '#fff', fontSize: 14.5, cursor: 'pointer', color: '#1f4e79' }}>
                  {choice}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 14, color: correct ? '#1e6b3c' : '#8a2a22' }}>
              {correct ? '✅ You predicted: ' : '❌ You predicted: '}
              <strong>{content.predict.choices[picked]}</strong>
              {' — now move the slider and watch what actually happens.'}
            </div>
          )}
        </div>
      )}

      <div style={{ opacity: mustPredict ? 0.35 : 1, pointerEvents: mustPredict ? 'none' : 'auto', transition: 'opacity .25s' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px', marginBottom: 10, borderRadius: 10, background: '#fdf6ee', border: '2px solid #e8d5bb' }}>
          <span style={{ fontWeight: 750, color: '#5a4a2a', fontSize: 14.5, whiteSpace: 'nowrap' }}>
            🎛 {content.param.label}
          </span>
          <input
            type="range"
            min={content.param.min}
            max={content.param.max}
            step={content.param.step}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            style={{ flex: 1, accentColor: '#f47368' }}
            aria-label={content.param.label}
          />
          <span style={{ fontWeight: 800, color: '#bc3f34', fontSize: 15, minWidth: 64, textAlign: 'right' }}>
            {value}{content.param.unit || ''}
          </span>
          {readout && (
            <span style={{ padding: '4px 12px', borderRadius: 999, background: '#eafaf0', border: '1.5px solid #7dcf9a', color: '#1e6b3c', fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap' }}>
              {readout.label}: {readout.value}{readout.unit}
            </span>
          )}
        </div>
        <ChartView content={chart} />
        {mustPredict && (
          <div style={{ textAlign: 'center', fontSize: 13, color: '#8a6d3b', marginTop: 6 }}>
            Commit your prediction above to unlock the controls.
          </div>
        )}
      </div>
    </div>
  );
}
