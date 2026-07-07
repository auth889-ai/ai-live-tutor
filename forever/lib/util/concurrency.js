// Bounded parallel map (pure, tested) — Promise.allSettled semantics with at most `limit`
// tasks in flight. LLM fan-outs must NEVER be unbounded: with parallel lesson workers, an
// uncapped scene fan-out multiplies into dozens of simultaneous provider calls and 429
// storms (the OpenMAIC anti-pattern). Order of results matches input order.

export async function mapWithConcurrency(items, limit, fn) {
  const bound = Math.max(1, Math.floor(limit) || 1);
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(bound, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        try {
          results[index] = { status: 'fulfilled', value: await fn(items[index], index) };
        } catch (reason) {
          results[index] = { status: 'rejected', reason };
        }
      }
    }),
  );
  return results;
}
