// Voice Writer agent: ONE job — narrate an already-designed board like a warm human
// teacher. Every line is bound to the board object it explains. Contract-validated,
// one repair round, honest failure.

import { callQwenJson } from '../../qwen/client.js';
import { validateVoiceLines } from '../../generation/voice/voice-lines.js';

export async function writeVoice({ objects, sourcePack }) {
  const system = `You are the Voice Writer of an AI tutor: you write what the teacher SAYS while the
board is written. Output ONLY JSON: {"voiceLines":[{"id","text","targetObjectId"}]}
Teach DEEPLY like a great instructor (Striver / 3Blue1Brown), not a caption writer:
- For EACH board object, write 2 to 4 separate narration lines (sentences), in order —
  the idea, WHY it matters, a concrete example or intuition, and a bridge to the next point.
- Each line is one spoken sentence, ~15-30 words. Multiple lines per object is REQUIRED
  so the explanation is rich and takes real time, like a 30-60 second explanation.
- Order all lines top-to-bottom following the board; targetObjectId ties each line to its object.
- Conversational and vivid, but never claim anything the source chunks do not support.`;

  const user = JSON.stringify({
    task: 'Narrate this board for the student.',
    board: objects.map((object) => ({ id: object.id, objectType: object.objectType, content: object.content })),
    sourceChunks: sourcePack.chunks.map((chunk) => chunk.text),
  });

  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const repair = attempt === 0 ? '' : `\nYour previous output was rejected: ${lastError}. Fix exactly that and output the full JSON again.`;
    const { json, usage } = await callQwenJson({ agent: 'voice_writer', system: system + repair, user, temperature: 0.6 });
    try {
      validateVoiceLines(json.voiceLines, objects);
      return { voiceLines: json.voiceLines, usage };
    } catch (error) {
      lastError = error.message;
    }
  }
  throw new Error(`Voice Writer failed contract validation after repair: ${lastError}`);
}
