// The REAL course route (production structure). It loads a stored lesson by id and
// hands it to the reusable player. Lesson persistence (RDS/OSS) lands in Phase 5;
// until then this route documents the intended shape and 404s for unknown ids.

import { notFound } from 'next/navigation';

import { LessonPlayer } from '../../../components/course-player/player/lesson-player.js';
import { loadLesson } from '../../../lib/storage/lesson-store.js';

export default async function CoursePage({ params }) {
  const { id } = await params;
  const lesson = await loadLesson(id);
  if (!lesson) notFound();
  return <LessonPlayer lesson={lesson} />;
}
