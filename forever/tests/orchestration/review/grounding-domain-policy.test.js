import assert from 'node:assert/strict';
import test from 'node:test';

import { auditGrounding } from '../../../lib/orchestration/agents/critics/grounding-auditor.js';

const PACK = { chunks: [{ id: 'ch_1', text: 'LC753: return a string unlocking the safe.' }] };
const OBJECTS = [{ id: 'o1', content: 'Hierholzer runs in O(E).', sourceRef: { chunkId: 'ch_1' } }];
const capturing = (seen) => ({ callQwenJson: async ({ system }) => { seen.system = system; return { json: { objections: [] }, usage: null }; } });

test("formal domains: standard knowledge is the teacher's own — the clause enters the prompt", async () => {
  const seen = {};
  await auditGrounding({ sceneId: 's1', objects: OBJECTS, sourcePack: PACK, domain: 'dsa', deps: capturing(seen) });
  assert.ok(seen.system.includes('STANDARD DSA KNOWLEDGE'), 'dsa carries the knowledge clause');
  assert.ok(seen.system.includes('MUST stay grounded'), 'claims about the source itself stay strict');
});

test('humanities stay strict: no carve-out — interpretation must trace to the source', async () => {
  const seen = {};
  await auditGrounding({ sceneId: 's1', objects: OBJECTS, sourcePack: PACK, domain: 'history_humanities', deps: capturing(seen) });
  assert.ok(!seen.system.includes('KNOWLEDGE IS THE TEACHER'), 'no carve-out for humanities');
});

test('default domain (unrouted callers) behaves exactly as before — strict', async () => {
  const seen = {};
  await auditGrounding({ sceneId: 's1', objects: OBJECTS, sourcePack: PACK, deps: capturing(seen) });
  assert.ok(!seen.system.includes('KNOWLEDGE IS THE TEACHER'), 'general stays strict');
});
