import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyEventValues } from '../../../lib/execution/trace/universal/verify-events.js';

const RECORDING = { events: [
  { ev: 'line', line: 2, locals: { low: [5, -1] } },
  { ev: 'line', line: 3, locals: { low: [5, 7] } },
] };
const trace = (events) => ({
  views: { graph: { nodes: [{ id: '0' }, { id: '1' }], edges: [] } },
  steps: [{ line: 3, explanation: 'x', events }],
});

test('true events survive; fabricated before/after are stripped by the recording itself', () => {
  const honest = trace([{ eventType: 'write', semanticRole: 'state_write', target: { entityId: 'graphNode:1', field: 'low' }, before: undefined, after: 7, provenance: { eventIndex: 1 } }]);
  assert.equal(verifyEventValues(RECORDING, honest).stripped, 0);
  assert.equal(honest.steps[0].events.length, 1, 'the true event survives');

  const fake = trace([{ eventType: 'write', semanticRole: 'state_write', target: { entityId: 'graphNode:1', field: 'low' }, before: 999, after: -7, provenance: { eventIndex: 1 } }]);
  const r = verifyEventValues(RECORDING, fake);
  assert.equal(r.stripped, 1, 'the probe event (before:999/after:-7) dies against the recording');
  assert.equal(fake.steps[0].events, undefined, 'nothing unprovable renders');

  const wrongBefore = trace([{ eventType: 'write', target: { entityId: 'graphNode:1', field: 'low' }, before: 123, after: 7, provenance: { eventIndex: 1 } }]);
  assert.equal(verifyEventValues(RECORDING, wrongBefore).stripped, 1, 'a true after with a fabricated before also dies');
});
