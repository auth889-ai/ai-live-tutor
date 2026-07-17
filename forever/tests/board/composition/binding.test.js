import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveBinding, ungroundedNumbers } from '../../../lib/board/composition/binding.js';

// A real-shaped frame (one Tarjan step from the engine).
const FRAME = {
  nodeState: { 0: { disc: 0, low: 0 }, 1: { disc: 1, low: 0 } },
  variables: { parent: 0 },
  queue: ['1:2', '3:4'],
  frames: [
    { frameId: 'f1', functionName: 'dfs', status: 'waiting', arguments: { u: 0 } },
    { frameId: 'f2', functionName: 'dfs', status: 'active', arguments: { u: 1 } },
  ],
};

test('lookup resolves through context refs with provenance; AI never supplies the value', () => {
  const r = resolveBinding(
    { op: 'lookup', collection: 'nodeState', key: '$node.id', field: 'disc' },
    FRAME, { context: { node: { id: '1' } }, expect: 'scalar' },
  );
  assert.equal(r.status, 'resolved');
  assert.equal(r.value, 1);
  assert.deepEqual(r.provenance, ['nodeState["1"].disc']);
});

test('missing is typed and never silent: absent entries, unknown fields, unresolved refs, unknown collections', () => {
  assert.equal(resolveBinding({ op: 'lookup', collection: 'nodeState', key: '9', field: 'disc' }, FRAME).status, 'missing');
  assert.equal(resolveBinding({ op: 'lookup', collection: 'nodeState', key: '1', field: 'depth' }, FRAME).status, 'missing');
  assert.equal(resolveBinding({ op: 'lookup', collection: 'nodeState', key: '$node.id', field: 'disc' }, FRAME, { context: {} }).status, 'missing');
  const unknown = resolveBinding({ op: 'lookup', collection: 'secrets', key: 'x' }, FRAME);
  assert.equal(unknown.status, 'missing');
  assert.match(unknown.reason, /unknown collection/);
  assert.equal(resolveBinding({ op: 'evaluate', collection: 'variables', key: 'x' }, FRAME).status, 'missing', 'no op outside the whitelist');
});

test('shape contracts reject mismatches as type_error (queue panel bound to a scalar)', () => {
  const r = resolveBinding({ op: 'lookup', collection: 'variables', key: 'parent' }, FRAME, { expect: 'list' });
  assert.equal(r.status, 'type_error');
  assert.equal(r.expected, 'list');
});

test('count/exists/select read engine collections; format fills templates only from resolved parts', () => {
  assert.equal(resolveBinding({ op: 'count', collection: 'queue' }, FRAME).value, 2);
  assert.equal(resolveBinding({ op: 'exists', collection: 'frames' }, FRAME).value, true);
  assert.deepEqual(resolveBinding({ op: 'select', collection: 'frames', field: 'status' }, FRAME).value, ['waiting', 'active']);
  const f = resolveBinding({
    op: 'format', template: 'disc={d} low={l}',
    bindings: {
      d: { op: 'lookup', collection: 'nodeState', key: '1', field: 'disc' },
      l: { op: 'lookup', collection: 'nodeState', key: '1', field: 'low' },
    },
  }, FRAME);
  assert.equal(f.value, 'disc=1 low=0');
  const hole = resolveBinding({ op: 'format', template: '{d}', bindings: { d: { op: 'lookup', collection: 'nodeState', key: '9', field: 'disc' } } }, FRAME);
  assert.equal(hole.status, 'missing', 'a template with a hole never renders half-true');
});

test('literal classifier: numbers grounded in the source pass, ungrounded numbers are named', () => {
  const src = 'There are 6 servers numbered 0..5 connected by 7 connections.';
  assert.deepEqual(ungroundedNumbers('a network of 6 servers', src), []);
  assert.deepEqual(ungroundedNumbers('disc[3] = 42 here', src, { entityIds: ['0', '1', '2', '3', '4', '5'] }), ['42'], 'node ids are grounded by the structure; 42 is the hallucination class bindings exist to prevent');
  assert.deepEqual(ungroundedNumbers('disc[3] = 42 here', src), ['3', '42'], 'without structure grounding, both are named');
});

test('compare computes the verdict from two bindings (bridge_test); join renders lists as text', () => {
  const cmp = resolveBinding({
    op: 'compare', operator: '>',
    left: { op: 'lookup', collection: 'nodeState', key: '1', field: 'low' },
    right: { op: 'lookup', collection: 'nodeState', key: '0', field: 'disc' },
  }, FRAME);
  assert.equal(cmp.status, 'resolved');
  assert.equal(cmp.value, false, 'low[1]=0 > disc[0]=0 is false — computed, never authored');
  assert.ok(cmp.provenance.includes('>'));
  assert.equal(resolveBinding({ op: 'compare', operator: 'eval', left: {}, right: {} }, FRAME).status, 'missing', 'operator whitelist');
  const j = resolveBinding({ op: 'join', collection: 'frames', field: 'functionName', separator: ' → ' }, FRAME);
  assert.equal(j.value, 'dfs → dfs');
});

test('exact-token grounding: a source "14" can no longer ground an AI-written "4"', () => {
  assert.deepEqual(ungroundedNumbers('value is 4', 'array of 14 items'), ['4']);
  assert.deepEqual(ungroundedNumbers('value is 14', 'array of 14 items'), []);
});
