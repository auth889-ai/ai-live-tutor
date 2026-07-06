// Docker adapter: isolated local execution in a throwaway container. Network is DISABLED
// (--network none), memory/CPU capped, auto-removed. Real isolation without cloud infra —
// the middle tier between raw subprocess (dev) and Judge0-on-ECS (production).

import { runLocal } from './run-code.js';

const IMAGES = {
  javascript: { image: 'node:22-slim', run: (src) => ['node', '-e', src] },
  js: { image: 'node:22-slim', run: (src) => ['node', '-e', src] },
  node: { image: 'node:22-slim', run: (src) => ['node', '-e', src] },
  python: { image: 'python:3.12-slim', run: (src) => ['python3', '-c', src] },
  python3: { image: 'python:3.12-slim', run: (src) => ['python3', '-c', src] },
};

export async function runViaDocker({ language, source, timeoutMs = 5000 }) {
  const spec = IMAGES[language];
  if (!spec) throw new Error(`Docker runner: unsupported language "${language}"`);
  const args = [
    'run',
    '--rm',
    '--network',
    'none',
    '--memory',
    '256m',
    '--cpus',
    '1',
    '--pids-limit',
    '128',
    spec.image,
    ...spec.run(source),
  ];
  return runLocal('docker', args, '', timeoutMs + 2000); // +2s for container start
}
