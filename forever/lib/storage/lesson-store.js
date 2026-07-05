// Lesson persistence seam. Phase 5 backs this with ApsaraDB RDS (metadata) + OSS
// (manifests/audio). For now it is a filesystem store under .data/lessons so the real
// app/course/[id] route works end to end without cloud infra — same interface, so the
// swap to RDS/OSS is one implementation change, not a route change.

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.join(process.cwd(), '.data', 'lessons');

export async function saveLesson(id, lesson) {
  await mkdir(ROOT, { recursive: true });
  await writeFile(path.join(ROOT, `${id}.json`), JSON.stringify(lesson));
  return id;
}

export async function loadLesson(id) {
  try {
    return JSON.parse(await readFile(path.join(ROOT, `${sanitize(id)}.json`), 'utf8'));
  } catch {
    return null;
  }
}

export async function listLessonIds() {
  try {
    return (await readdir(ROOT)).filter((name) => name.endsWith('.json')).map((name) => name.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}

function sanitize(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '');
}
