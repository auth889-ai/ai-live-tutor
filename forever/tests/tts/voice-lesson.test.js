import assert from 'node:assert/strict';
import test from 'node:test';
import { rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { voiceLesson, pickSynth } from '../../lib/tts/voice-lesson.js';
import { synthesizeLine } from '../../lib/tts/providers/synthesize.js';
import { synthesizeWithTimestamps } from '../../lib/tts/providers/elevenlabs.js';
import { measureAudioDurationMs } from '../../lib/tts/audio/measure-duration.js';

// One decodable MP3 frame (MPEG1 Layer3, 128kbps/44100Hz) ≈ 26ms — real enough to measure.
function mp3Clip(frames = 10) {
  const header = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
  const frame = Buffer.concat([header, Buffer.alloc(Math.floor((144 * 128000) / 44100) - 4)]);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

const lesson = {
  sourcePackId: 'sp_voicetest01',
  lessonTitle: 'T',
  scenes: [
    {
      sceneId: 'sc_01',
      objects: [{ id: 'obj_1', renderHint: 'text' }],
      voiceLines: [
        { id: 'vl_1', text: 'hello', targetObjectId: 'obj_1' },
        { id: 'vl_2', text: 'world', targetObjectId: 'obj_1' },
      ],
      timeline: { actions: [] },
    },
    { sceneId: 'sc_02', objects: [], voiceLines: [], timeline: { actions: [] } }, // silent scene
  ],
};

test('voiceLesson synthesizes lines, writes ONE track per scene, reconciles the timeline', async () => {
  const dir = path.join(tmpdir(), `forever-voice-${process.pid}`);
  const clip = mp3Clip();
  const clipMs = measureAudioDurationMs(clip);
  const spoken = [];
  const progress = [];

  const voiced = await voiceLesson(lesson, {
    publicDir: dir,
    synth: async ({ text }) => {
      spoken.push(text);
      return { bytes: clip, durationMs: clipMs };
    },
    onProgress: (p) => progress.push(p),
  });

  assert.deepEqual(spoken, ['hello', 'world']);
  assert.equal(voiced.voiced, true);
  const [voicedScene, silentScene] = voiced.scenes;
  assert.match(voicedScene.audioUrl, /\/audio\/spvoicetest01\/sc_01\.mp3$/);
  assert.equal(voicedScene.durationMs, clipMs * 2); // reconciled to the REAL audio length
  assert.equal(voicedScene.timeline.timingSource, 'reconciled');
  assert.equal(silentScene.audioUrl, undefined); // nothing to say -> manual clock, no fake audio
  assert.deepEqual(progress, [
    { sceneDone: 1, sceneTotal: 2 },
    { sceneDone: 2, sceneTotal: 2 },
  ]);

  const written = await readFile(path.join(dir, 'audio', 'spvoicetest01', 'sc_01.mp3'));
  assert.equal(measureAudioDurationMs(written), clipMs * 2);
  await rm(dir, { recursive: true, force: true });
});

test('a flaky TTS line is retried; a dead one fails the lesson loudly', async () => {
  const dir = path.join(tmpdir(), `forever-voice-retry-${process.pid}`);
  let calls = 0;
  const flaky = async ({ text }) => {
    calls += 1;
    if (calls === 1) throw new Error('socket hiccup');
    const clip = mp3Clip();
    return { bytes: clip, durationMs: measureAudioDurationMs(clip) };
  };
  const voiced = await voiceLesson(lesson, { publicDir: dir, synth: flaky });
  assert.equal(voiced.voiced, true);
  assert.equal(calls, 3); // line 1 failed once then succeeded; line 2 first try

  await assert.rejects(
    voiceLesson(lesson, { publicDir: dir, attempts: 2, synth: async () => { throw new Error('quota'); } }),
    /TTS failed after 2 attempts: quota/,
  );
  await rm(dir, { recursive: true, force: true });
});

test('pickSynth defaults to Qwen Cloud TTS; ElevenLabs only by explicit env', () => {
  assert.equal(pickSynth({}), synthesizeLine);
  assert.equal(pickSynth({ TTS_PROVIDER: 'elevenlabs' }), synthesizeWithTimestamps);
  assert.equal(pickSynth({ TTS_PROVIDER: 'Qwen' }), synthesizeLine);
});
