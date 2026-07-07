// One-off migration: filesystem .data/{lessons,users} -> MongoDB. Idempotent (lessons
// upsert; existing users are skipped), so it is safe to re-run. Run with:
//   node --env-file=.env scripts/migrate-data-to-db.mjs

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { dbEnabled, usersCollection, closeDb } from '../lib/storage/db.js';
import { saveLesson } from '../lib/storage/lesson-store.js';

if (!dbEnabled()) {
  console.error('MONGODB_URI is not set — nothing to migrate into.');
  process.exit(1);
}

let lessons = 0;
for (const name of await readdir('.data/lessons').catch(() => [])) {
  if (!name.endsWith('.json')) continue;
  const lesson = JSON.parse(await readFile(path.join('.data/lessons', name), 'utf8'));
  await saveLesson(name.replace(/\.json$/, ''), lesson, { ownerId: lesson.ownerId ?? null });
  lessons += 1;
}

const users = await usersCollection();
let migrated = 0;
for (const name of await readdir('.data/users').catch(() => [])) {
  if (!name.startsWith('user_') || !name.endsWith('.json')) continue;
  const user = JSON.parse(await readFile(path.join('.data/users', name), 'utf8'));
  try {
    await users.insertOne({ _id: user.userId, email: user.email, passwordHash: user.passwordHash, createdAt: new Date(user.createdAt || Date.now()) });
    migrated += 1;
  } catch (error) {
    if (error?.code !== 11000) throw error; // already migrated -> skip silently
  }
}

console.log(`Migrated ${lessons} lesson(s), ${migrated} new user(s) into MongoDB.`);
await closeDb();
