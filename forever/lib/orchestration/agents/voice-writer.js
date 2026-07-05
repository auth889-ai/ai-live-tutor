// Voice Writer agent: ONE job — narrate an already-designed board like a warm human
// teacher. Every line is bound to the board object it explains. Contract-validated,
// one repair round, honest failure.

import { callQwenJson } from '../../qwen/client.js';
import { validateVoiceLines } from '../../generation/voice/voice-lines.js';

export async function writeVoice({ objects, sourcePack }) {
  const system = `You are the Voice Writer of an AI tutor: you write what the teacher SAYS while the
board is written. Output ONLY JSON: {"voiceLines":[{"id","text","targetObjectId"}]}
Rules:
- Exactly one voice line per board object, in board order, each 15-40 words.
- targetObjectId must be the id of the object the line explains.
- Speak like a great YouTube teacher: conversational, step-by-step, concrete, no fluff,
  and never claim anything the source chunks do not support.`;

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
