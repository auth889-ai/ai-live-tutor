// The REAL course route (production structure). It loads a stored lesson by id — scoped
// to the signed-in user, so an owned lesson renders for its owner and 404s for everyone
// else (same privacy rule as the API) — and hands it to the reusable player.

import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import { LessonPlayer } from '../../../components/course-player/player/lesson-player.js';
import { LiveLesson } from '../../../components/course-player/player/live/live-lesson.js';
import { loadLesson } from '../../../lib/storage/lesson-store.js';
import { SESSION_COOKIE, verifySessionToken } from '../../../lib/auth/session.js';

export default async function CoursePage({ params }) {
  const { id } = await params;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? verifySessionToken(token) : null;
  const lesson = await loadLesson(id, { forUser: session?.userId ?? null });
  if (!lesson) notFound();
  // PROGRESSIVE PLAYBACK: a lesson still being written opens through the live shell —
  // waiting theater until scene 1 lands, then the player follows the build.
  if (lesson.status === 'building') return <LiveLesson lessonId={id} initial={lesson} />;
  return <LessonPlayer lesson={lesson} lessonId={id} />;
}
