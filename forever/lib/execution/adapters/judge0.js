// Judge0 adapter (production code execution). Activated when JUDGE0_URL is set — points
// at a self-hosted Judge0 on Alibaba ECS (keeps the stack all-Alibaba) or a hosted
// instance. Submits source, polls for the result, returns the same shape as the local
// runner. Honest failure on unknown language.

const JUDGE0_LANGUAGE_IDS = {
  javascript: 63, // Node.js
  js: 63,
  node: 63,
  python: 71, // Python 3
  python3: 71,
  c: 50,
  cpp: 54,
  'c++': 54,
  java: 62,
};

export async function runViaJudge0({ language, source, stdin = '', timeoutMs = 5000, env = process.env }) {
  const base = env.JUDGE0_URL.replace(/\/$/, '');
  const languageId = JUDGE0_LANGUAGE_IDS[language];
  if (!languageId) throw new Error(`Judge0: unsupported language "${language}"`);

  const headers = { 'Content-Type': 'application/json' };
  if (env.JUDGE0_API_KEY) headers['X-Auth-Token'] = env.JUDGE0_API_KEY;

  const response = await fetch(`${base}/submissions?base64_encoded=false&wait=true`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      language_id: languageId,
      source_code: source,
      stdin,
      cpu_time_limit: Math.ceil(timeoutMs / 1000),
    }),
  });
  if (!response.ok) throw new Error(`Judge0 failed: HTTP ${response.status} — ${(await response.text()).slice(0, 300)}`);

  const result = await response.json();
  return {
    stdout: (result.stdout ?? '').replace(/\s+$/, ''),
    stderr: (result.stderr ?? result.compile_output ?? '').replace(/\s+$/, ''),
    exitCode: result.status?.id === 3 ? 0 : (result.exit_code ?? 1), // 3 = Accepted
    timedOut: result.status?.id === 5, // 5 = Time Limit Exceeded
    durationMs: Math.round((Number(result.time) || 0) * 1000),
  };
}
