// Parse ExecutionTrace step events from a REAL run's stdout (pure, tested). The Execution
// Tracer agent writes a program that prints one line per logical step:
//   @@STEP {"line":6,"explanation":"...","array":{...},"variables":{...}}
// We parse those lines back into step objects. This is the ALGOGEN "decoupled" seam: the
// STATE comes from real execution (printed by the running program), not from an LLM drawing
// frames — so it can't hallucinate inconsistent states. Non-@@STEP output is ignored, and a
// malformed step line is skipped rather than crashing the whole trace.

export const STEP_MARKER = '@@STEP ';

export function parseStepEvents(stdout) {
  const steps = [];
  for (const rawLine of String(stdout ?? '').split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith(STEP_MARKER)) continue;
    const payload = line.slice(STEP_MARKER.length).trim();
    try {
      const step = JSON.parse(payload);
      if (step && typeof step === 'object') steps.push(step);
    } catch {
      // A single garbled line shouldn't sink the trace — skip it.
    }
  }
  return steps;
}

// Skipping a garbled line keeps the parser resilient, but it must never be SILENT: a vanished
// step is a hole in the dry run the student would never know about. The tracer counts these
// and demands a repair (the fix is always the same: serialize a dict, never hand-format).
export function countMalformedStepLines(stdout) {
  let malformed = 0;
  for (const rawLine of String(stdout ?? '').split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith(STEP_MARKER)) continue;
    try {
      JSON.parse(line.slice(STEP_MARKER.length).trim());
    } catch {
      malformed += 1;
    }
  }
  return malformed;
}
