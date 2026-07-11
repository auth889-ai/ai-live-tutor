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

// ---------------------------------------------------------------------------------------------
// AI VISUAL DIRECTOR (experiment, AI_VISUAL_DIRECTOR=1) — the same agent slot grown one role up.
// Feasibility measured on a real monotonic-stack run: Qwen directed 18/18 steps, the engine
// verified 100% of highlight lines and every "rejection" was TRUE derived arithmetic the old
// guard was too strict to recognize. So here the AI directs the screen per step — the spoken
// voice, the story beat (setup/tension/payoff/celebration), what to spotlight, the turning
// point — and the engine stays the only source of positions and the validator of every number.
// OpenMAIC-style speed: steps are directed in PARALLEL segments, not one giant serial call.

const SEGMENT = 6;

// Derived arithmetic: "answer[4] = 5 - 4, which is 1" must pass when 5 and 4 are recorded
// facts. Extend the allowed set with pairwise sums and differences of recorded numbers.
const withDerived = (allowed) => {
  const nums = [...allowed].map(Number).filter(Number.isFinite).slice(0, 24);
  const out = new Set(allowed);
  for (const a of nums) for (const b of nums) { out.add(String(a + b)); out.add(String(a - b)); }
  return out;
};

const BEATS = new Set(['setup', 'tension', 'payoff', 'celebration']);

const stepFacts = (s, i) => ({
  step: i + 1,
  template: s.explanation,
  variables: s.variables ?? {},
  ...(s.stack ? { stack: s.stack } : {}),
  ...(s.queue ? { queue: s.queue } : {}),
  ...(s.traceRow ? { table: s.traceRow } : {}),
});

export async function directVisualRun({ trace, directive = '', deps = {} }) {
  const steps = trace?.steps ?? [];
  if (steps.length === 0) return { trace, rewritten: 0, usage: null };
  const call = deps.callQwenJson ?? callQwenJson;

  // The structure on screen (array cells, 2d table, node values) is recorded truth the AI may
  // speak about — "temps[1] is 74" must pass when 74 sits in the traced array. One shared set.
  const structureNumbers = numbersIn(JSON.stringify(trace.views ?? {}));

  const segments = [];
  for (let at = 0; at < steps.length; at += SEGMENT) segments.push({ at, slice: steps.slice(at, at + SEGMENT) });

  const results = await Promise.all(segments.map(async ({ at, slice }) => {
    const system = `You are the VISUAL DIRECTOR and voice of an animated algorithm dry run — a beloved teacher's board
(the Striver / 3Blue1Brown register). You receive recorded facts per step. Direct the screen AND speak:
- voice: 1-3 sentences spoken at this exact moment. Question before answer; WHY before WHAT (name the
  comparison that causes each move); call back to values the student saw earlier; plain words.
- beat: setup | tension | payoff | celebration — the story arc of the run.
- spotlight: up to 3 variable names or index numbers to visually emphasize right now.
- turningPoint: true on at most ONE step of this segment — the moment the idea clicks.
IRON RULE: every number in voice must come from that step's given facts or the structureOnScreen
values (simple sums or differences of those numbers are allowed, e.g. "5 minus 4 leaves 1"). Never contradict, merge, or drop steps.
This is segment ${at + 1}-${at + slice.length} of a ${steps.length}-step run.
Output ONLY JSON: {"directions":[{"step":<global number>,"voice":"...","beat":"...","spotlight":[],"turningPoint":false},...]}
with EXACTLY ${slice.length} entries, in order.`;
    try {
      const { json, usage } = await call({
        agent: 'visual_director',
        system,
        user: JSON.stringify({
          lesson: directive.slice(0, 300),
          structureOnScreen: trace.views ?? null,
          steps: slice.map((s, i) => stepFacts(s, at + i)),
        }),
        model: process.env.MODEL_SCENE || 'qwen3.7-plus',
        temperature: 0.5,
        maxTokens: Math.min(8000, 220 * slice.length + 400),
      });
      return { at, directions: Array.isArray(json.directions) ? json.directions : [], usage };
    } catch {
      return { at, directions: [], usage: null }; // this segment keeps its guaranteed templates
    }
  }));

  let rewritten = 0;
  const out = steps.map((s) => s);
  for (const { at, directions } of results) {
    directions.forEach((d, i) => {
      const idx = at + i;
      const s = steps[idx];
      if (!s || !d || typeof d.voice !== 'string' || d.voice.trim().length < 25) return;
      const allowed = withDerived(new Set([
        ...structureNumbers,
        ...numbersIn(s.explanation),
        ...numbersIn(JSON.stringify(s.variables ?? {})),
        ...numbersIn(JSON.stringify(s.traceRow ?? {})),
        ...numbersIn(JSON.stringify(s.stack ?? [])),
        ...numbersIn(JSON.stringify(s.queue ?? [])),
        String(idx + 1), String(steps.length),
      ]));
      if (!numbersIn(d.voice).every((n) => allowed.has(n))) return; // invented a number -> template ships
      const knownNames = new Set(Object.keys(s.variables ?? {}));
      const spotlight = (Array.isArray(d.spotlight) ? d.spotlight : [])
        .filter((x) => (typeof x === 'string' && knownNames.has(x)) || (Number.isInteger(x) && allowed.has(String(x))))
        .slice(0, 3);
      rewritten += 1;
      out[idx] = {
        ...s,
        explanation: d.voice.trim(),
        ...(BEATS.has(d.beat) ? { beat: d.beat } : {}),
        ...(spotlight.length ? { spotlight } : {}),
        ...(d.turningPoint === true ? { turningPoint: true } : {}),
      };
    });
  }

  const usage = results.map((r) => r.usage).filter(Boolean);
  return { trace: { ...trace, steps: out }, rewritten, usage: usage.length ? usage : null };
}
