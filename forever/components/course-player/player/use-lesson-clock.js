'use client';

// Reusable playback hook. Uses a real <audio> element as the clock when the scene is
// voiced (audioUrl), else a manual clock — same interface either way (playbook decision),
// so the board sync code is identical. Scenes auto-advance (onEnded -> next).

import { useEffect, useRef, useState } from 'react';

import { createManualClock } from '../../../lib/playback/clock/manual-clock.js';
import { createAudioClock } from '../../../lib/playback/clock/audio-clock.js';

// awaitingMore (progressive playback): the lesson is still BUILDING and more scenes will
// arrive. Reaching the end of the last ready scene then means "stall and wait" — playback
// auto-resumes the moment the next scene lands — instead of "lesson over".
export function useLessonClock(scenes, { awaitingMore = false } = {}) {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [tMs, setTMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [rate, setRateState] = useState(1);
  const audioRef = useRef(null);
  const manualRef = useRef(null);
  const holdRef = useRef(false);
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
      // A quiz (or any interactive block) holds playback until the student acts.
      if (holdRef.current) {
        if (clock.isPlaying()) clock.pause();
        frame = requestAnimationFrame(tick);
        return;
      }
      const next = Math.min(clock.currentTimeMs(), durationMs);
      setTMs(next);
      if (next >= durationMs - 20 && clock.isPlaying()) {
        clock.pause();
        if (sceneIndex < scenes.length - 1) setSceneIndex((index) => index + 1);
        else if (awaitingMore) { setStalled(true); setPlaying(false); } // the next scene is still being written
        else setPlaying(false);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [sceneIndex, durationMs, scenes.length, awaitingMore]); // eslint-disable-line react-hooks/exhaustive-deps

  // STALL-RESUME: a freshly arrived scene un-stalls playback automatically (the student
  // pressed nothing — the pause was ours, so the resume is ours too).
  useEffect(() => {
    if (stalled && sceneIndex < scenes.length - 1) {
      setStalled(false);
      setPlaying(true);
      setSceneIndex((index) => index + 1);
    }
  }, [scenes.length, stalled, sceneIndex]);

  useEffect(() => {
    const clock = getClock();
    clock.seek(0);
    clock.setRate(rate); // a fresh <audio> element resets to 1x — keep the chosen speed
    setTMs(0);
    if (playing) clock.play();
  }, [sceneIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    sceneIndex,
    scene,
    tMs,
    durationMs,
    playing,
    stalled,
    audioRef,
    audioUrl: scene.audioUrl || null,
    setHold(held) {
      holdRef.current = held;
    },
    togglePlay() {
      setStalled(false); // a manual action always takes back control
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
    skip(deltaMs) {
      const clock = getClock();
      const next = Math.min(Math.max(0, clock.currentTimeMs() + deltaMs), durationMs);
      clock.seek(next);
      setTMs(next);
    },
    rate,
    setRate(nextRate) {
      getClock().setRate(nextRate);
      setRateState(nextRate);
    },
    goToScene(index) {
      setStalled(false);
      setSceneIndex(index);
      getClock().seek(0);
      setTMs(0);
    },
  };
}
