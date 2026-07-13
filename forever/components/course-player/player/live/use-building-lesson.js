'use client';

// Building-lesson data hook (one job): while a lesson's status is "building", poll the
// lesson API and expose { lesson, readyScenes, pending }. Polling stops the moment the
// stored status flips to "ready" (or the component unmounts). No UI in here.

import { useEffect, useState } from 'react';

const POLL_MS = 3500;

// Scenes are stored with sceneIndex during a build; only the contiguous prefix from 0 is
// watchable in order (playback is sequential — never jump the story).
export function playableScenePrefix(lesson) {
  const scenes = lesson.scenes ?? [];
  if (lesson.status !== 'building') return scenes;
  const prefix = [];
  for (const scene of scenes) {
    if ((scene.sceneIndex ?? prefix.length) !== prefix.length) break;
    prefix.push(scene);
  }
  return prefix;
}

export function useBuildingLesson(lessonId, initial) {
  const [lesson, setLesson] = useState(initial);

  useEffect(() => {
    if (lesson.status !== 'building') return undefined;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/lessons/${lessonId}`, { cache: 'no-store' });
        if (!response.ok) return; // transient (e.g. a partial save in flight) — next tick retries
        const next = await response.json();
        if (!cancelled) setLesson(next);
      } catch { /* offline blip — next tick retries */ }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [lessonId, lesson.status]);

  const readyScenes = playableScenePrefix(lesson);
  const pending = lesson.status === 'building'
    ? (lesson.plannedScenes ?? []).slice(readyScenes.length)
    : [];
  return { lesson, readyScenes, pending };
}
