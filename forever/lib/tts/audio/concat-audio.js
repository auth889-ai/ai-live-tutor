// Concatenate per-line TTS clips into ONE gapless scene track (pure). MP3 frames can be
// joined byte-wise, but every WAV file carries its own header — naive concat produces a
// track that PLAYS only the first clip while the reconciled timeline expects the full
// length, silently desyncing the whole board. So: detect the format, rebuild a single WAV
// around the merged data chunks (formats must match), pass MP3 through. Anything else
// throws — a broken audio track must fail the job loudly, never ship.

export function concatAudioClips(buffers) {
  if (!Array.isArray(buffers) || buffers.length === 0) throw new Error('concatAudioClips: no clips to concatenate');
  const kinds = buffers.map(formatOf);
  if (kinds.every((k) => k === 'mp3')) return { bytes: Buffer.concat(buffers), extension: 'mp3' };
  if (kinds.every((k) => k === 'wav')) return { bytes: concatWav(buffers), extension: 'wav' };
  throw new Error(`concatAudioClips: mixed or unsupported clip formats (${[...new Set(kinds)].join(', ')})`);
}

function formatOf(bytes) {
  if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  if ((bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) || bytes.toString('ascii', 0, 3) === 'ID3') return 'mp3';
  return 'unknown';
}

function parseWav(bytes) {
  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === 'fmt ') fmt = bytes.subarray(offset + 8, offset + 8 + size);
    else if (id === 'data') data = bytes.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('concatAudioClips: WAV clip missing fmt/data chunk');
  return { fmt, data };
}

function concatWav(buffers) {
  const parts = buffers.map(parseWav);
  const first = parts[0].fmt;
  for (const part of parts) {
    if (!part.fmt.equals(first)) throw new Error('concatAudioClips: WAV clips have different formats — cannot merge losslessly');
  }
  const data = Buffer.concat(parts.map((p) => p.data));

  const header = Buffer.alloc(12 + 8 + first.length + 8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(4 + 8 + first.length + 8 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(first.length, 16);
  first.copy(header, 20);
  header.write('data', 20 + first.length, 'ascii');
  header.writeUInt32LE(data.length, 24 + first.length);
  return Buffer.concat([header, data]);
}
