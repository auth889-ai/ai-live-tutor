// Real code execution — the board only ever shows ACTUAL captured output. Three tiers,
// most-isolated first (WHERE the code runs):
//   1. Judge0 (JUDGE0_URL) — production. Self-hosted on Alibaba ECS, isolate/namespaces.
//   2. Docker (CODE_SANDBOX=docker) — isolated local container, --network none, capped.
//   3. Local subprocess — DEV ONLY. Real execution but NOT isolated; safe only because
//      WE generate the snippets (trusted). Never expose this tier to untrusted input.
// Honest failure if the chosen tier cannot run the language — never fake output.

import { spawn } from 'node:child_process';

const LOCAL_RUNTIMES = {
  javascript: { cmd: 'node', args: ['-e'] },
  js: { cmd: 'node', args: ['-e'] },
  node: { cmd: 'node', args: ['-e'] },
  python: { cmd: 'python3', args: ['-c'] },
  python3: { cmd: 'python3', args: ['-c'] },
};

export function selectRunner(env = process.env) {
  if (env.JUDGE0_URL) return 'judge0';
  if (String(env.CODE_SANDBOX).toLowerCase() === 'docker') return 'docker';
  return 'local';
}

export async function runCode({ language, source, stdin = '', timeoutMs = 5000, env = process.env }) {
  if (!source?.trim()) throw new Error('runCode: source is required');
  const lang = String(language || '').toLowerCase();
  const tier = selectRunner(env);

  if (tier === 'judge0') {
    const { runViaJudge0 } = await import('./adapters/judge0.js');
    return runViaJudge0({ language: lang, source, stdin, timeoutMs, env });
  }
  if (tier === 'docker') {
    const { runViaDocker } = await import('./adapters/docker.js');
    return runViaDocker({ language: lang, source, stdin, timeoutMs });
  }

  const runtime = LOCAL_RUNTIMES[lang];
  if (!runtime) {
    throw new Error(`runCode: no local runner for "${language}". Set JUDGE0_URL or CODE_SANDBOX=docker for full support.`);
  }
  return runLocal(runtime.cmd, [...runtime.args, source], stdin, timeoutMs);
}

// Shared subprocess driver (used by the local tier and the Docker adapter).
export function runLocal(cmd, args, stdin, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(cmd, args, { timeout: timeoutMs, killSignal: 'SIGKILL' });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      // 1MB, not 100KB: a universal recording of a 300-step dry run is ~90KB of JSON — the
      // old cap silently killed exactly the richest traces (a deep lesson needs 180-300 steps).
      if (stdout.length > 1_000_000) child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (error.code === 'ENOENT') reject(new Error(`runCode: "${cmd}" not installed`));
      else reject(error);
    });
    child.on('close', (code, signal) => {
      if (signal === 'SIGKILL' && Date.now() - started >= timeoutMs - 50) timedOut = true;
      resolve({
        stdout: stdout.replace(/\s+$/, ''),
        stderr: stderr.replace(/\s+$/, ''),
        exitCode: code,
        timedOut,
        durationMs: Date.now() - started,
      });
    });

    if (stdin) child.stdin.write(stdin);
    child.stdin.end();
  });
}
