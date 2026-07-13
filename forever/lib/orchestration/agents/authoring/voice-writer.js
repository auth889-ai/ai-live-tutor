// Voice Writer agent: ONE job — narrate an already-designed board like a warm human
// teacher. Every line is bound to the board object it explains. Contract-validated,
// one repair round, honest failure.

import { z } from 'zod';

import { callQwenJson } from '../../../qwen/client.js';
import { validateVoiceLines, normalizeVoiceTargets, normalizeFocusRefs } from '../../../generation/voice/voice-lines.js';

const VOICE_SCHEMA = z.object({
  voiceLines: z.array(z.object({
    id: z.string(),
    text: z.string(),
    targetObjectId: z.string(),
    focusRef: z.union([z.string(), z.number()]).optional(),
    traceStep: z.number().int().optional(),
  })).min(1),
});

export async function writeVoice({ objects, sourcePack }) {
  const system = `You are the Voice Writer of an AI tutor: what the teacher SAYS while the board is written.
Output ONLY JSON: {"voiceLines":[{"id","text","targetObjectId","focusRef"?,"traceStep"?}]}
POINT WHILE YOU SPEAK (this is what makes it feel like a real teacher, not a slideshow):
- When a line discusses a specific SUB-ELEMENT of its target object, set "focusRef" to that element's id so it
  highlights AS you say it: for a "graph" object use the node id (e.g. "8"); for a "code" object use the 1-based
  line number (e.g. 5); for a "trace" table use the step number; omit focusRef for a general line.
- So a line like "we compare node 8 to the target" has focusRef "8"; "line 5 computes the middle index" has focusRef 5.
DRY-RUN DIAGRAMS MUST MATCH THE WORDS (critical): if a "diagram" object's content has a "trace" array, the picture
ANIMATES one step per spoken line. So for that object you MUST write EXACTLY ONE line per trace step, IN the trace's
order, and set "traceStep" to that step's 0-based index. Each such line explains ONLY what that step does (the node/
pointer that lights up NOW) in natural spoken words — never race ahead to a later step, and never say something the
step doesn't show. The marked node and your words must be the SAME thing. Put the hook (before step 0) and any
misconception/recap on OTHER objects (the title/callout/code), NOT interleaved between the trace steps.
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
    const { json, usage } = await callQwenJson({ agent: 'voice_writer', system: system + repair, user, temperature: 0.6, schema: VOICE_SCHEMA });
    try {
      // Unambiguous slips (targeting a node id instead of its object) are repaired
      // structurally before validation — no model round-trip for a mechanical fix.
      const voiceLines = normalizeFocusRefs(normalizeVoiceTargets(json.voiceLines, objects));
      validateVoiceLines(voiceLines, objects);
      return { voiceLines, usage };
    } catch (error) {
      lastError = error.message;
    }
  }
  throw new Error(`Voice Writer failed contract validation after repair: ${lastError}`);
}
