// Voice a generated lesson: synthesize every scene's narration, concatenate each scene's
// clips into one gapless track, save it under public/, and reconcile the scene timeline to
// the REAL audio so the handwriting lands on the spoken words. Qwen Cloud TTS is the
// production default (the whole stack stays on DashScope — a hackathon requirement);
// ElevenLabs stays available behind TTS_PROVIDER=elevenlabs. Per-line retry with backoff,
// honest failure when a line cannot be voiced. Production stores audio in OSS; here it
// writes to public/audio for the player.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { synthesizeLine } from './providers/synthesize.js';
import { synthesizeWithTimestamps } from './providers/elevenlabs.js';
import { concatAudioClips } from './audio/concat-audio.js';
import { reconcileTimeline } from '../playback/reconcile/reconcile-timeline.js';

export function pickSynth(env = process.env) {
  return (env.TTS_PROVIDER || '').trim().toLowerCase() === 'elevenlabs' ? synthesizeWithTimestamps : synthesizeLine;
}

async function synthesizeWithRetry(synth, text, { attempts = 3 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await synth({ text });
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw new Error(`TTS failed after ${attempts} attempts: ${lastError?.message}`);
}

export async function voiceLesson(
  lesson,
  { publicDir = 'public', urlBase = '/audio', synth, attempts = 3, onProgress = () => {} } = {},
) {
  const doSynth = synth ?? pickSynth();
  const lessonId = lesson.sourcePackId.replace(/[^a-z0-9]/gi, '').slice(0, 16);
  const outDir = path.join(publicDir, 'audio', lessonId);

  const sceneTotal = lesson.scenes.length;
  const scenes = [];
  let done = 0;
  for (const scene of lesson.scenes) {
    // A scene with nothing to say keeps its manual clock — we never invent audio.
    if (!scene.voiceLines?.length) {
      scenes.push(scene);
      done += 1;
      onProgress({ sceneDone: done, sceneTotal });
      continue;
    }

    const buffers = [];
    const clips = [];
    for (const line of scene.voiceLines) {
      const clip = await synthesizeWithRetry(doSynth, line.text, { attempts });
      buffers.push(clip.bytes);
      clips.push({ voiceLineId: line.id, durationMs: clip.durationMs });
    }

    const { bytes, extension } = concatAudioClips(buffers);
    const audioUrl = `${urlBase}/${lessonId}/${scene.sceneId}.${extension}`;
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, `${scene.sceneId}.${extension}`), bytes);

    const { timeline, durationMs } = reconcileTimeline({
      sceneId: scene.sceneId,
      objects: scene.objects,
      voiceLines: scene.voiceLines,
      clips,
      audioUrl,
    });
    scenes.push({ ...scene, timeline, durationMs, audioUrl });
    done += 1;
    onProgress({ sceneDone: done, sceneTotal });
  }

  return { ...lesson, voiced: scenes.some((s) => Boolean(s.audioUrl)), scenes };
}
