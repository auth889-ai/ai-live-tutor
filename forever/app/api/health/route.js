// GET /api/health -> readiness of the moving parts. This is what would have surfaced the
// "0% forever" hang instantly: it reports whether Redis is reachable and whether a worker has
// checked in recently. Returns 200 when healthy, 503 when a dependency is down, so a load
// balancer / uptime check / the Studio UI can act on it. Never throws.

import { getQueueHealth } from '../../../lib/queue/lesson-queue.js';

export async function GET() {
  const queue = await getQueueHealth();
  const ok = queue.backend === 'in-process' || (queue.redis === 'up' && queue.worker !== 'down');
  return Response.json(
    { status: ok ? 'ok' : 'degraded', queue, time: new Date().toISOString() },
    { status: ok ? 200 : 503 },
  );
}
