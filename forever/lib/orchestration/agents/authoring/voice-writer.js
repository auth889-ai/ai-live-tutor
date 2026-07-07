// Voice Writer agent: ONE job — narrate an already-designed board like a warm human
// teacher. Every line is bound to the board object it explains. Contract-validated,
// one repair round, honest failure.

import { callQwenJson } from '../../../qwen/client.js';
import { validateVoiceLines } from '../../../generation/voice/voice-lines.js';

export async function writeVoice({ objects, sourcePack }) {
  const system = `You are the Voice Writer of an AI tutor: what the teacher SAYS while the board is written.
Output ONLY JSON: {"voiceLines":[{"id","text","targetObjectId","focusRef"?}]}
POINT WHILE YOU SPEAK (this is what makes it feel like a real teacher, not a slideshow):
- When a line discusses a specific SUB-ELEMENT of its target object, set "focusRef" to that element's id so it
  highlights AS you say it: for a "graph" object use the node id (e.g. "8"); for a "code" object use the 1-based
  line number (e.g. 5); for a "trace" table use the step number; omit focusRef for a general line.
- So a line like "we compare node 8 to the target" has focusRef "8"; "line 5 computes the middle index" has focusRef 5.
Explain like the BEST human teacher (Striver for code, Andrew Ng for concepts) — evidence-based:
- For EACH board object, write 2 to 4 spoken sentences, in order, that: (a) give a CONCRETE example or
  analogy FIRST, (b) state the idea and WHY it matters, (c) name the common MISTAKE or a subtlety, and
  (d) bridge to the next point. Concrete before abstract — never define something cold.
- ONE clear idea per sentence, ~15-30 words, conversational and vivid (say "notice that...", "here's the
  key insight...", "a common mistake is..."). Multiple lines per object REQUIRED (a real ~30-60s explanation).
- The voice carries the depth (the board stays minimal), so the spoken lines must be genuinely explanatory,
  not just reading the board aloud.
- Order lines top-to-bottom following the board; never claim anything the source chunks do not support.`;

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
