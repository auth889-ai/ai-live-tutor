// /api/study — bookmarks + progress, session-scoped like every data route.
import { sessionFromRequest } from '../../../lib/auth/session.js';
import { addBookmark, listBookmarks, removeBookmark, reviewBookmark, saveProgress, getProgress, listProgress } from '../../../lib/storage/study-store.js';

export async function GET(request) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ signedIn: false, bookmarks: [], progress: [] });
  const url = new URL(request.url);
  const lessonId = url.searchParams.get('lessonId');
  if (lessonId) return Response.json({ progress: await getProgress(session.userId, lessonId) });
  const [bookmarks, progress] = await Promise.all([listBookmarks(session.userId), listProgress(session.userId)]);
  return Response.json({ signedIn: true, bookmarks, progress });
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
