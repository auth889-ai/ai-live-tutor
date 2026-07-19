import assert from 'node:assert/strict';
import test from 'node:test';
import { startSession, endSession, recordActivity, dashboard } from '../../lib/focus/focus-store.js';

// No MONGODB_URI in the test env -> the store degrades gracefully (offline), never throws.
const env = { }; // MONGODB_URI unset

test('store degrades gracefully with no database — never throws', async () => {
  const s = await startSession({ deviceId: 'd1', goal: 'learn SQL' }, { env });
  assert.ok(s.sessionId);
  assert.equal(s.offline, true);
  const r = await recordActivity({ deviceId: 'd1', sessionId: s.sessionId, signal: { page: { url: 'x' }, behavior: {} }, decision: { type: 'study' } }, { env });
  assert.equal(r.saved, false);
  const d = await dashboard({ deviceId: 'd1' }, { env });
  assert.deepEqual(d.activities, []);
  assert.equal(d.offline, true);
  const e = await endSession({ deviceId: 'd1' }, { env });
  assert.equal(e.ended, true);
});
