// DEV PREVIEW ONLY — supplies a locally generated lesson to the real, reusable player.
// The player itself lives in components/course-player (used by the real app/course/[id]
// route too). This page just feeds it cached agent output for quick visual iteration.

import { LessonPlayer } from '../../../components/course-player/lesson-player.js';
import lesson from './generated-lesson.json';

export default function DevLessonPage() {
  return <LessonPlayer lesson={lesson} />;
}
