// Local dev convenience: run the Next.js app AND the BullMQ worker together, so a pasted
// lesson actually generates (the web process enqueues; the worker consumes). In production
// these are separate deployables — this script is ONLY for local dev. Ctrl-C stops both.
import { spawn } from 'node:child_process';

const procs = [
  { name: 'web   ', cmd: 'next', args: ['dev'] },
  { name: 'worker', cmd: 'node', args: ['--env-file=.env', 'lib/queue/worker.js'] },
].map(({ name, cmd, args }) => {
  const child = spawn(cmd, args, { stdio: 'inherit', shell: true, env: process.env });
  child.on('exit', (code) => {
    console.log(`[dev-all] ${name.trim()} exited (${code}); stopping the other.`);
    stopAll();
    process.exit(code ?? 0);
  });
  return child;
});

function stopAll() {
  for (const p of procs) {
    if (!p.killed) p.kill('SIGINT');
  }
}

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
console.log('[dev-all] started web + worker — Ctrl-C stops both');
