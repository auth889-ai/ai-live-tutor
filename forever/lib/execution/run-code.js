// Real code execution. runCode returns ACTUAL captured output — the board never shows
// invented output. Local subprocess runner (trusted, AI-generated teaching snippets,
// hard timeout, no network by policy) works today; a Judge0 adapter (JUDGE0_URL) is the
// production hardening for untrusted/multi-language at scale. Honest failure if a language
// cannot be executed — the scene that needed real output fails rather than faking it.

import { spawn } from 'node:child_process';

const LOCAL_RUNTIMES = {
  javascript: { cmd: 'node', args: ['-e'] },
  js: { cmd: 'node', args: ['-e'] },
  node: { cmd: 'node', args: ['-e'] },
  python: { cmd: 'python3', args: ['-c'] },
  python3: { cmd: 'python3', args: ['-c'] },
};

export async function runCode({ language, source, stdin = '', timeoutMs = 5000, env = process.env }) {
  if (!source?.trim()) throw new Error('runCode: source is required');
  const lang = String(language || '').toLowerCase();

  if (env.JUDGE0_URL) {
    const { runViaJudge0 } = await import('./judge0.js');
    return runViaJudge0({ language: lang, source, stdin, timeoutMs, env });
  }

  const runtime = LOCAL_RUNTIMES[lang];
  if (!runtime) {
    throw new Error(`runCode: no runner for language "${language}". Set JUDGE0_URL for full language support.`);
  }
  return runLocal(runtime, source, stdin, timeoutMs);
}

function runLocal(runtime, source, stdin, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(runtime.cmd, [...runtime.args, source], {
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 100_000) child.kill('SIGKILL'); // runaway output guard
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (error.code === 'ENOENT') reject(new Error(`runCode: runtime "${runtime.cmd}" not installed`));
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
