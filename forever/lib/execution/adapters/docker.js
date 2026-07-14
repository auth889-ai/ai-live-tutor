// Docker adapter: isolated local execution in a throwaway container. Network is DISABLED
// (--network none), memory/CPU capped, auto-removed. Real isolation without cloud infra —
// the middle tier between raw subprocess (dev) and Judge0-on-ECS (production).

import { runLocal } from '../run-code.js';

// SQL executes REAL statements on sqlite (in-memory) inside the python image already in
// the fleet — no new image to pull. Statements run in order; every result set prints as
// a table (user-caught gap: SQL/database lessons had no runnable truth path).
const SQLITE_HARNESS = `
import sys, sqlite3
src = sys.argv[1]
conn = sqlite3.connect(":memory:")
cur = conn.cursor()
statements = [s.strip() for s in src.split(";") if s.strip()]
for statement in statements:
    cur.execute(statement)
    if cur.description:
        cols = [d[0] for d in cur.description]
        header = " | ".join(cols)
        print(header)
        print("-" * max(20, len(header)))
        for row in cur.fetchall():
            print(" | ".join(str(v) for v in row))
        print()
conn.commit()
`.trim();

const IMAGES = {
  javascript: { image: 'node:22-slim', run: (src) => ['node', '-e', src] },
  js: { image: 'node:22-slim', run: (src) => ['node', '-e', src] },
  node: { image: 'node:22-slim', run: (src) => ['node', '-e', src] },
  python: { image: 'python:3.12-slim', run: (src) => ['python3', '-c', src] },
  python3: { image: 'python:3.12-slim', run: (src) => ['python3', '-c', src] },
  sql: { image: 'python:3.12-slim', run: (src) => ['python3', '-c', SQLITE_HARNESS, src] },
  sqlite: { image: 'python:3.12-slim', run: (src) => ['python3', '-c', SQLITE_HARNESS, src] },
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
