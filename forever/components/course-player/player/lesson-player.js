'use client';

// The course shell — what makes a lesson FEEL like a real course (Udemy/Coursera anatomy:
// persistent episode sidebar with per-item checkmarks + duration, visible progress math,
// real player chrome with speed/skip/fullscreen, and a scene timeline strip). Playback
// logic lives in useLessonClock; this component is pure presentation around it.
// Progress persists per lesson in localStorage so "continue where you left off" is real.
//
// PREMIUM PASS (docs/PREMIUM_UI_SPEC.md): THEATER MODE — the animated board sits on an
// espresso-dark surround so it glows (the MasterClass move in our hue); glass chrome header;
// cards are the brightest surface on a warm-tinted field with layered hue-matched shadows;
// Fraunces display over Inter UI; coral is the accent, NEVER the canvas; completion is amber,
// the grown-up sparkle. The photo backdrop rides at whisper opacity — texture, not wallpaper.

import { useEffect, useRef, useState } from 'react';

import { useLessonClock } from './use-lesson-clock.js';
import { StagePresenter } from '../panels/stage-presenter.js';
import { StallOverlay } from './live/stall-overlay.js';
import { PendingSceneRows, PendingSceneChips } from './live/pending-scenes.js';
import { AskTutor } from './ask/ask-tutor.js';

const fmt = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const SPEEDS = [1, 1.25, 1.5, 1.75, 0.75];
const V = (name) => `var(${name})`;

// pending: scene briefs still being WRITTEN (progressive playback) — shown as quiet
// "writing…" rows so the student sees the course assembling itself live.
// lessonId: the lesson's URL id — powers Ask-the-Tutor's API calls.
export function LessonPlayer({ lesson, pending = [], lessonId = null }) {
  const live = pending.length > 0;
  const player = useLessonClock(lesson.scenes, { awaitingMore: live });
  const { scene, sceneIndex, tMs, durationMs, playing } = player;
  const stageRef = useRef(null);
  const progressKey = `forever:progress:${lesson.sourcePackId}`;
  const [completed, setCompleted] = useState(() => new Set());

  // Progress is per-user, per-browser — hydrate after mount (SSR has no localStorage).
  useEffect(() => {
    try {
      setCompleted(new Set(JSON.parse(localStorage.getItem(progressKey) || '[]')));
    } catch { /* corrupted store -> start fresh */ }
  }, [progressKey]);

  // A scene watched to its end is complete — the checkmark is EARNED, not decorative.
  useEffect(() => {
    if (tMs < durationMs - 120 || completed.has(scene.sceneId)) return;
    const next = new Set(completed).add(scene.sceneId);
    setCompleted(next);
    try { localStorage.setItem(progressKey, JSON.stringify([...next])); } catch { /* private mode */ }
  }, [tMs, durationMs, scene.sceneId, completed, progressKey]);

  // Keyboard: space = play/pause, arrows = ±10s (unless typing in an input).
  useEffect(() => {
    const onKey = (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); player.togglePlay(); }
      if (e.code === 'ArrowRight') player.skip(10_000);
      if (e.code === 'ArrowLeft') player.skip(-10_000);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player]);

  const totalMs = lesson.scenes.reduce((n, s) => n + (s.durationMs || 0), 0);
  const totalPlanned = lesson.scenes.length + pending.length;
  const pct = Math.round((completed.size / totalPlanned) * 100);
  let stripOffset = 0;

  return (
    <div style={{ minHeight: '100vh', color: V('--ink-body'), fontFamily: 'var(--font-inter), system-ui, sans-serif', position: 'relative', isolation: 'isolate' }}>
      {/* FULL-BLEED photo background — the cafe IS the room the lesson lives in. Content sits
          on opaque cards and the dark theater, so the photo carries atmosphere, never text. */}
      <div aria-hidden style={{
        position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none',
        backgroundImage: 'url(/premium-bg.png)', backgroundSize: 'cover', backgroundPosition: 'center 40%',
        filter: 'saturate(0.96)',
      }} />
      {/* A light warm veil keeps the field cohesive and the glass header legible. */}
      <div aria-hidden style={{
        position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none',
        background: 'linear-gradient(180deg, rgba(251,241,238,.20) 0%, rgba(251,241,238,.12) 40%, rgba(247,235,229,.34) 100%)',
      }} />

      {/* ---- header: glass chrome (spec §C) ---- */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 20, display: 'flex', alignItems: 'center', gap: 14, padding: '12px 24px',
        background: 'rgba(255,250,246,.58)', backdropFilter: 'blur(16px) saturate(170%)', WebkitBackdropFilter: 'blur(16px) saturate(170%)',
        borderBottom: '1px solid rgba(221,188,174,.55)', boxShadow: '0 1px 0 rgba(255,255,255,.5) inset',
      }}>
        <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', color: V('--ink') }}>
          <span style={{
            width: 30, height: 30, borderRadius: 9, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800,
            background: 'linear-gradient(180deg, #F5837A, #EF6154)', boxShadow: '0 2px 6px rgba(232,96,76,.35), inset 0 1px 0 rgba(255,255,255,.35)',
          }}>F</span>
          <span style={{ fontWeight: 700, fontSize: 16.5, letterSpacing: '-0.01em' }}>Forever <span style={{ fontWeight: 500, fontSize: 11.5, color: V('--ink-muted') }}>AI Tutor</span></span>
        </a>
        <div style={{ marginLeft: 14, minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--font-fraunces), Georgia, serif', fontWeight: 600, fontSize: 16.5, color: V('--ink'),
            letterSpacing: '-0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{lesson.lessonTitle}</div>
          <div style={{ fontSize: 12, color: V('--ink-muted'), fontVariantNumeric: 'tabular-nums' }}>
            Scene {sceneIndex + 1} of {totalPlanned} · <span style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontStyle: 'italic' }}>{scene.title}</span>
          </div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: V('--ink-muted'), whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 7 }}>
          {live && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#a06b1f', background: '#fef3e2', borderRadius: 999, padding: '3px 11px' }}>
              <span className="forever-dot" style={{ width: 7, height: 7, borderRadius: '50%', background: V('--coral') }} />
              building live · {lesson.scenes.length}/{totalPlanned} scenes ready
            </span>
          )}
          {lesson.voiced ? 'voiced by the agent society' : 'generated by the agent society'}
        </div>
      </header>

      <main style={{ display: 'flex', gap: 20, maxWidth: 1380, margin: '20px auto', padding: '0 20px', alignItems: 'flex-start' }}>
        {/* ---- episode sidebar: brightest card on the field (spec law 3) ---- */}
        <aside style={{
          width: 284, flexShrink: 0, background: '#FFFFFF', border: `1px solid ${V('--border')}`,
          borderRadius: 20, padding: 18, boxShadow: V('--card-shadow'),
        }}>
          <div style={{ fontFamily: 'var(--font-fraunces), Georgia, serif', fontWeight: 620, fontSize: 16, color: V('--ink'), letterSpacing: '-0.015em', lineHeight: 1.3, marginBottom: 3 }}>
            {lesson.lessonTitle}
          </div>
          <div style={{ fontSize: 12, color: V('--ink-muted'), marginBottom: 12, fontVariantNumeric: 'tabular-nums' }}>
            {live ? `${lesson.scenes.length} of ${totalPlanned} scenes ready · ${fmt(totalMs)}+` : `${lesson.scenes.length} scenes · ${fmt(totalMs)} total`}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <div style={{ flex: 1, height: 6, borderRadius: 4, background: V('--surface-sunken') }}>
              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: `linear-gradient(90deg, ${V('--coral')}, #EF6154)`, transition: 'width 600ms var(--ease-out-soft)' }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: pct === 100 ? V('--amber') : V('--ink-muted'), fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
          </div>

          {lesson.scenes.map((s, index) => {
            const active = index === sceneIndex;
            const isDone = completed.has(s.sceneId);
            return (
              <button
                key={s.sceneId}
                onClick={() => player.goToScene(index)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                  padding: '10px 10px 10px 13px', marginBottom: 6, borderRadius: 12, cursor: 'pointer',
                  fontFamily: 'inherit', position: 'relative',
                  border: '1px solid transparent',
                  borderColor: active ? 'transparent' : V('--border'),
                  background: active ? '#FDECE8' : '#FFFDFB',
                  boxShadow: active ? 'inset 3px 0 0 0 ' + 'var(--coral-deep)' : 'none',
                  transition: 'background 200ms var(--ease-out-soft), box-shadow 200ms var(--ease-out-soft)',
                }}
              >
                <span style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
                  fontSize: 11.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                  background: isDone ? V('--amber') : active ? V('--coral-deep') : V('--surface-sunken'),
                  color: isDone || active ? '#fff' : V('--ink-muted'),
                }}>
                  {isDone ? '✓' : index + 1}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, lineHeight: 1.3, color: V('--ink') }}>{s.title}</span>
                  <span style={{ fontSize: 11, color: V('--ink-muted'), fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(s.durationMs)}{s.pedagogicalRole ? ` · ${s.pedagogicalRole.replace(/_/g, ' ')}` : ''}
                  </span>
                </span>
              </button>
            );
          })}

          <PendingSceneRows pending={pending} startNumber={lesson.scenes.length + 1} />
        </aside>

        {/* ---- THEATER: the board glows on an espresso-dark surround (spec §E) ---- */}
        <section style={{ flex: 1, minWidth: 0 }}>
          {player.audioUrl && (
            <audio ref={player.audioRef} src={player.audioUrl} preload="auto" key={player.audioUrl} />
          )}
          <div style={{
            background: `linear-gradient(180deg, ${V('--theater-surface')}, ${V('--theater-bg')} 70%)`,
            borderRadius: 24, padding: 16,
            border: '1px solid rgba(184,127,36,.22)',
            boxShadow: '0 2px 4px rgba(27,16,13,.22), 0 14px 32px rgba(27,16,13,.30), 0 40px 80px rgba(27,16,13,.26), inset 0 1px 0 rgba(247,233,227,.10), inset 0 0 0 1px rgba(27,16,13,.4)',
          }}>
            <div ref={stageRef} style={{ background: V('--surface'), borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 0 rgba(255,255,255,.08)', position: 'relative' }}>
              <StagePresenter scene={scene} tMs={tMs} title={scene.title} setHold={player.setHold} />
              {/* STALL-RESUME: caught up with the society — playback resumes by itself. */}
              {player.stalled && <StallOverlay />}
            </div>

            {/* dark glass controls — chrome lives inside the theater */}
            <div style={{
              display: 'flex', gap: 11, alignItems: 'center', marginTop: 14, padding: '8px 12px',
              background: 'rgba(34,21,18,.55)', border: '1px solid rgba(247,233,227,.12)', borderRadius: 14,
              backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', color: V('--theater-ink'),
            }}>
              <button onClick={player.togglePlay} aria-label={playing ? 'Pause' : 'Play'} className="forever-btn"
                style={{ width: 42, height: 42, borderRadius: '50%', fontSize: 16, cursor: 'pointer', flexShrink: 0 }}>
                {playing ? '❚❚' : '▶'}
              </button>
              <button onClick={() => player.skip(-10_000)} title="Back 10s" style={theaterChip()}>−10s</button>
              <button onClick={() => player.skip(10_000)} title="Forward 10s" style={theaterChip()}>+10s</button>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12.5, color: 'rgba(247,233,227,.75)', whiteSpace: 'nowrap' }}>
                {fmt(tMs)} / {fmt(durationMs)}
              </span>
              <input
                type="range" min="0" max={durationMs || 1} value={Math.min(tMs, durationMs)}
                onChange={(e) => player.seek(Number(e.target.value))}
                style={{ flex: 1, accentColor: V('--coral') }}
              />
              <button
                onClick={() => player.setRate(SPEEDS[(SPEEDS.indexOf(player.rate) + 1) % SPEEDS.length])}
                title="Playback speed" style={theaterChip({ minWidth: 50, fontVariantNumeric: 'tabular-nums' })}>
                {player.rate}x
              </button>
              <button
                onClick={() => (document.fullscreenElement ? document.exitFullscreen() : stageRef.current?.requestFullscreen())}
                title="Fullscreen" style={theaterChip()}>
                ⛶
              </button>
            </div>
          </div>

          {/* Ask-the-Tutor: the student's hand-raise — playback holds while typing. */}
          {lessonId && <AskTutor lessonId={lessonId} sceneId={scene.sceneId} sceneTitle={scene.title} setHold={player.setHold} />}

          {/* scene timeline strip */}
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '16px 2px 6px' }}>
            {lesson.scenes.map((s, index) => {
              const startMs = stripOffset;
              stripOffset += s.durationMs || 0;
              const active = index === sceneIndex;
              return (
                <button
                  key={s.sceneId}
                  onClick={() => player.goToScene(index)}
                  className={active ? undefined : 'forever-chip'}
                  style={{
                    flexShrink: 0, width: 192, textAlign: 'left', padding: '10px 13px', borderRadius: 12, cursor: 'pointer',
                    fontFamily: 'inherit',
                    border: `1px solid ${active ? V('--coral') : V('--border')}`,
                    background: active ? '#FDECE8' : '#FFFDFB',
                    boxShadow: active ? '0 2px 3px hsl(14deg 45% 42% / .09), 0 8px 18px hsl(14deg 45% 42% / .12)' : undefined,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 650, marginBottom: 3, color: V('--ink'), lineHeight: 1.3 }}>{index + 1}. {s.title}</div>
                  <div style={{ fontSize: 11, color: V('--ink-muted'), fontVariantNumeric: 'tabular-nums' }}>{fmt(startMs)} – {fmt(startMs + (s.durationMs || 0))}</div>
                </button>
              );
            })}
            <PendingSceneChips pending={pending} startNumber={lesson.scenes.length + 1} />
          </div>
        </section>
      </main>
    </div>
  );
}

// Chips inside the dark theater chrome: quiet glass, light warm ink — never grey (spec law 1).
function theaterChip(extra = {}) {
  return {
    padding: '7px 11px', borderRadius: 9, cursor: 'pointer', fontSize: 12, fontWeight: 650,
    fontFamily: 'inherit', color: 'var(--theater-ink)',
    background: 'rgba(247,233,227,.08)', border: '1px solid rgba(247,233,227,.16)',
    transition: 'background 150ms var(--ease-out-soft)',
    ...extra,
  };
}
