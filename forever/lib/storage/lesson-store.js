// Lesson persistence. TWO backends behind one interface, selected explicitly by env
// (same pattern as the queue): MONGODB_URI set -> MongoDB (Atlas in dev, Alibaba ApsaraDB
// for MongoDB in production; the lesson document plus denormalized card facts for cheap
// library listing); unset -> filesystem under .data/lessons so local dev and tests need
// no database. PRIVACY lives in THIS data layer (never middleware-only): every lesson
// records its owner and every read is scoped IN THE QUERY, so one user can never see
// another user's courses.

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { dbEnabled, lessonsCollection } from './db.js';

const ROOT = path.join(process.cwd(), '.data', 'lessons');

function lessonFacts(lesson) {
  return {
    title: lesson.lessonTitle ?? 'Untitled lesson',
    scenes: lesson.scenes?.length ?? 0,
    durationMs: (lesson.scenes ?? []).reduce((n, s) => n + (s.durationMs || 0), 0),
    voiced: lesson.voiced === true,
    coverImage: lesson.coverImage?.url ?? null,
  };
}

export async function saveLesson(id, lesson, { ownerId = null, collection = lessonsCollection } = {}) {
  const stored = { ...lesson, ownerId };
  if (dbEnabled()) {
    const lessons = await collection();
    await lessons.replaceOne(
      { _id: id },
      { _id: id, ownerId, ...lessonFacts(lesson), payload: stored, updatedAt: new Date() },
      { upsert: true }, // idempotent: a retried job overwrites the same lesson
    );
    return id;
  }
  await mkdir(ROOT, { recursive: true });
  await writeFile(path.join(ROOT, `${id}.json`), JSON.stringify(stored));
  return id;
}

// Returns the lesson only if it belongs to forUser (ownerless lessons stay readable).
export async function loadLesson(id, { forUser = null, collection = lessonsCollection } = {}) {
  if (dbEnabled()) {
    const lessons = await collection();
    const doc = await lessons.findOne({ _id: sanitize(id), $or: [{ ownerId: null }, { ownerId: forUser }] });
    return doc?.payload ?? null;
  }
  try {
    const lesson = JSON.parse(await readFile(path.join(ROOT, `${sanitize(id)}.json`), 'utf8'));
    if (lesson.ownerId && lesson.ownerId !== forUser) return null; // not yours -> as if it doesn't exist
    return lesson;
  } catch {
    return null;
  }
}

export async function listLessonIds({ forUser = null, collection = lessonsCollection } = {}) {
  return (await listLessons({ forUser, collection })).map((lesson) => lesson.id);
}

// Library cards for the dashboard: id + display facts, never full lesson payloads.
// FOLDER CONCEPT (user design): a lesson that belongs to a course lives INSIDE its course
// folder (the syllabus page) — the library lists only standalone lessons by default, so
// a 16-lesson course is ONE course card, never 16 loose files flooding the shelf.
export async function listLessons({ forUser = null, includeCourseLessons = false, collection = lessonsCollection } = {}) {
  if (dbEnabled()) {
    const lessons = await collection();
    const docs = await lessons
      .find({ $or: [{ ownerId: null }, { ownerId: forUser }] }, { projection: { title: 1, scenes: 1, durationMs: 1, voiced: 1, coverImage: 1, updatedAt: 1, 'payload.courseRef.courseId': 1 } })
      .sort({ updatedAt: -1 })
      .toArray();
    return docs
      .map((doc) => ({ id: doc._id, title: doc.title, scenes: doc.scenes, voiced: doc.voiced === true, durationMs: doc.durationMs ?? 0, coverImage: doc.coverImage ?? null, courseId: doc.payload?.courseRef?.courseId ?? null }))
      .filter((lesson) => includeCourseLessons || !lesson.courseId);
  }
  try {
    const ids = (await readdir(ROOT)).filter((name) => name.endsWith('.json')).map((name) => name.replace(/\.json$/, ''));
    const visible = [];
    for (const id of ids) {
      const lesson = await loadLesson(id, { forUser });
      if (!lesson) continue;
      const courseId = lesson.courseRef?.courseId ?? null;
      if (!includeCourseLessons && courseId) continue;
      visible.push({ id, ...lessonFacts(lesson), courseId });
    }
    return visible;
  } catch {
    return [];
  }
}

function sanitize(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '');
}
