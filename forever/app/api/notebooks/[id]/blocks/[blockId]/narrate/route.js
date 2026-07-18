// POST /api/notebooks/[id]/blocks/[blockId]/narrate — Sankofa's TTS, notebook-sized: the
// block's text is spoken by the SAME Qwen3-TTS voice the lessons use, chunk-synthesized,
// concatenated gaplessly, saved under public/audio/notebooks, and attached to the block.
// Markdown/citations are stripped for the ear; the written note stays untouched.

import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

import { getNotebook, setBlockAudio } from '../../../../../../../lib/storage/notebook-store.js';
import { synthesizeLine } from '../../../../../../../lib/tts/providers/synthesize.js';
import { synthesizeWithTimestamps } from '../../../../../../../lib/tts/providers/elevenlabs.js';
import { concatAudioClips } from '../../../../../../../lib/tts/audio/concat-audio.js';

// Same provider selection as the lessons (voice-lesson.js): ElevenLabs when configured,
// Qwen3-TTS otherwise — the notebook speaks with the tutor's own voice.
const synth = (process.env.TTS_PROVIDER || '').trim().toLowerCase() === 'elevenlabs' ? synthesizeWithTimestamps : synthesizeLine;
import { sessionFromRequest } from '../../../../../../../lib/auth/session.js';

// Speech text: headings become sentences, bullets become sentences, [n] citations and the
// grounded-in footer vanish — nobody wants "bracket two" read aloud.
function speechText(markdown) {
  return String(markdown ?? '')
    .replace(/^— grounded in your blocks:.*$/m, '')
    .replace(/\[(\d+)\]/g, '')
    .replace(/^#{1,3} +(.+)$/gm, '$1.')
    .replace(/^- +/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{2,}/g, '\n')
    .trim()
    .slice(0, 4000);
}

// TTS calls take short passages — split on sentence ends near 350 chars.
function chunks(text) {
  const out = [];
  let cur = '';
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if ((cur + ' ' + sentence).length > 350 && cur) { out.push(cur.trim()); cur = sentence; }
    else cur = cur ? `${cur} ${sentence}` : sentence;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.slice(0, 16);
}

export async function POST(request, { params }) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const { id, blockId } = await params;
  const found = await getNotebook(session.userId, id);
  if (!found) return Response.json({ error: 'not found' }, { status: 404 });
  const block = found.blocks.find((b) => b._id === blockId);
  if (!block) return Response.json({ error: 'block not found' }, { status: 404 });
  if (block.audioUrl) return Response.json({ audioUrl: block.audioUrl, durationMs: block.audioDurationMs ?? 0 });

  const text = speechText(block.type === 'voice' ? (block.transcript || block.content) : block.content);
  if (text.length < 20) return Response.json({ error: 'not enough text to narrate' }, { status: 422 });

  try {
    const buffers = [];
    let totalMs = 0;
    for (const piece of chunks(text)) {
      const clip = await synth({ text: piece });
      buffers.push(clip.bytes);
      totalMs += clip.durationMs ?? 0;
    }
    const { bytes, extension } = concatAudioClips(buffers);
    const outDir = path.join('public', 'audio', 'notebooks');
    await mkdir(outDir, { recursive: true });
    const file = `${blockId}.${extension}`;
    await writeFile(path.join(outDir, file), bytes);
    const audioUrl = `/audio/notebooks/${file}`;
    await setBlockAudio(session.userId, id, blockId, audioUrl, totalMs);
    return Response.json({ audioUrl, durationMs: totalMs }, { status: 201 });
  } catch (e) {
    return Response.json({ error: `narration failed: ${String(e.message ?? e).slice(0, 180)}` }, { status: 502 });
  }
}
