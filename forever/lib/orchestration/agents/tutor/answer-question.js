// Ask-the-Tutor agent (one job): answer a student's question DURING a lesson, in the
// voice and register of that lesson's specialist teacher, grounded in what is actually
// on the boards (and the source chunks when the lesson has them). The user's "StudyAI
// white tutor" feature. Winner-repo pattern adopted (Aegis): the model returns BOTH a
// clean student-facing answer AND its grounding trace — display text and audit text are
// separate outputs, never one blob.

import { z } from 'zod';

import { runAgentChain } from '../../../qwen/client.js';
import { teachingFor, depthFor } from '../planning/domain-teaching.js';

const ANSWER_SCHEMA = z.object({
  answer: z.string(),
  grounding: z.string(), // one sentence: which board object/chunk the answer rests on, or "teacher knowledge"
  followUp: z.string().optional(), // one Socratic question back to the student
});

export async function answerQuestion({ lesson, sceneId, question, chunks = [], call = runAgentChain }) {
  const scene = lesson.scenes.find((s) => s.sceneId === sceneId) ?? lesson.scenes[0];
  const domain = lesson.domain ?? 'general';

  const system = `You are the ${domain} Teacher of this lesson ("${lesson.lessonTitle}"), answering a student's
question DURING class. Teach exactly in this register: ${teachingFor(domain)}
${depthFor(domain)}
RULES:
- Answer like the best human tutor: CONCRETE example first, then the idea; 3-6 sentences; plain words.
- Ground the answer in the CURRENT SCENE's board and the source material below. If the question goes
  beyond them, answer from standard ${domain} teacher knowledge and SAY so in "grounding".
- Never invent facts about the student's document; if the material doesn't cover it, say what IS known.
- End by nudging thinking: put ONE short Socratic follow-up question in "followUp".
Output ONLY JSON: {"answer": "...", "grounding": "...", "followUp": "..."}`;

  const user = JSON.stringify({
    studentQuestion: question,
    currentScene: {
      title: scene?.title,
      board: (scene?.objects ?? []).map((o) => ({ type: o.renderHint, content: o.content })).slice(0, 8),
      narration: (scene?.voiceLines ?? []).map((v) => v.text).slice(0, 12),
    },
    lessonScenes: lesson.scenes.map((s) => s.title),
    ...(chunks.length ? { sourceChunks: chunks.map((c) => c.text).slice(0, 12) } : {}),
  });

  const { json, usage } = await call({
    agent: 'tutor_qa',
    system,
    user,
    schema: ANSWER_SCHEMA,
    temperature: 0.5,
    maxTokens: 1200,
  });
  return { answer: json.answer, grounding: json.grounding, followUp: json.followUp ?? null, usage };
}
