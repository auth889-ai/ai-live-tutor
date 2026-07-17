// /api/study — bookmarks + progress, session-scoped like every data route.
import { sessionFromRequest } from '../../../lib/auth/session.js';
import { addBookmark, listBookmarks, listLessonBookmarks, removeBookmark, reviewBookmark, saveProgress, getProgress, listProgress, listDays, computeBadges } from '../../../lib/storage/study-store.js';

export async function GET(request) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ signedIn: false, bookmarks: [], progress: [] });
  const url = new URL(request.url);
  const lessonId = url.searchParams.get('lessonId');
  if (lessonId) {
    const [progress, marks] = await Promise.all([getProgress(session.userId, lessonId), listLessonBookmarks(session.userId, lessonId)]);
    return Response.json({ progress, marks: marks.map((b) => ({ id: b._id, sceneId: b.sceneId, tMs: b.tMs, note: b.note })) });
  }
  const [bookmarks, progress] = await Promise.all([listBookmarks(session.userId), listProgress(session.userId)]);
  // STREAK (Duolingo pattern, deterministic): consecutive days with any learning activity —
  // progress updates, bookmark saves, or reviews all count as showing up.
  const days = new Set([
    ...progress.map((x) => x.updatedAt), ...bookmarks.map((x) => x.createdAt), ...bookmarks.map((x) => x.lastReviewed),
  ].filter(Boolean).map((iso) => String(iso).slice(0, 10)));
  let streak = 0;
  for (let d = new Date(); ; d.setDate(d.getDate() - 1)) {
    const key = d.toISOString().slice(0, 10);
    if (days.has(key)) streak += 1;
    else if (streak === 0 && key === new Date().toISOString().slice(0, 10)) continue; // today not yet active doesn't break yesterday's streak
    else break;
  }
  const dueCount = bookmarks.filter((b) => b.reviewDue && new Date(b.reviewDue).getTime() <= Date.now()).length;
  const dayDocs = await listDays(session.userId);
  const heatmap = dayDocs.map((d) => ({ date: d.date, scenes: d.scenes ?? 0, reviews: d.reviews ?? 0, bookmarks: d.bookmarks ?? 0 }));
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // Monday
  const weekKey = weekStart.toISOString().slice(0, 10);
  const weekScenes = heatmap.filter((d) => d.date >= weekKey).reduce((a, d) => a + d.scenes, 0);
  // True all-time earned total: the sum of per-lesson completed scenes (day counters only
  // exist since the feature shipped; the progress records carry the full history).
  const totalScenes = Math.max(
    heatmap.reduce((a, d) => a + d.scenes, 0),
    progress.reduce((a, p) => a + (p.completedCount ?? 0), 0),
  );
  const totalReviews = heatmap.reduce((a, d) => a + d.reviews, 0);
  const badges = computeBadges({ progress, bookmarks, streak, totalScenes, totalReviews });
  // Best streak ever (from day docs) + Anki-style due forecast.
  const dateSet = new Set(heatmap.filter((d) => d.scenes + d.reviews + d.bookmarks > 0).map((d) => d.date));
  let bestStreak = streak;
  let run = 0;
  for (let i = 120; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
    run = dateSet.has(d) ? run + 1 : 0;
    if (run > bestStreak) bestStreak = run;
  }
  const now = Date.now();
  const in24 = now + 24 * 3600 * 1000;
  const in7d = now + 7 * 24 * 3600 * 1000;
  const dues = bookmarks.map((b) => b.reviewDue && new Date(b.reviewDue).getTime()).filter(Boolean);
  const forecast = {
    today: dues.filter((t) => t <= now).length,
    tomorrow: dues.filter((t) => t > now && t <= in24).length,
    week: dues.filter((t) => t > in24 && t <= in7d).length,
  };
  return Response.json({
    signedIn: true, bookmarks, progress, streak, bestStreak, dueCount, heatmap, weekScenes, weekGoal: 10, badges, forecast,
    stats: { totalScenes, totalReviews, totalBookmarks: bookmarks.length, lessonsDone: progress.filter((p) => p.completed).length },
  });
}

export async function POST(request) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (body.type === 'bookmark') {
    const doc = await addBookmark({ ...body, userId: session.userId });
    return Response.json({ bookmark: doc });
  }
  if (body.type === 'note') {
    const { updateBookmarkNote } = await import('../../../lib/storage/study-store.js');
    return Response.json({ updated: await updateBookmarkNote(session.userId, body.id, body.note) });
  }
  if (body.type === 'review') {
    return Response.json({ review: await reviewBookmark(session.userId, body.id, body.grade === 'good' ? 'good' : 'again') });
  }
  if (body.type === 'progress') {
    const doc = await saveProgress({ ...body, userId: session.userId });
    return Response.json({ progress: doc });
  }
  return Response.json({ error: 'type must be bookmark|progress' }, { status: 400 });
}

export async function DELETE(request) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const url = new URL(request.url);
  const removed = await removeBookmark(session.userId, url.searchParams.get('id'));
  return Response.json({ removed });
}
