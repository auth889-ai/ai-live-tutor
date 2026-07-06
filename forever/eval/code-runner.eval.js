// LIVE eval (spends tokens + runs real code):
//   node --env-file=.env eval/code-runner.eval.js "<concept>" [python|javascript]
// Proves: the AI writes code, executes it for real, self-fixes errors, shows REAL output.

import { generateExecutedCode } from '../lib/orchestration/agents/code-runner.js';

const directive = process.argv[2] || 'Demonstrate a binary search on a sorted array and print each step.';
const language = process.argv[3] || 'python';

const result = await generateExecutedCode({ directive, sourceText: directive, language });

console.log(`=== ${result.language} (self-fixed ${result.fixes} time(s)) ===`);
console.log(result.code);
console.log('\n=== REAL EXECUTED OUTPUT ===');
console.log(result.output);
console.log(`\n(${result.explanation})`);
