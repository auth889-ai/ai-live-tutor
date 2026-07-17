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
  const totalScenes = heatmap.reduce((a, d) => a + d.scenes, 0);
  const totalReviews = heatmap.reduce((a, d) => a + d.reviews, 0);
  const badges = computeBadges({ progress, bookmarks, streak, totalScenes, totalReviews });
  return Response.json({ signedIn: true, bookmarks, progress, streak, dueCount, heatmap, weekScenes, weekGoal: 10, badges });
}

export async function POST(request) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (body.type === 'bookmark') {
    const doc = await addBookmark({ ...body, userId: session.userId });
    return Response.json({ bookmark: doc });
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
