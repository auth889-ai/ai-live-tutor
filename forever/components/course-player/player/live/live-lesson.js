'use client';

// Live lesson shell (one job): decide WHICH experience a building lesson shows right now —
// the waiting screen (no scene watchable yet) or the real player fed with the growing
// ready prefix. Data comes from useBuildingLesson; rendering belongs to the pieces.

import { LessonPlayer } from '../lesson-player.js';
import { useBuildingLesson } from './use-building-lesson.js';
import { WaitingScreen } from './waiting-screen.js';

export function LiveLesson({ lessonId, initial }) {
  const { lesson, readyScenes, pending } = useBuildingLesson(lessonId, initial);

  if (readyScenes.length === 0) return <WaitingScreen lesson={lesson} />;
  return <LessonPlayer lesson={{ ...lesson, scenes: readyScenes }} pending={pending} />;
}
