'use client';

// Phase 1 dev player: the fixture scene playing on the one clock. One rAF loop samples
// the clock and re-renders the pure pipeline timeline -> boardStateAt(t) -> SVG.
// (Playbook rule: never a second loop — seek just moves the clock.)

import { useEffect, useMemo, useRef, useState } from 'react';

import { boardStateAt } from '../../../lib/playback/engine/action-engine.js';
import { createManualClock } from '../../../lib/playback/clock/manual-clock.js';
import { renderBoardSvg } from '../../../lib/board/renderer/board-svg.js';
import {
  nestedLoopsScene,
  nestedLoopsTimeline,
  nestedLoopsDurationMs,
} from '../../../fixtures/scenes/nested-loops-fixture.js';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export default function DevPlayerPage() {
  const clockRef = useRef(null);
  if (!clockRef.current) clockRef.current = createManualClock();
  const clock = clockRef.current;

  const [tMs, setTMs] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let frame;
    const tick = () => {
      const next = Math.min(clock.currentTimeMs(), nestedLoopsDurationMs);
      setTMs(next);
      if (next >= nestedLoopsDurationMs && clock.isPlaying()) {
        clock.pause();
        setPlaying(false);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clock]);

  const state = useMemo(() => boardStateAt(nestedLoopsTimeline, tMs), [tMs]);
  const svg = useMemo(() => renderBoardSvg(nestedLoopsScene, state), [state]);
  const subtitle = state.activeSpeech
    ? nestedLoopsScene.voiceLines.find((line) => line.id === state.activeSpeech)?.text
    : '';

  const togglePlay = () => {
    if (clock.isPlaying()) {
      clock.pause();
      setPlaying(false);
    } else {
      if (clock.currentTimeMs() >= nestedLoopsDurationMs) clock.seek(0);
      clock.play();
      setPlaying(true);
    }
  };

  return (
    <main style={{ maxWidth: 1000, margin: '24px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 20 }}>Forever — fixture player (Phase 1)</h1>
      <p style={{ background: '#fff3cd', border: '1px solid #e5c56b', borderRadius: 8, padding: '6px 12px', fontSize: 13 }}>
        DEV HARNESS — this scene is hand-written test data proving the renderer. Real lessons are
        generated per-source by the agent society (Phase 3+); fixture content can never reach the
        product (enforced by tests/fixtures/fixture-isolation.test.js).
      </p>
      <div
        style={{ border: '1px solid #e8ddc9', borderRadius: 12, overflow: 'hidden', background: '#fdf8f0' }}
        // Our own renderer's escaped output — the SVG string is trusted by construction.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div style={{ minHeight: 28, padding: '8px 4px', color: '#7a4a12', fontStyle: 'italic' }}>{subtitle}</div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button onClick={togglePlay} style={{ padding: '8px 20px', fontSize: 16 }}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {(tMs / 1000).toFixed(1)}s / {(nestedLoopsDurationMs / 1000).toFixed(1)}s
        </span>
        <input
          type="range"
          min="0"
          max={nestedLoopsDurationMs}
          value={tMs}
          onChange={(event) => {
            clock.seek(Number(event.target.value));
            setTMs(Number(event.target.value));
          }}
          style={{ flex: 1 }}
        />
        <select
          defaultValue="1"
          onChange={(event) => clock.setRate(Number(event.target.value))}
          style={{ padding: 6 }}
        >
          {SPEEDS.map((speed) => (
            <option key={speed} value={speed}>
              {speed}x
            </option>
          ))}
        </select>
      </div>
    </main>
  );
}
