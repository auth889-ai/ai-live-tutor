// LIVE eval (spends a little tokens + runs real code): prove the Execution Tracer produces a
// REAL, contract-valid ExecutionTrace from actual execution.
//   node --env-file=.env eval/execution-tracer.eval.js "binary search on a sorted array"
import { traceExecution } from '../lib/orchestration/agents/coding/execution-tracer.js';

const directive = process.argv[2] || 'binary search on a sorted array of 7 elements';
console.log('Tracing (real run):', directive);

const result = await traceExecution({ directive, language: 'python' });
if (!result) {
  console.error('No real trace produced (honest failure).');
  process.exit(1);
}
const { trace, fixes } = result;
console.log(`\n=== ExecutionTrace: ${trace.language} · ${trace.steps.length} steps · ${fixes} self-fix ===`);
console.log('views:', JSON.stringify(trace.views));
console.log('\ncode:\n' + trace.code);
console.log('\nsteps:');
for (const [i, s] of trace.steps.entries()) {
  const state = s.array ? `array=${JSON.stringify(s.array)}` : s.graph ? `graph=${JSON.stringify(s.graph)}` : '';
  const coll = [s.stack && `stack=${JSON.stringify(s.stack)}`, s.queue && `queue=${JSON.stringify(s.queue)}`].filter(Boolean).join(' ');
  console.log(`  ${String(i + 1).padStart(2)}. L${s.line} | ${s.explanation}`);
  console.log(`      ${state} ${coll} vars=${JSON.stringify(s.variables ?? {})}`);
}
