// Lesson persistence seam. Phase 5 backs this with ApsaraDB RDS (metadata) + OSS
// (manifests/audio). For now it is a filesystem store under .data/lessons so the real
// app/course/[id] route works end to end without cloud infra — same interface, so the
// swap to RDS/OSS is one implementation change, not a route change.

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.join(process.cwd(), '.data', 'lessons');

// PRIVACY: every lesson records its owner; reads are scoped in THIS data layer (not
// middleware-only) so one user can never see another user's courses or notes.
export async function saveLesson(id, lesson, { ownerId = null } = {}) {
  await mkdir(ROOT, { recursive: true });
  await writeFile(path.join(ROOT, `${id}.json`), JSON.stringify({ ...lesson, ownerId }));
  return id;
}

// Returns the lesson only if it belongs to forUser (legacy ownerless lessons stay readable).
export async function loadLesson(id, { forUser = null } = {}) {
  try {
    const lesson = JSON.parse(await readFile(path.join(ROOT, `${sanitize(id)}.json`), 'utf8'));
    if (lesson.ownerId && lesson.ownerId !== forUser) return null; // not yours -> as if it doesn't exist
    return lesson;
  } catch {
    return null;
  }
}

export async function listLessonIds({ forUser = null } = {}) {
  return (await listLessons({ forUser })).map((lesson) => lesson.id);
}

// Library cards for the dashboard: id + the display facts, never full scene payloads.
export async function listLessons({ forUser = null } = {}) {
  try {
    const ids = (await readdir(ROOT)).filter((name) => name.endsWith('.json')).map((name) => name.replace(/\.json$/, ''));
    const visible = [];
    for (const id of ids) {
      const lesson = await loadLesson(id, { forUser });
      if (!lesson) continue;
      visible.push({
        id,
        title: lesson.lessonTitle ?? id,
        scenes: lesson.scenes?.length ?? 0,
        voiced: lesson.voiced === true,
        durationMs: (lesson.scenes ?? []).reduce((n, s) => n + (s.durationMs || 0), 0),
      });
    }
    return visible;
  } catch {
    return [];
  }
}

function sanitize(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '');
}
