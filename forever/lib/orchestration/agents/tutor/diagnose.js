// ADAPTIVE DIAGNOSIS ENGINE — the missing piece that a pre-generated lesson (a monologue)
// cannot have and a great human tutor lives on: turn a WRONG ANSWER into a targeted
// re-teach. Given the question, the correct answer, and the STUDENT'S actual answer, it
// infers the SPECIFIC misconception the wrong answer reveals and re-explains addressing
// exactly that — the Bloom 2-sigma move (respond to THIS student's error), now automatic
// for every student on every wrong answer, which no human can do at scale.
//
// This is INTERACTIVE (needs the model / API key): the response depends on the live answer,
// so it cannot be pre-generated. That is precisely why it can rival human tutoring.

import { runAgentChain } from '../../../qwen/client.js';

// Returns { misconception, explanation, followUp, encouragement } — a diagnosis, a targeted
// re-teach, a confirming follow-up question, and calibrated encouragement.
export async function diagnoseWrongAnswer({
  question,
  correctAnswer,
  studentAnswer,
  concept = '',
  domain = 'general',
  register = null,
  call = runAgentChain,
}) {
  const system = `You are an expert ${domain} tutor doing what the best human tutors do: a student
just answered a question WRONG, and you must diagnose WHY — the specific misconception their
answer reveals — then re-teach addressing exactly that error, the way Lepper & Woolverton's
INSPIRE tutors do (Socratic, encouraging, indirect). Do NOT just restate the correct answer.
${register ? `Teach in this register: ${String(register).slice(0, 600)}\n` : ''}
Rules:
- Infer the LIKELY misconception from the gap between their answer and the correct one — name it
  concretely ("you divided instead of multiplied", "you confused movement-along with a shift").
- Re-explain targeting THAT misconception, not the whole topic. One clear correction.
- End with a SHORT follow-up question that checks whether the correction landed (not the same
  question — a variant that would expose the same misconception if it persists).
- Encouragement must be specific and honest ("your setup was right, the slip was one step"),
  never empty praise, never scolding.
Return ONLY JSON: {"misconception": string, "explanation": string (<=70 words), "followUp": string, "encouragement": string (<=20 words)}.`;

  const user = `QUESTION: ${question}
CORRECT ANSWER: ${correctAnswer}
STUDENT'S ANSWER: ${studentAnswer}
${concept ? `CONCEPT: ${concept}` : ''}`;

  const { json } = await call({
    agent: 'adaptive-diagnosis',
    system,
    user,
    maxTokens: 400,
    temperature: 0.3,
  });
  return {
    misconception: json?.misconception ?? '',
    explanation: json?.explanation ?? '',
    followUp: json?.followUp ?? '',
    encouragement: json?.encouragement ?? '',
  };
}
