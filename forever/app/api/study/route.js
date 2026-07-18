// /api/study — bookmarks + progress, session-scoped like every data route.
import { sessionFromRequest } from '../../../lib/auth/session.js';
import { addBookmark, listBookmarks, listLessonBookmarks, removeBookmark, reviewBookmark, saveProgress, getProgress, listProgress, listDays, computeBadges, recordCheckpoint, saveReflection, setWeekGoal, getSettings, saveNotebook, listNotebooks } from '../../../lib/storage/study-store.js';
import { loadLesson } from '../../../lib/storage/lesson-store.js';

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
  const heatmap = dayDocs.map((d) => ({ date: d.date, scenes: d.scenes ?? 0, reviews: d.reviews ?? 0, bookmarks: d.bookmarks ?? 0, checkpoints: d.checkpoints ?? 0, notebook: d.notebook ?? 0 }));
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
  const dateSet = new Set(heatmap.filter((d) => d.scenes + d.reviews + d.bookmarks + d.checkpoints + d.notebook > 0).map((d) => d.date));
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
  // TODAY (learning actions, not just activity): scenes + checkpoints + reviews + minutes.
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayDoc = dayDocs.find((d) => d.date === todayKey) ?? {};
  const today = {
    scenes: todayDoc.scenes ?? 0, checkpoints: todayDoc.checkpoints ?? 0,
    reviews: todayDoc.reviews ?? 0, minutes: Math.round((todayDoc.seconds ?? 0) / 60),
    reflection: todayDoc.reflection ?? null,
  };

  // RECOMMENDED NEXT (deterministic, reason visible): most recently active incomplete lesson;
  // remaining minutes are REAL — summed from the lesson's own scene durations, never invented.
  const nextUp = progress.find((p) => !p.completed) ?? null;
  let recommended = null;
  if (nextUp) {
    let minutes = null;
    let nextSceneTitle = null;
    try {
      const lesson = await loadLesson(nextUp.lessonId, {});
      const remaining = (lesson?.scenes ?? []).slice(nextUp.sceneIndex);
      const ms = remaining.reduce((a, sc) => a + (sc.durationMs ?? 0), 0);
      if (ms > 0) minutes = Math.max(1, Math.round(ms / 60000));
      nextSceneTitle = lesson?.scenes?.[nextUp.sceneIndex]?.title ?? null;
    } catch { /* estimate stays honest-null */ }
    recommended = {
      lessonId: nextUp.lessonId, lessonTitle: nextUp.lessonTitle, sceneIndex: nextUp.sceneIndex,
      tMs: nextUp.tMs, nextSceneTitle, minutes,
      reason: `most recently active · ${nextUp.sceneCount - (nextUp.completedCount ?? 0)} scenes left${(nextUp.checkpointsPassed ?? 0) === 0 ? ' · no checkpoint verified yet' : ''}`,
    };
  }

  // KNOWLEDGE STATUS per lesson (evidence-based labels, never invented percentages):
  // New -> Learning (scenes done) -> Developing (>=1 checkpoint passed) -> Strong
  // (checkpoints + >=2 good reviews) · 'Review due' overrides when its moments are due.
  const dueByLesson = new Set(bookmarks.filter((b) => b.reviewDue && new Date(b.reviewDue).getTime() <= now).map((b) => b.lessonId));
  const knowledge = progress.map((p) => {
    const goodReviews = bookmarks.filter((b) => b.lessonId === p.lessonId && b.lastGrade === 'good').length;
    let status = 'New';
    if ((p.completedCount ?? 0) > 0) status = 'Learning';
    if ((p.checkpointsPassed ?? 0) >= 1) status = 'Developing';
    if ((p.checkpointsPassed ?? 0) >= 2 && goodReviews >= 2) status = 'Strong';
    if (dueByLesson.has(p.lessonId)) status = 'Review due';
    // The COMPUTED next rung of the evidence ladder — never a canned placeholder.
    const next = status === 'Review due' ? 'clear the due review'
      : status === 'New' ? ((p.scenePercent ?? 0) > 0 ? `finish scene ${p.sceneIndex + 1} (${p.scenePercent}% watched)` : 'watch scene 1')
      : status === 'Learning' ? 'pass a checkpoint quiz'
      : status === 'Developing' ? `${Math.max(0, 2 - goodReviews)} good review${2 - goodReviews === 1 ? '' : 's'} to Strong`
      : 'keep reviews on schedule';
    return {
      lessonId: p.lessonId, lessonTitle: p.lessonTitle, status, next,
      evidence: { scenes: p.completedCount ?? 0, sceneCount: p.sceneCount ?? 0, scenePercent: p.scenePercent ?? 0, checkpoints: p.checkpointsPassed ?? 0, goodReviews, lastActive: p.updatedAt },
    };
  });

  // WEEKLY: verified learning actions (scenes + checkpoints + reviews) vs an editable goal.
  const settings = await getSettings(session.userId);
  const weekGoal = settings?.weekGoal ?? 10;
  const weekDays = heatmap.filter((d) => d.date >= weekKey);
  const weekActions = {
    scenes: weekDays.reduce((a, d) => a + d.scenes, 0),
    checkpoints: dayDocs.filter((d) => d.date >= weekKey).reduce((a, d) => a + (d.checkpoints ?? 0), 0),
    reviews: weekDays.reduce((a, d) => a + d.reviews, 0),
  };
  const weekTotal = weekActions.scenes + weekActions.checkpoints + weekActions.reviews;
  const daysLeft = 7 - ((new Date().getDay() + 6) % 7);
  const pace = weekTotal >= weekGoal ? 'goal hit' : `${weekGoal - weekTotal} to go · ~${Math.ceil((weekGoal - weekTotal) / Math.max(1, daysLeft))} per day keeps you on track`;

  // Upcoming reviews + weak concepts (graded Again recently = needs reinforcement).
  const upcoming = bookmarks
    .filter((b) => b.reviewDue && new Date(b.reviewDue).getTime() > now)
    .sort((a, b) => new Date(a.reviewDue) - new Date(b.reviewDue)).slice(0, 3)
    .map((b) => ({ id: b._id, label: b.note || b.sceneTitle || b.lessonTitle, due: b.reviewDue, lessonId: b.lessonId, sceneId: b.sceneId, tMs: b.tMs }));
  const weak = bookmarks.filter((b) => b.lastGrade === 'again').slice(0, 3)
    .map((b) => ({ id: b._id, label: b.note || b.sceneTitle || b.lessonTitle, lessonId: b.lessonId, sceneId: b.sceneId, tMs: b.tMs }));

  const tomorrow = {
    review: (forecast.tomorrow > 0 && upcoming[0]) ? upcoming[0].label : null,
    continueTitle: recommended?.lessonTitle ?? null,
  };

  return Response.json({
    signedIn: true, bookmarks, progress, streak, notebooks: await listNotebooks(session.userId), bestStreak, dueCount, heatmap, weekScenes, weekGoal, badges, forecast,
    today, recommended, knowledge, weekActions, weekTotal, pace, upcoming, weak, tomorrow,
    stats: { totalScenes, totalReviews, totalBookmarks: bookmarks.length, lessonsDone: progress.filter((p) => p.completed).length,
      totalCheckpoints: dayDocs.reduce((a, d) => a + (d.checkpoints ?? 0), 0) },
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
  if (body.type === 'checkpoint') {
    return Response.json({ ok: await recordCheckpoint({ userId: session.userId, lessonId: body.lessonId, quizId: body.quizId, correct: body.correct }) });
  }
  if (body.type === 'notebook') {
    await saveNotebook(session.userId, String(body.lessonId ?? ''), body.text);
    return Response.json({ ok: true });
  }
  if (body.type === 'reflection') {
    return Response.json({ ok: await saveReflection({ userId: session.userId, choice: body.choice }) });
  }
  if (body.type === 'goal') {
    return Response.json({ ok: await setWeekGoal(session.userId, body.weekGoal) });
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
