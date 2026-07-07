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
      ]);
      return db;
    });
  }
  return dbPromise;
}

export async function usersCollection(env = process.env) {
  return (await getDb(env)).collection('users');
}

export async function lessonsCollection(env = process.env) {
  return (await getDb(env)).collection('lessons');
}

export async function closeDb() {
  if (client) {
    const closing = client.close();
    client = null;
    dbPromise = null;
    await closing;
  }
}
