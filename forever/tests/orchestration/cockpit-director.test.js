import assert from 'node:assert/strict';
import test from 'node:test';

import { directCockpit, channelInventory } from '../../lib/orchestration/agents/authoring/cockpit-director.js';

const TRACE = {
  views: { graph: { nodes: [{ id: '0' }, { id: '1' }], edges: [{ from: '0', to: '1' }], directed: false } },
  steps: [
    { line: 1, explanation: 'x', graph: { current: '0', visited: [] }, nodeState: { 0: { disc: 0, low: 0 } }, frames: [{ frameId: 'f1', functionName: 'dfs', status: 'active', arguments: { u: 0 } }] },
  ],
};

test('inventory names exactly what the recording produced', () => {
  const inv = channelInventory(TRACE);
  assert.equal(inv.structure, 'graph');
  assert.deepEqual(inv.nodeStateKeys.sort(), ['disc', 'low']);
  assert.equal(inv.hasFrames, true);
  assert.equal(inv.hasQueue, false);
});

test('a good AI spec is accepted; bad specs are rejected with named reasons — never a throw', async () => {
  const good = await directCockpit({
    problemText: 'network of 2 servers', trace: TRACE,
    deps: { runAgentChain: async () => ({ json: { algorithmFamily: 'tarjan-bridges', layoutIntent: 'force', panels: [
      { type: 'graph', title: 'Network' },
      { type: 'state-table', title: 'Low values', columns: [{ label: 'low', binding: { op: 'lookup', collection: 'nodeState', key: '$node.id', field: 'low' } }] },
    ] }, usage: null }) },
  });
  assert.equal(good.verdict, 'accepted');
  assert.equal(good.spec.panels.length, 2);

  const badChannel = await directCockpit({
    problemText: 'x', trace: TRACE,
    deps: { runAgentChain: async () => ({ json: { panels: [{ type: 'state-table', title: 'T', columns: [{ label: 'z', binding: { op: 'lookup', collection: 'secrets', key: 'a' } }] }] }, usage: null }) },
  });
  assert.match(badChannel.verdict, /unknown collection/);
  assert.equal(badChannel.spec, null);

  const looseNumber = await directCockpit({
    problemText: 'two servers', trace: TRACE,
    deps: { runAgentChain: async () => ({ json: { panels: [{ type: 'concept-card', title: 'Rule', content: 'low becomes 77 here' }] }, usage: null }) },
  });
  assert.match(looseNumber.verdict, /ungrounded numbers.*77/);

  const crash = await directCockpit({ problemText: 'x', trace: TRACE, deps: { runAgentChain: async () => { throw new Error('cloud down'); } } });
  assert.match(crash.verdict, /rejected: cloud down/);
  assert.equal(crash.spec, null, 'shadow-safe: failures never propagate');
});
