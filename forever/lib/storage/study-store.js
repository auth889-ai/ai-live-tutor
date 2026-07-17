// STUDY STORE — bookmarks and lesson progress, one tiny record each, always owner-scoped.
// Design source (notes/research/): the competitor harvest's "first five minutes" law — a
// student who returns must land exactly where they left off, and moments they marked must be
// one click away. Mongo-backed with the same graceful no-DB fallback the app uses elsewhere
// (features simply report empty when the DB is off — never a crash).

import { studyCollection } from './db.js';

// Per-day activity (heatmap + weekly goal, GitHub/Duolingo pattern): tiny counter docs,
// incremented by REAL events only — scene completions use the delta between saves, so
// refreshing a page can never inflate a day.
const dayId = (userId) => `day_${userId}_${new Date().toISOString().slice(0, 10)}`;
async function bumpDay(userId, field, by = 1) {
  const col = await studyCollection();
  if (!col || !userId || by <= 0) return;
  await col.updateOne(
    { _id: dayId(userId) },
    { $inc: { [field]: by }, $set: { kind: 'day', userId, date: new Date().toISOString().slice(0, 10) } },
    { upsert: true },
  );
}

export async function listDays(userId, daysBack = 120) {
  const col = await studyCollection();
  if (!col || !userId) return [];
  const since = new Date(Date.now() - daysBack * 24 * 3600 * 1000).toISOString().slice(0, 10);
  return col.find({ kind: 'day', userId, date: { $gte: since } }).toArray();
}

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
  await bumpDay(userId, 'bookmarks');
  return doc;
}

// The player's seek-bar markers (YouTube chapter-dot pattern): this lesson's kept moments.
export async function listLessonBookmarks(userId, lessonId) {
  const col = await studyCollection();
  if (!col || !userId) return [];
  return col.find({ kind: 'bookmark', userId, lessonId }).sort({ tMs: 1 }).toArray();
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
  await bumpDay(userId, 'reviews');
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
  // Scene-completion DELTA feeds the day counter — the weekly ring counts real finishes.
  const prev = await col.findOne({ _id: `pr_${userId}_${lessonId}` });
  const delta = Math.max(0, (completedCount ?? 0) - (prev?.completedCount ?? 0));
  if (delta > 0) await bumpDay(userId, 'scenes', delta);
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


// BADGES (Khan-style milestones): recomputed deterministically from the data on every read —
// no badge storage, no way to fake one.
export function computeBadges({ progress = [], bookmarks = [], streak = 0, totalScenes = 0, totalReviews = 0 }) {
  const done = progress.filter((p) => p.completed).length;
  const defs = [
    ['🎬', 'First scene', totalScenes >= 1 || progress.some((p) => (p.completedCount ?? 0) > 0)],
    ['🏁', 'First lesson complete', done >= 1],
    ['📚', '3 lessons complete', done >= 3],
    ['🎓', '10 lessons complete', done >= 10],
    ['🔥', '3-day streak', streak >= 3],
    ['⚡', '7-day streak', streak >= 7],
    ['🌟', '30-day streak', streak >= 30],
    ['🔖', 'First bookmark', bookmarks.length >= 1],
    ['🗂', '10 kept moments', bookmarks.length >= 10],
    ['🧠', 'First review done', totalReviews >= 1 || bookmarks.some((b) => b.lastReviewed)],
    ['🏆', '25 reviews done', totalReviews >= 25],
  ];
  return defs.map(([icon, label, earned]) => ({ icon, label, earned: Boolean(earned) }));
}
