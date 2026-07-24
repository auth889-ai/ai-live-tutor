// /api/lessons/[id]/scenes/[sceneId] — the human-in-the-loop edit: the owner rewrites a
// scene's narration/plain-text board content, and ONLY this scene is re-voiced (per-line
// TTS cache means only the EDITED lines cost a synthesis call). The new audio gets a
// versioned URL so the player never replays a stale cached track.

import { loadLesson, saveLesson } from '../../../../../../lib/storage/lesson-store.js';
import { applySceneEdits } from '../../../../../../lib/generation/edit/apply-scene-edits.js';
import { voiceScene, lessonAudioKey } from '../../../../../../lib/tts/voice-lesson.js';
import { sessionFromRequest } from '../../../../../../lib/auth/session.js';

export async function PATCH(request, { params }) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const { id, sceneId } = await params;

  const lesson = await loadLesson(id, { forUser: session.userId });
  if (!lesson) return Response.json({ error: 'not found' }, { status: 404 });
  // Editing is stricter than viewing: demo/ownerless lessons are shared — mutating one
  // would edit it for everyone. Only the actual owner may edit.
  if (!lesson.ownerId || lesson.ownerId !== session.userId) {
    return Response.json({ error: 'only the owner can edit a lesson' }, { status: 403 });
  }

  const index = (lesson.scenes ?? []).findIndex((scene) => scene.sceneId === sceneId);
  if (index < 0) return Response.json({ error: 'scene not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  let edited;
  try {
    edited = applySceneEdits(lesson.scenes[index], body);
  } catch (error) {
    return Response.json({ error: String(error.message) }, { status: 400 });
  }

  try {
    if (process.env.DISABLE_TTS !== '1' && edited.voiceLines?.length) {
      edited = await voiceScene(edited, { lessonKey: lessonAudioKey(lesson.sourcePackId) });
      if (edited.audioUrl) {
        // Same sceneId = same file path: without a version tag the browser's HTTP cache
        // (and the player's key={audioUrl} remount) would keep playing the OLD narration.
        edited = { ...edited, audioUrl: `${edited.audioUrl}?v=${Date.now()}` };
      }
    }
  } catch (error) {
    // Timeline reconciliation validates hard invariants (every line voiced, no overlap,
    // targets exist) — surface the reason instead of saving a half-broken scene.
    return Response.json({ error: `re-voicing failed: ${String(error.message).slice(0, 300)}` }, { status: 422 });
  }

  const scenes = [...lesson.scenes];
  scenes[index] = edited;
  const updated = { ...lesson, scenes, editedAt: new Date().toISOString() };
  // ownerId MUST be re-passed: saveLesson defaults it to null, which would silently strip
  // ownership and make the lesson public.
  await saveLesson(id, updated, { ownerId: lesson.ownerId });
  return Response.json({ ok: true, scene: edited });
}
