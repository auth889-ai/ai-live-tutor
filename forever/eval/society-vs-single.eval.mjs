// TRACK-3 EVAL: agent society vs single-agent baseline on the SAME 4 materials, judged by
// MECHANICAL validators (not vibes): (1) dry-run truth — is the trace's final answer the
// REAL execution's answer, and does the trace pass the contract validator + quality gate?
// (2) grounding — ungrounded numbers in student-facing prose vs the source text;
// (3) structural validity of the visual JSON. Society arm = the 4 lessons the real pipeline
// built (Tarjan, Dijkstra LC743, bitmask LC847, unseen LC1466). Single arm = ONE model call
// per material producing the whole mini-lesson, exactly what "no society" ships.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

import { runAgentChain } from '../lib/qwen/client.js';
import { validateExecutionTrace } from '../lib/board/execution/execution-trace.js';
import { dryRunQualityIssue } from '../lib/orchestration/agents/coding/execution-tracer.js';
import { ungroundedNumbers } from '../lib/board/composition/binding.js';
import { loadLesson } from '../lib/storage/lesson-store.js';

const CASES = [
  { id: 'lesson_spb7f51058f4c3', name: 'Tarjan LC1192', driver: 'scripts/demo-tarjan.mjs' },
  { id: 'lesson_sp2d9b2a9de2e6', name: 'Dijkstra LC743', driver: 'scripts/demo-dijkstra.mjs' },
  { id: 'lesson_sp3a79471c377f', name: 'Bitmask LC847', driver: 'scripts/demo-bitmask.mjs' },
  { id: 'lesson_sp288f6347c9c0', name: 'Unseen LC1466', driver: 'scripts/demo-unseen.mjs' },
];

const materialOf = (driver) => {
  const s = readFileSync(driver, 'utf8');
  return s.split('const MATERIAL = `')[1].split('`.trim();')[0].trim();
};

const runPy = (source) => {
  try { return execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15000 }).trim(); }
  catch (e) { return `ERROR: ${String(e.stderr ?? e.message).slice(0, 100)}`; }
};

const SINGLE_SYSTEM = `You are an expert algorithm tutor. From the material, produce a COMPLETE mini-lesson as ONE JSON object:
{"scenes":[{"title":"...","texts":["student-facing explanation paragraphs"]} x3],
 "dryRun":{"language":"python","code":"<the solution code>",
   "views":{"graph":{"nodes":[{"id":"0"}...],"edges":[{"from":"0","to":"1"}...],"directed":false}},
   "steps":[{"line":<int>,"explanation":"...","graph":{"current":"<id>","visited":["ids"]}} x>=8],
   "finalAnswer": <the value the code returns on the material's example>}}
Write the full step-by-step dry run yourself with concrete values. Output ONLY JSON.`;

const results = [];
for (const c of CASES) {
  const material = materialOf(c.driver);
  const row = { name: c.name, single: {}, society: {} };

  // ---- SINGLE-AGENT ARM ----
  try {
    const { json } = await runAgentChain({
      agent: 'eval_single_baseline', system: SINGLE_SYSTEM,
      user: material.slice(0, 4000), model: process.env.MODEL_CODER || 'qwen3-coder-plus',
    });
    const dr = json.dryRun ?? {};
    let contractError = null;
    try {
      validateExecutionTrace({ language: 'python', code: String(dr.code ?? 'x'), views: dr.views ?? {}, steps: dr.steps ?? [] }, 'single');
    } catch (e) { contractError = String(e.message).slice(0, 120); }
    const gateIssue = Array.isArray(dr.steps) ? dryRunQualityIssue({ steps: dr.steps, directive: c.name, code: String(dr.code ?? '') }) : 'no steps';
    // TRUTH CHECK: run the single agent's own code for real; compare to its claimed answer.
    const entryLine = material.match(/^print\((.+)\)\s*(#.*)?$/m);
    const real = entryLine && dr.code ? runPy(`${dr.code}\n${entryLine[0].split('#')[0]}`) : 'n/a';
    const claimed = JSON.stringify(dr.finalAnswer);
    const prose = (json.scenes ?? []).flatMap((s) => s.texts ?? []).join(' ');
    row.single = {
      contractError, gateIssue: gateIssue ? String(gateIssue).slice(0, 90) : null,
      claimedAnswer: claimed, realAnswer: real,
      answerMatches: real !== 'n/a' && String(real) === String(dr.finalAnswer),
      ungrounded: ungroundedNumbers(prose, material).length,
    };
  } catch (e) { row.single = { fatal: String(e.message).slice(0, 120) }; }

  // ---- SOCIETY ARM (the lessons the real pipeline built) ----
  try {
    const lesson = await loadLesson(c.id, {});
    const traces = lesson.scenes.flatMap((sc) => (sc.objects ?? []).map((o) => o.trace ?? (o.renderHint === 'algorithm' ? o.content : null)).filter((t) => t?.steps));
    let contractFails = 0;
    for (const t of traces) { try { validateExecutionTrace(t, 'soc'); } catch { contractFails += 1; } }
    const prose = lesson.scenes.flatMap((sc) => (sc.objects ?? []).map((o) => (typeof o.content === 'string' ? o.content : o.content?.body ?? ''))).join(' ');
    row.society = {
      scenes: lesson.scenes.length,
      traces: traces.length,
      engineExecuted: traces.filter((t) => t.meta?.tool).length,
      contractFails,
      ungrounded: ungroundedNumbers(prose, material).length,
    };
  } catch (e) { row.society = { fatal: String(e.message).slice(0, 120) }; }

  results.push(row);
  console.log(JSON.stringify(row));
}
writeFileSync('eval/society-vs-single.results.json', JSON.stringify(results, null, 1));
console.log('WROTE eval/society-vs-single.results.json');
