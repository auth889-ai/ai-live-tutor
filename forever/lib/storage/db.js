// The ONE MongoDB access point. Records live in the database — users, lessons; blobs
// (audio, images, uploads) belong in object storage (OSS), never in a database. Backend
// selection is explicit env config, the same pattern as the queue (BullMQ when REDIS_URL
// is set): MONGODB_URI set -> MongoDB stores, unset -> filesystem dev stores. Works
// unchanged against MongoDB Atlas (dev) and Alibaba ApsaraDB for MongoDB (production
// deployment) — same driver, different URI. Indexes are ensured once per process, so a
// fresh cluster works on first boot with zero manual steps.

import { MongoClient } from 'mongodb';

let client = null;
let dbPromise = null;

export function dbEnabled(env = process.env) {
  return Boolean(env.MONGODB_URI?.trim());
}

function getDb(env = process.env) {
  if (!dbPromise) {
    client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
    dbPromise = client.connect().then(async (connected) => {
      const db = connected.db(env.MONGODB_DB || 'forever');
      await Promise.all([
        db.collection('users').createIndex({ email: 1 }, { unique: true }),
        db.collection('lessons').createIndex({ ownerId: 1 }),
        db.collection('courses').createIndex({ ownerId: 1 }),
      ]);
      return db;
    });
  }
  return dbPromise;
}

// Safe accessor: returns the db or null when MONGODB_URI is unset (never throws) — for
// optional features like the focus store that must degrade gracefully offline.
export async function getDbSafe(env = process.env) {
  if (!dbEnabled(env)) return null;
  try { return await getDb(env); } catch { return null; }
}

export async function usersCollection(env = process.env) {
  return (await getDb(env)).collection('users');
}

export async function lessonsCollection(env = process.env) {
  return (await getDb(env)).collection('lessons');
}

export async function studyCollection(env = process.env) {
  // bookmarks + resume-progress records (competitor-harvest law: winners win the first five
  // demo minutes — resuming where you left off and keeping moments is that polish).
  return (await getDb(env))?.collection('study');
}

export async function notebooksCollection(env = process.env) {
  // Sankofa-pattern notebooks: user-created, typed blocks with provenance, generate-a-course
  // action (design: notes/research/notebook-sankofa-plan-18jul.md). Notebook + block docs
  // live together, kind-tagged, always owner-scoped.
  return (await getDb(env))?.collection('notebooks');
}

export async function coursesCollection(env = process.env) {
  return (await getDb(env)).collection('courses');
}

export async function qwenCacheCollection(env = process.env) {
  return (await getDb(env)).collection('qwen_cache');
}

export async function closeDb() {
  if (client) {
    const closing = client.close();
    client = null;
    dbPromise = null;
    await closing;
  }
}
