// Decode audio duration from raw bytes without a heavy dependency. Supports WAV (exact
// from header) and MP3 (sum of frame durations). Throws on formats we cannot measure —
// we never guess a duration, because the reconciler depends on it being real.

export function measureAudioDurationMs(bytes) {
  if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') {
    return measureWavMs(bytes);
  }
  if ((bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) || bytes.toString('ascii', 0, 3) === 'ID3') {
    return measureMp3Ms(bytes);
  }
  throw new Error('measureAudioDurationMs: unsupported audio format (expected WAV or MP3)');
}

function measureWavMs(bytes) {
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === 'fmt ') byteRate = bytes.readUInt32LE(offset + 16);
    else if (id === 'data') {
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!byteRate) throw new Error('WAV missing fmt/byteRate');
  return Math.round((dataSize / byteRate) * 1000);
}

const MP3_BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MP3_SAMPLE_RATES_V1 = [44100, 48000, 32000, 0];

function measureMp3Ms(bytes) {
  let offset = 0;
  if (bytes.toString('ascii', 0, 3) === 'ID3') {
    const tagSize = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    offset = 10 + tagSize;
  }
  let totalMs = 0;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) {
      offset += 1;
      continue;
    }
    const bitrate = MP3_BITRATES_V1_L3[(bytes[offset + 2] & 0xf0) >> 4] * 1000;
    const sampleRate = MP3_SAMPLE_RATES_V1[(bytes[offset + 2] & 0x0c) >> 2];
    if (!bitrate || !sampleRate) {
      offset += 1;
      continue;
    }
    const padding = (bytes[offset + 2] & 0x02) >> 1;
    const frameLen = Math.floor((144 * bitrate) / sampleRate) + padding;
    if (frameLen <= 0) break;
    totalMs += (1152 / sampleRate) * 1000; // samples per MPEG1 Layer3 frame
    offset += frameLen;
  }
  if (!totalMs) throw new Error('MP3 contained no decodable frames');
  return Math.round(totalMs);
}
