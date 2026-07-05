'use client';

// Reusable playback hook: drives a multi-scene lesson on the one clock, with scene
// auto-advance (onEnded -> next). UI components consume this; it owns no rendering.

import { useEffect, useRef, useState } from 'react';

import { createManualClock } from '../../lib/playback/clock/manual-clock.js';

export function useLessonClock(scenes) {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [tMs, setTMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const clockRef = useRef(null);
  if (!clockRef.current) clockRef.current = createManualClock();
  const clock = clockRef.current;

  const durationMs = scenes[sceneIndex].durationMs;

  useEffect(() => {
    let frame;
    const tick = () => {
      const next = Math.min(clock.currentTimeMs(), durationMs);
      setTMs(next);
      if (next >= durationMs && clock.isPlaying()) {
        clock.pause();
        if (sceneIndex < scenes.length - 1) setSceneIndex((index) => index + 1);
        else setPlaying(false);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clock, durationMs, sceneIndex, scenes.length]);

  useEffect(() => {
    clock.seek(0);
    setTMs(0);
    if (playing) clock.play();
  }, [sceneIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    sceneIndex,
    scene: scenes[sceneIndex],
    tMs,
    durationMs,
    playing,
    togglePlay() {
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
      clock.seek(ms);
      setTMs(ms);
    },
    goToScene(index) {
      setSceneIndex(index);
      clock.seek(0);
      setTMs(0);
    },
  };
}
