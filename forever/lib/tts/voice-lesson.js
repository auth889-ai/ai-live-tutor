// Voice a generated lesson: synthesize every scene's narration (ElevenLabs), concatenate
// each scene's clips into one gapless audio track, save it under public/, and reconcile
// the scene timeline to the REAL audio so the handwriting lands on the spoken words.
// Production stores audio in OSS; here it writes to public/audio for the dev player.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { synthesizeWithTimestamps } from './elevenlabs.js';
import { reconcileTimeline } from '../playback/reconcile/reconcile-timeline.js';

export async function voiceLesson(lesson, { publicDir = 'public', urlBase = '/audio', synth = synthesizeWithTimestamps } = {}) {
  const lessonId = lesson.sourcePackId.replace(/[^a-z0-9]/gi, '').slice(0, 16);
  const outDir = path.join(publicDir, 'audio', lessonId);
  await mkdir(outDir, { recursive: true });

  const scenes = [];
  for (const scene of lesson.scenes) {
    const buffers = [];
    const clips = [];
    for (const line of scene.voiceLines) {
      const clip = await synth({ text: line.text });
      buffers.push(clip.bytes);
      clips.push({ voiceLineId: line.id, durationMs: clip.durationMs });
    }
    const audioUrl = `${urlBase}/${lessonId}/${scene.sceneId}.mp3`;
    await writeFile(path.join(outDir, `${scene.sceneId}.mp3`), Buffer.concat(buffers));

    const { timeline, durationMs } = reconcileTimeline({
      sceneId: scene.sceneId,
      objects: scene.objects,
      voiceLines: scene.voiceLines,
      clips,
      audioUrl,
    });
    scenes.push({ ...scene, timeline, durationMs, audioUrl });
  }

  return { ...lesson, voiced: true, scenes };
}
