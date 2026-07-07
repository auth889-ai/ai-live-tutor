import assert from 'node:assert/strict';
import test from 'node:test';

import { concatAudioClips } from '../../lib/tts/audio/concat-audio.js';
import { measureAudioDurationMs } from '../../lib/tts/audio/measure-duration.js';

// Build a real minimal WAV: PCM mono, byteRate bytes/sec, given data payload.
function makeWav({ byteRate = 1000, dataBytes = 500, sampleRate = 1000 } = {}) {
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0); // PCM
  fmt.writeUInt16LE(1, 2); // mono
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(byteRate, 8);
  fmt.writeUInt16LE(1, 12); // block align
  fmt.writeUInt16LE(8, 14); // bits per sample
  const data = Buffer.alloc(dataBytes, 7);

  const wav = Buffer.alloc(12 + 8 + fmt.length + 8 + data.length);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(fmt.length, 16);
  fmt.copy(wav, 20);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(data.length, 40);
  data.copy(wav, 44);
  return wav;
}

test('WAV clips merge into ONE valid WAV whose duration is the sum of the clips', () => {
  const a = makeWav({ dataBytes: 500 }); // 500ms at 1000 B/s
  const b = makeWav({ dataBytes: 250 }); // 250ms
  const { bytes, extension } = concatAudioClips([a, b]);
  assert.equal(extension, 'wav');
  // The merged track must measure as one continuous file — this is exactly what naive
  // Buffer.concat breaks (it would still measure/play only the first 500ms).
  assert.equal(measureAudioDurationMs(bytes), 750);
});

test('naive concat of WAVs would truncate — proving why the merge exists', () => {
  const naive = Buffer.concat([makeWav({ dataBytes: 500 }), makeWav({ dataBytes: 250 })]);
  assert.equal(measureAudioDurationMs(naive), 500); // second clip is invisible
});

test('MP3 clips pass through as byte concat', () => {
  const frame = Buffer.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3]);
  const { bytes, extension } = concatAudioClips([frame, frame]);
  assert.equal(extension, 'mp3');
  assert.equal(bytes.length, frame.length * 2);
});

test('mixed or unknown formats are refused loudly', () => {
  assert.throws(() => concatAudioClips([makeWav(), Buffer.from([0xff, 0xfb, 0x90, 0x00])]), /mixed or unsupported/);
  assert.throws(() => concatAudioClips([Buffer.from('not audio at all, definitely')]), /mixed or unsupported/);
  assert.throws(() => concatAudioClips([]), /no clips/);
});

test('WAV clips with different formats are refused (cannot merge losslessly)', () => {
  assert.throws(
    () => concatAudioClips([makeWav({ byteRate: 1000 }), makeWav({ byteRate: 2000 })]),
    /different formats/,
  );
});
