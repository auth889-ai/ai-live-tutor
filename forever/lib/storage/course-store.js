// Course persistence — the outline + per-lesson generation state + the embedded SourcePack
// (so later lessons generate from the same material without re-ingesting). Same dual
// backend as every store: MONGODB_URI set -> MongoDB, unset -> filesystem .data/courses.
// Owner scoping lives IN the query, like lessons.

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { dbEnabled, coursesCollection } from './db.js';

const ROOT = path.join(process.cwd(), '.data', 'courses');

export function courseIdFor(sourcePackId) {
  return `course_${String(sourcePackId).replace(/[^a-z0-9]/gi, '').slice(0, 16)}`;
}

export async function saveCourse(id, course, { ownerId = null, collection = coursesCollection } = {}) {
  const stored = { ...course, ownerId };
  if (dbEnabled()) {
    const courses = await collection();
    await courses.replaceOne(
      { _id: id },
      { _id: id, ownerId, title: course.outline?.title ?? 'Untitled course', payload: stored, updatedAt: new Date() },
      { upsert: true },
    );
    return id;
  }
  await mkdir(ROOT, { recursive: true });
  await writeFile(path.join(ROOT, `${id}.json`), JSON.stringify(stored));
  return id;
}

export async function loadCourse(id, { forUser = null, collection = coursesCollection } = {}) {
  if (dbEnabled()) {
    const courses = await collection();
    const doc = await courses.findOne({ _id: sanitize(id), $or: [{ ownerId: null }, { ownerId: forUser }] });
    return doc?.payload ?? null;
  }
  try {
    const course = JSON.parse(await readFile(path.join(ROOT, `${sanitize(id)}.json`), 'utf8'));
    if (course.ownerId && course.ownerId !== forUser) return null;
    return course;
  } catch {
    return null;
  }
}

// Library cards (id + title + lesson progress counts), never full payloads.
export async function listCourses({ forUser = null, collection = coursesCollection } = {}) {
  const summarize = (course, id) => {
    const lessons = (course.outline?.episodes ?? []).flatMap((episode) => episode.lessons ?? []);
    return {
      id,
      title: course.outline?.title ?? 'Untitled course',
      episodes: course.outline?.episodes?.length ?? 0,
      lessons: lessons.length,
      ready: lessons.filter((lesson) => course.lessonLinks?.[lesson.id]?.lessonId).length,
    };
  };
  if (dbEnabled()) {
    const courses = await collection();
    const docs = await courses.find({ $or: [{ ownerId: null }, { ownerId: forUser }] }).sort({ updatedAt: -1 }).toArray();
    return docs.map((doc) => summarize(doc.payload, doc._id));
  }
  try {
    const ids = (await readdir(ROOT)).filter((name) => name.endsWith('.json')).map((name) => name.replace(/\.json$/, ''));
    const visible = [];
    for (const id of ids) {
      const course = await loadCourse(id, { forUser });
      if (course) visible.push(summarize(course, id));
    }
    return visible;
  } catch {
    return [];
  }
}

// Record that an outline lesson now has a generated lesson behind it. ATOMIC on the DB
// backend ($set of one key) — lesson jobs run in PARALLEL, and a read-modify-write here
// would lose links when two lessons finish at once.
export async function linkCourseLesson(id, outlineLessonId, lessonId, { forUser = null, collection = coursesCollection } = {}) {
  if (dbEnabled()) {
    const courses = await collection();
    const res = await courses.updateOne(
      { _id: sanitize(id), $or: [{ ownerId: null }, { ownerId: forUser }] },
      {
        $set: {
          [`payload.lessonLinks.${outlineLessonId}`]: { lessonId, generatedAt: new Date().toISOString() },
          updatedAt: new Date(),
        },
      },
    );
    if (res.matchedCount === 0) throw new Error(`Course ${id} not found`);
    return;
  }
  const course = await loadCourse(id, { forUser });
  if (!course) throw new Error(`Course ${id} not found`);
  course.lessonLinks = { ...(course.lessonLinks ?? {}), [outlineLessonId]: { lessonId, generatedAt: new Date().toISOString() } };
  await saveCourse(id, course, { ownerId: course.ownerId ?? null });
}

function sanitize(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '');
}
