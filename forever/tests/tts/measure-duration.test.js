import assert from 'node:assert/strict';
import test from 'node:test';

import { measureAudioDurationMs } from '../../lib/tts/audio/measure-duration.js';

// Build a minimal 1-second 16-bit mono 8kHz WAV: byteRate = 8000*2 = 16000, data = 16000 bytes.
function oneSecondWav() {
  const dataSize = 16000;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(8000, 24); // sample rate
  buf.writeUInt32LE(16000, 28); // byte rate
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

test('WAV duration is decoded exactly from the header', () => {
  assert.equal(measureAudioDurationMs(oneSecondWav()), 1000);
});

test('unsupported formats fail loudly rather than guessing', () => {
  assert.throws(() => measureAudioDurationMs(Buffer.from('not audio at all')), /unsupported audio format/);
});
