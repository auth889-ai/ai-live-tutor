// NARRATION WARMTH — the AI writes the words, the recording guarantees the facts. The dry-run
// engine produces template narrations that are CORRECT by construction but read uniform; this
// agent hands Qwen every step's recorded facts and its template sentence, and asks for the
// same steps retold the way a beloved teacher speaks — building tension, celebrating the
// insight, varying rhythm. The GUARANTEE survives because the rewrite is validated
// deterministically: every number in a rewritten step must already exist in that step's facts
// or template (nothing numeric can be invented), the step count must match exactly, and any
// step that fails keeps its template sentence. AI can only make it warmer, never wronger.

import { callQwenJson } from '../../../qwen/client.js';

// The numeric guard: extract every number token (ints, decimals, negatives).
const numbersIn = (text) => (String(text).match(/-?\d+(?:\.\d+)?/g) ?? []);

export async function warmNarration({ trace, directive = '', deps = {} }) {
  const steps = trace?.steps ?? [];
  if (steps.length === 0) return { trace, rewritten: 0, usage: null };

  const facts = steps.map((s, i) => ({
    step: i + 1,
    template: s.explanation,
    variables: s.variables ?? {},
    ...(s.stack ? { stack: s.stack } : {}),
    ...(s.queue ? { queue: s.queue } : {}),
    ...(s.traceRow ? { table: s.traceRow } : {}),
  }));

  const system = `You are the Voice of a beloved algorithms teacher (the Striver/3Blue1Brown register: warm,
direct, building suspense toward each insight). You will RETELL a dry-run's step narrations.
THE IRON RULE: every fact is already given per step (the template sentence + the recorded variables/collections).
You may rephrase, connect steps ("remember that 5 we saved?"), vary rhythm, and celebrate turning points —
but you may NOT introduce any number or value that is not in that step's given facts, may not contradict them,
and may not merge or drop steps. One rewritten narration per step, 1-3 sentences, same teaching content, warmer voice.
Output ONLY JSON: {"narrations": ["...", ...]} with EXACTLY ${steps.length} entries, in order.`;

  const { json, usage } = await (deps.callQwenJson ?? callQwenJson)({
    agent: 'narration_warmth',
    system,
    user: JSON.stringify({ lesson: directive.slice(0, 300), steps: facts }),
    model: process.env.MODEL_SCENE || 'qwen3.7-plus',
    temperature: 0.6,
    maxTokens: Math.min(8000, 120 * steps.length + 400),
  });

  const out = Array.isArray(json.narrations) ? json.narrations : [];
  let rewritten = 0;
  const warmedSteps = steps.map((s, i) => {
    const candidate = typeof out[i] === 'string' ? out[i].trim() : '';
    if (!candidate || candidate.length < 25) return s; // too thin -> keep the guaranteed template
    // THE VALIDATOR: every number in the rewrite must already exist in this step's facts.
    const allowed = new Set([
      ...numbersIn(s.explanation),
      ...numbersIn(JSON.stringify(s.variables ?? {})),
      ...numbersIn(JSON.stringify(s.traceRow ?? {})),
      ...numbersIn(JSON.stringify(s.stack ?? [])),
      ...numbersIn(JSON.stringify(s.queue ?? [])),
      String(i + 1), String(steps.length), // "step 3 of 12" style references
    ]);
    if (!numbersIn(candidate).every((n) => allowed.has(n))) return s; // invented a number -> rejected
    rewritten += 1;
    return { ...s, explanation: candidate };
  });

  return { trace: { ...trace, steps: warmedSteps }, rewritten, usage };
}
