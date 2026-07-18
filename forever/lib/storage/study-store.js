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
export async function bumpDay(userId, field, by = 1) {
  const col = await studyCollection();
  if (!col || !userId || by <= 0) return;
  await col.updateOne(
    { _id: dayId(userId) },
    { $inc: { [field]: by }, $set: { kind: 'day', userId, date: new Date().toISOString().slice(0, 10) } },
    { upsert: true },
  );
}

// CHECKPOINT RESULTS — the unlock that separates "watched" from "learned": a concept only
// counts as verified when a quiz/checkpoint was answered correctly (reviewer principle:
// scene completion is not learning).
export async function recordCheckpoint({ userId, lessonId, quizId, correct }) {
  const col = await studyCollection();
  if (!col || !userId || !lessonId) return null;
  await bumpDay(userId, correct ? 'checkpoints' : 'checkpointMisses');
  await col.updateOne(
    { _id: `pr_${userId}_${lessonId}`, kind: 'progress' },
    { $inc: correct ? { checkpointsPassed: 1 } : { checkpointsMissed: 1 } },
  );
  await col.updateOne(
    { _id: `ck_${userId}_${lessonId}_${quizId ?? 'q'}` },
    { $set: { kind: 'checkpoint', userId, lessonId, quizId: quizId ?? null, correct: Boolean(correct), at: new Date().toISOString() } },
    { upsert: true },
  );
  return true;
}

export async function saveReflection({ userId, choice }) {
  const col = await studyCollection();
  if (!col || !userId) return null;
  await col.updateOne({ _id: dayId(userId) }, { $set: { reflection: String(choice).slice(0, 120) } }, { upsert: true });
  return true;
}

export async function setWeekGoal(userId, goal) {
  const col = await studyCollection();
  if (!col || !userId) return null;
  await col.updateOne({ _id: `set_${userId}` }, { $set: { kind: 'settings', userId, weekGoal: Math.max(3, Math.min(50, Number(goal) || 10)) } }, { upsert: true });
  return true;
}

export async function getSettings(userId) {
  const col = await studyCollection();
  if (!col || !userId) return null;
  return col.findOne({ _id: `set_${userId}` });
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
  await col.updateOne({ _id: id }, { $set: { lastGrade: grade } });
  const due = grade === 'good'
    ? new Date(Date.now() + interval * 24 * 3600 * 1000).toISOString()
    : new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await col.updateOne({ _id: id }, { $set: { reviewInterval: interval, reviewDue: due, lastReviewed: new Date().toISOString() } });
  return { id, reviewInterval: interval, reviewDue: due };
}

export async function updateBookmarkNote(userId, id, note) {
  const col = await studyCollection();
  if (!col || !userId) return false;
  const r = await col.updateOne({ _id: id, userId, kind: 'bookmark' }, { $set: { note: String(note ?? '').slice(0, 500) } });
  return r.matchedCount === 1;
}

export async function removeBookmark(userId, id) {
  const col = await studyCollection();
  if (!col || !userId) return false;
  const r = await col.deleteOne({ _id: id, userId, kind: 'bookmark' });
  return r.deletedCount === 1;
}

// Progress: ONE record per (user, lesson) — the resume point plus scene completion.
export async function saveProgress({ userId, lessonId, lessonTitle = '', sceneIndex = 0, sceneCount = 0, tMs = 0, sceneDurationMs = 0, completedCount = 0, completed = false, watchedMs = 0 }) {
  if (!userId || !lessonId) return null;
  const col = await studyCollection();
  if (!col) return null;
  // Scene-completion DELTA feeds the day counter — the weekly ring counts real finishes.
  const prev = await col.findOne({ _id: `pr_${userId}_${lessonId}` });
  const delta = Math.max(0, (completedCount ?? 0) - (prev?.completedCount ?? 0));
  if (delta > 0) await bumpDay(userId, 'scenes', delta);
  // Focused minutes: the player reports real watched wall-time since its last sync (capped
  // per beat so a stuck tab cannot farm minutes).
  const secs = Math.min(30, Math.round((watchedMs ?? 0) / 1000));
  if (secs > 0) await bumpDay(userId, 'seconds', secs);
  const doc = {
    _id: `pr_${userId}_${lessonId}`, kind: 'progress', userId, lessonId, lessonTitle,
    sceneIndex, sceneCount, tMs, completedCount, completed,
    checkpointsPassed: prev?.checkpointsPassed ?? 0, checkpointsMissed: prev?.checkpointsMissed ?? 0,
    // LIVE percent (Coursera pattern): finished scenes count in full, and the scene being
    // watched contributes its REAL position (capped at 95% until earned) — the bar moves
    // from the first seconds of watching, never a dead 0 for an active learner.
    scenePercent: sceneDurationMs > 0 ? Math.min(95, Math.round((tMs / sceneDurationMs) * 100)) : 0,
    percent: completed ? 100 : sceneCount > 0
      ? Math.min(99, Math.round(((completedCount + (sceneDurationMs > 0 ? Math.min(0.95, tMs / sceneDurationMs) : 0)) / sceneCount) * 100))
      : 0,
    updatedAt: new Date().toISOString(),
  };
  await col.replaceOne({ _id: doc._id }, doc, { upsert: true });
  return doc;
}

// NOTEBOOK (Sankofa pattern): one editable page per lesson — the student's own words living
// beside the moments the player captured. One doc per user+lesson, upserted on every save.
export async function saveNotebook(userId, lessonId, text) {
  const col = await studyCollection();
  const id = `nb_${userId}_${lessonId}`;
  await col.updateOne(
    { _id: id },
    { $set: { kind: 'notebook', userId, lessonId, text: String(text ?? '').slice(0, 20000), updatedAt: new Date().toISOString() },
      $setOnInsert: { createdAt: new Date().toISOString() } },
    { upsert: true },
  );
  return { id };
}

export async function listNotebooks(userId) {
  const col = await studyCollection();
  return col.find({ kind: 'notebook', userId }).sort({ updatedAt: -1 }).limit(200).toArray();
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
  const scenes = Math.max(totalScenes, progress.reduce((a, p) => a + (p.completedCount ?? 0), 0));
  const reviews = Math.max(totalReviews, bookmarks.filter((b) => b.lastReviewed).length);
  // Every badge is a LIVE METER (current/target) — locked badges show distance, not a grey box.
  const defs = [
    ['🎬', 'First scene', scenes, 1],
    ['🏁', 'Lesson complete', done, 1],
    ['📚', '3 lessons', done, 3],
    ['🎓', '10 lessons', done, 10],
    ['🔥', '3-day streak', streak, 3],
    ['⚡', '7-day streak', streak, 7],
    ['🌟', '30-day streak', streak, 30],
    ['🔖', 'First bookmark', bookmarks.length, 1],
    ['🗂', '10 moments', bookmarks.length, 10],
    ['🧠', 'First review', reviews, 1],
    ['🏆', '25 reviews', reviews, 25],
  ];
  return defs.map(([icon, label, current, target]) => ({
    icon, label, current: Math.min(current, target), target, earned: current >= target,
  }));
}
