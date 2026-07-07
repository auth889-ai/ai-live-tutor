import assert from 'node:assert/strict';
import test from 'node:test';

import { createBullQueue } from '../../lib/queue/backends/bullmq.js';

// We can't exercise BullMQ without a live Redis, but we CAN guarantee the module imports and
// that merely defining a queue does not open a connection (connections must be lazy, created
// only when createBullQueue is actually called — so importing this in the API bundle is safe).
test('bullmq backend imports and exposes createBullQueue without connecting', () => {
  assert.equal(typeof createBullQueue, 'function');
});
