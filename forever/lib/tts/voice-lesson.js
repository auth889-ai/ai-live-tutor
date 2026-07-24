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

async function synthesizeWithRetry(synth, text, { attempts = 3, previousText, nextText } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      // previousText/nextText: neighbor narration for prosody continuity (ElevenLabs uses
      // them; the Qwen provider destructures {text} and safely ignores the extras).
      return await synth({ text, previousText, nextText });
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw new Error(`TTS failed after ${attempts} attempts: ${lastError?.message}`);
}

export function lessonAudioKey(sourcePackId) {
  return String(sourcePackId).replace(/[^a-z0-9]/gi, '').slice(0, 16);
}

// Voice ONE scene (the progressive-playback unit): synthesize its lines, write the scene
// track, reconcile the timeline to the real audio. A scene with nothing to say — or one
// already voiced (idempotency) — passes through untouched.
export async function voiceScene(
  scene,
  { lessonKey, publicDir = 'public', urlBase = '/audio', synth, attempts = 3 } = {},
) {
  if (!scene.voiceLines?.length || scene.audioUrl) return scene;
  const doSynth = synth ?? pickSynth();
  const outDir = path.join(publicDir, 'audio', lessonKey);

  const buffers = [];
  const clips = [];
  for (let i = 0; i < scene.voiceLines.length; i += 1) {
    const line = scene.voiceLines[i];
    const clip = await synthesizeWithRetry(doSynth, line.text, {
      attempts,
      previousText: scene.voiceLines[i - 1]?.text,
      nextText: scene.voiceLines[i + 1]?.text,
    });
    buffers.push(clip.bytes);
    clips.push({ voiceLineId: line.id, durationMs: clip.durationMs, wordTimings: clip.wordTimings ?? null });
  }

  const { bytes, extension } = concatAudioClips(buffers);
  const audioUrl = `${urlBase}/${lessonKey}/${scene.sceneId}.${extension}`;
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, `${scene.sceneId}.${extension}`), bytes);

  const { timeline, durationMs, voiceLines } = reconcileTimeline({
    sceneId: scene.sceneId,
    objects: scene.objects,
    voiceLines: scene.voiceLines,
    clips,
    audioUrl,
  });
  return { ...scene, voiceLines, timeline, durationMs, audioUrl };
}

export async function voiceLesson(
  lesson,
  { publicDir = 'public', urlBase = '/audio', synth, attempts = 3, onProgress = () => {} } = {},
) {
  const lessonKey = lessonAudioKey(lesson.sourcePackId);
  const sceneTotal = lesson.scenes.length;
  const scenes = [];
  let done = 0;
  for (const scene of lesson.scenes) {
    scenes.push(await voiceScene(scene, { lessonKey, publicDir, urlBase, synth, attempts }));
    done += 1;
    onProgress({ sceneDone: done, sceneTotal });
  }

  return { ...lesson, voiced: scenes.some((s) => Boolean(s.audioUrl)), scenes };
}
