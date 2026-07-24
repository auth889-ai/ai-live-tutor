'use client';

// Mini-player for an Ask-the-Tutor answer SCENE: the same StagePresenter and audio-backed
// clock the lesson player uses, scoped to the one fresh scene the society just built for
// the student's question. Nothing forked: same board renderer, same timeline contract.

import { useLessonClock } from '../use-lesson-clock.js';
import { StagePresenter } from '../../panels/stage-presenter.js';

const V = (name) => `var(${name})`;

export function AskSceneViewer({ scene, onClose }) {
  const player = useLessonClock([scene], {});
  return (
    <div style={{
      marginTop: 8, border: `1px solid ${V('--border')}`, borderRadius: 16, overflow: 'hidden',
      background: '#fff', boxShadow: V('--card-shadow'),
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#fef3e2' }}>
        <span style={{ fontSize: 13 }}>🎬</span>
        <span style={{ fontWeight: 700, fontSize: 12.5, color: '#8a6021' }}>{scene.title}</span>
        <span style={{ fontSize: 11, color: V('--ink-muted') }}>— built by the society for your question</span>
        <button onClick={player.togglePlay} className="forever-btn"
          style={{ marginLeft: 'auto', padding: '4px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          {player.playing ? '❚❚' : '▶ Play'}
        </button>
        <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, color: V('--ink-muted') }}>✕</button>
      </div>
      {player.audioUrl && <audio ref={player.audioRef} src={player.audioUrl} preload="auto" key={player.audioUrl} />}
      <StagePresenter scene={scene} tMs={player.tMs} title={scene.title} setHold={player.setHold} />
    </div>
  );
}
