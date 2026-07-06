// Code Runner agent: writes runnable code for a concept, EXECUTES it for real, and if it
// errors, reads the real error and fixes it — up to a few rounds — until it runs. The
// board only ever shows genuinely captured output. This self-debug loop is what makes
// Forever's coding lessons trustworthy (and beats a static course: the code demonstrably
// runs). Honest failure if it cannot get the code to run.

import { callQwenJson } from '../../../qwen/client.js';
import { runCode } from '../../../execution/run-code.js';
import { parseTrace } from '../../../execution/trace/parse-trace.js';

const RUNNABLE_LANGUAGES = ['python', 'javascript'];

export async function generateExecutedCode({ directive, sourceText, language = 'python', maxFixes = 2 }) {
  const lang = RUNNABLE_LANGUAGES.includes(language) ? language : 'python';

  const system = `You are the Code Runner of an AI tutor. Write a SHORT, self-contained ${lang} program that
demonstrates the concept and PRINTS its result so a learner can see the output. It must run with no
external packages beyond the standard library and no file/network access. Output ONLY JSON:
{"language":"${lang}","code": "<runnable source>","explanation":"<one line: what the output shows>"}`;

  let source = null;
  let explanation = '';
  let lastError = '';

  for (let attempt = 0; attempt <= maxFixes; attempt += 1) {
    const fix = attempt === 0
      ? ''
      : `\nThe previous code FAILED when executed. Fix it. Real error:\n${lastError}\nPrevious code:\n${source}`;
    const { json } = await callQwenJson({
      agent: 'code_runner',
      system: system + fix,
      user: `Concept to demonstrate: ${directive}\n\nGrounding source:\n${sourceText}`,
      model: process.env.MODEL_CODER || 'qwen3-coder-plus',
      temperature: 0.2,
    });
    source = String(json.code || '').trim();
    explanation = String(json.explanation || '').trim();
    if (!source) {
      lastError = 'No code produced.';
      continue;
    }

    const result = await runCode({ language: lang, source });
    if (!result.timedOut && (result.exitCode === 0 || (result.stdout && !result.stderr))) {
      return { language: lang, code: source, output: result.stdout, explanation, fixes: attempt };
    }
    lastError = result.timedOut ? 'Timed out (likely an infinite loop).' : result.stderr || `Exit code ${result.exitCode}`;
  }

  throw new Error(`Code Runner could not produce runnable code after ${maxFixes} fixes: ${lastError}`);
}

// Dry-run trace: write instrumented code that prints one `TRACE {json}` line per step,
// EXECUTE it for real, and parse the output into a step-by-step trace table (the Striver
// dry-run). Returns null if no real trace was produced — never a fake table.
export async function generateTrace({ directive, sourceText, language = 'python' }) {
  const lang = RUNNABLE_LANGUAGES.includes(language) ? language : 'python';
  const system = `You are the Code Runner. Write a SHORT ${lang} program that runs the algorithm for ONE concrete
example and, at each meaningful step (each loop iteration / recursive call), prints a line of the exact form:
TRACE {"var1": value, "var2": value}
using ONLY the key variables a student tracks (e.g. i, j, sum, low, mid, high, left, right, node). Standard
library only, no input. Output ONLY JSON: {"language":"${lang}","code":"<runnable source that prints TRACE lines>"}`;

  let source = null;
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const fix = attempt === 0 ? '' : `\nThe previous code failed or printed no TRACE lines. Fix it. Error: ${lastError}\nPrevious:\n${source}`;
    const { json } = await callQwenJson({
      agent: 'code_runner_trace',
      system: system + fix,
      user: `Trace this concept step by step: ${directive}\n\nSource:\n${sourceText}`,
      model: process.env.MODEL_CODER || 'qwen3-coder-plus',
      temperature: 0.2,
    });
    source = String(json.code || '').trim();
    if (!source) {
      lastError = 'No code produced.';
      continue;
    }
    const result = await runCode({ language: lang, source });
    if (result.timedOut) {
      lastError = 'Timed out.';
      continue;
    }
    const table = parseTrace(result.stdout);
    if (table) return { language: lang, code: source, table };
    lastError = result.stderr || 'No TRACE lines in output.';
  }
  return null; // honest: no real trace, no fake table
}
