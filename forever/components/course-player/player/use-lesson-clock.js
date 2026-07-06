'use client';

// Reusable playback hook. Uses a real <audio> element as the clock when the scene is
// voiced (audioUrl), else a manual clock — same interface either way (playbook decision),
// so the board sync code is identical. Scenes auto-advance (onEnded -> next).

import { useEffect, useRef, useState } from 'react';

import { createManualClock } from '../../../lib/playback/clock/manual-clock.js';
import { createAudioClock } from '../../../lib/playback/clock/audio-clock.js';

export function useLessonClock(scenes) {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [tMs, setTMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef(null);
  const manualRef = useRef(null);
  if (!manualRef.current) manualRef.current = createManualClock();

  const scene = scenes[sceneIndex];
  const durationMs = scene.durationMs;
  const voiced = Boolean(scene.audioUrl);

  // The active clock: audio-backed when voiced, else the manual clock.
  const getClock = () => (voiced && audioRef.current ? createAudioClock(audioRef.current) : manualRef.current);

  useEffect(() => {
    let frame;
    const tick = () => {
      const clock = getClock();
      const next = Math.min(clock.currentTimeMs(), durationMs);
      setTMs(next);
      if (next >= durationMs - 20 && clock.isPlaying()) {
        clock.pause();
        if (sceneIndex < scenes.length - 1) setSceneIndex((index) => index + 1);
        else setPlaying(false);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [sceneIndex, durationMs, scenes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const clock = getClock();
    clock.seek(0);
    setTMs(0);
    if (playing) clock.play();
  }, [sceneIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    sceneIndex,
    scene,
    tMs,
    durationMs,
    playing,
    audioRef,
    audioUrl: scene.audioUrl || null,
    togglePlay() {
      const clock = getClock();
      if (clock.isPlaying()) {
        clock.pause();
        setPlaying(false);
      } else {
        if (clock.currentTimeMs() >= durationMs) clock.seek(0);
        clock.play();
        setPlaying(true);
      }
    },
    seek(ms) {
      getClock().seek(ms);
      setTMs(ms);
    },
    goToScene(index) {
      setSceneIndex(index);
      getClock().seek(0);
      setTMs(0);
    },
  };
}
