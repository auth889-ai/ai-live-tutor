// Contract for student "Try it yourself" runs (pure, tested). The editor posts code; this
// validates and bounds it before it ever reaches the sandbox — language allowlist, size
// cap, no empty programs. The sandbox itself (Docker, no network, hard timeout) is the
// security boundary; this layer keeps junk and abuse from wasting it.

export const RUNNABLE = Object.freeze(['python', 'javascript']);
export const MAX_SOURCE_CHARS = 20_000;

export function validateRunRequest(body) {
  if (!body || typeof body !== 'object') throw new Error('Body must be JSON { language, source }');
  const language = String(body.language || '').toLowerCase().trim();
  if (!RUNNABLE.includes(language)) throw new Error(`language must be one of: ${RUNNABLE.join(', ')}`);
  const source = String(body.source ?? '');
  if (!source.trim()) throw new Error('source is empty — write some code first');
  if (source.length > MAX_SOURCE_CHARS) throw new Error(`source too large (max ${MAX_SOURCE_CHARS} characters)`);
  return { language, source };
}
