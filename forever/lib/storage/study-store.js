// STUDY STORE — bookmarks and lesson progress, one tiny record each, always owner-scoped.
// Design source (notes/research/): the competitor harvest's "first five minutes" law — a
// student who returns must land exactly where they left off, and moments they marked must be
// one click away. Mongo-backed with the same graceful no-DB fallback the app uses elsewhere
// (features simply report empty when the DB is off — never a crash).

import { studyCollection } from './db.js';

const bmId = (userId, lessonId, sceneId, tMs) => `bm_${userId}_${lessonId}_${sceneId}_${Math.round(tMs)}`;

export async function addBookmark({ userId, lessonId, lessonTitle = '', sceneId, sceneTitle = '', tMs = 0, note = '', context = '' }) {
  if (!userId || !lessonId) throw new Error('bookmark needs userId and lessonId');
  const col = await studyCollection();
  if (!col) return null;
  const doc = {
    _id: bmId(userId, lessonId, sceneId ?? 'x', tMs), kind: 'bookmark', userId,
    lessonId, lessonTitle, sceneId: sceneId ?? null, sceneTitle, tMs, note: String(note).slice(0, 500),
    // Rayan-style memory object: the TEACHING LINE being spoken at this exact moment rides
    // with the bookmark — a card you can re-read, not a bare timestamp.
    context: String(context).slice(0, 300),
    // Spaced review (SM-2 lite): every kept moment becomes a reviewable item.
    reviewInterval: 1, reviewDue: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
  };
  await col.replaceOne({ _id: doc._id }, doc, { upsert: true });
  return doc;
}

export async function listBookmarks(userId) {
  const col = await studyCollection();
  if (!col || !userId) return [];
  return col.find({ kind: 'bookmark', userId }).sort({ createdAt: -1 }).limit(200).toArray();
}

// Deterministic spaced repetition: 'good' multiplies the interval (1 -> 2.5 -> 6 -> 16 days
// capped at 60); 'again' resets to 10 minutes. No AI anywhere near scheduling.
export async function reviewBookmark(userId, id, grade) {
  const col = await studyCollection();
  if (!col || !userId) return null;
  const doc = await col.findOne({ _id: id, userId, kind: 'bookmark' });
  if (!doc) return null;
  const interval = grade === 'good' ? Math.min(60, Math.max(2.5, (doc.reviewInterval ?? 1) * 2.5)) : 1;
  const due = grade === 'good'
    ? new Date(Date.now() + interval * 24 * 3600 * 1000).toISOString()
    : new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await col.updateOne({ _id: id }, { $set: { reviewInterval: interval, reviewDue: due, lastReviewed: new Date().toISOString() } });
  return { id, reviewInterval: interval, reviewDue: due };
}

export async function removeBookmark(userId, id) {
  const col = await studyCollection();
  if (!col || !userId) return false;
  const r = await col.deleteOne({ _id: id, userId, kind: 'bookmark' });
  return r.deletedCount === 1;
}

// Progress: ONE record per (user, lesson) — the resume point plus scene completion.
export async function saveProgress({ userId, lessonId, lessonTitle = '', sceneIndex = 0, sceneCount = 0, tMs = 0, completedCount = 0, completed = false }) {
  if (!userId || !lessonId) return null;
  const col = await studyCollection();
  if (!col) return null;
  const doc = {
    _id: `pr_${userId}_${lessonId}`, kind: 'progress', userId, lessonId, lessonTitle,
    sceneIndex, sceneCount, tMs, completedCount, completed,
    // The bar is EARNED: scenes watched to their end count; the scene you are inside adds
    // nothing until finished (same law as the player's checkmarks).
    percent: completed ? 100 : sceneCount > 0 ? Math.min(99, Math.round((completedCount / sceneCount) * 100)) : 0,
    updatedAt: new Date().toISOString(),
  };
  await col.replaceOne({ _id: doc._id }, doc, { upsert: true });
  return doc;
}

export async function getProgress(userId, lessonId) {
  const col = await studyCollection();
  if (!col || !userId) return null;
  return col.findOne({ _id: `pr_${userId}_${lessonId}`, kind: 'progress' });
}

export async function listProgress(userId) {
  const col = await studyCollection();
  if (!col || !userId) return [];
  return col.find({ kind: 'progress', userId }).sort({ updatedAt: -1 }).limit(100).toArray();
}
