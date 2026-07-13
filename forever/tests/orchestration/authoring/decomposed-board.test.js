// The decomposed board generator (user design decision 2026-07-13): plan stubs -> one
// focused call per object IN PARALLEL -> element repair -> object-level salvage. A fake
// Qwen answers by inspecting each call's system prompt, so the whole choreography runs
// deterministically without tokens.

import assert from 'node:assert/strict';
import test from 'node:test';

import { designBoard } from '../../../lib/orchestration/agents/authoring/board-director.js';
import { buildTextSourcePack } from '../../../lib/source-pack/build/source-pack.js';

const pack = () => buildTextSourcePack('Demand slopes down; supply slopes up; they cross at the equilibrium price of $3.');
const chunkId = () => pack().chunks[0].id;

function fakeQwen() {
  const calls = { plan: 0, object: 0, repair: 0 };
  const call = async ({ system, user }) => {
    if (system.includes('PLAN the board')) {
      calls.plan += 1;
      return { json: { objects: [
        { id: 'title', renderHint: 'text', region: 'notebook_area', purpose: 'Name the scene' },
        { id: 'main_chart', renderHint: 'chart', region: 'notebook_area', purpose: 'Draw supply and demand crossing at $3' },
        { id: 'compare', renderHint: 'table', region: 'notebook_area', purpose: 'Compare the two curves' },
        { id: 'hopeless', renderHint: 'list', region: 'notebook_area', purpose: 'A list that never validates' },
      ] }, usage: null };
    }
    if (system.includes('You repair ONE board object')) {
      calls.repair += 1;
      // the contract error travels in the USER payload ({failedObject, contractError})
      if (String(user).includes('every cell needs real text')) {
        // the table repair: fill the empty cell
        return { json: { object: { objectType: 'comparison', renderHint: 'table', region: 'notebook_area', sourceRef: { chunkId: chunkId() },
          content: { columns: ['Slope'], rows: [{ label: 'Demand', values: ['down'] }, { label: 'Supply', values: ['up'] }] } } }, usage: null };
      }
      return { json: { object: { objectType: 'list', renderHint: 'list', region: 'notebook_area', content: { items: [] } } }, usage: null }; // still invalid
    }
    calls.object += 1;
    if (system.includes('"id":"title"')) {
      return { json: { object: { objectType: 'scene_title', renderHint: 'text', region: 'notebook_area', content: 'Where Curves Cross' } }, usage: null };
    }
    if (system.includes('"id":"main_chart"')) {
      return { json: { object: { objectType: 'supply_demand', renderHint: 'chart', region: 'notebook_area', sourceRef: { chunkId: chunkId() },
        content: { xAxis: { label: 'Q', min: 0, max: 10 }, yAxis: { label: 'P', min: 0, max: 6 },
          series: [{ id: 'demand', label: 'Demand', points: [[0, 6], [10, 0]] }, { id: 'supply', label: 'Supply', points: [[0, 0], [10, 6]] }],
          annotations: [{ type: 'point', x: 5, y: 3, label: 'Equilibrium $3' }] } } }, usage: null };
    }
    if (system.includes('"id":"compare"')) {
      // first draft has an EMPTY CELL -> must go through element repair, not kill the scene
      return { json: { object: { objectType: 'comparison', renderHint: 'table', region: 'notebook_area', sourceRef: { chunkId: chunkId() },
        content: { columns: ['Slope'], rows: [{ label: 'Demand', values: ['down'] }, { label: 'Supply', values: [''] }] } } }, usage: null };
    }
    // 'hopeless': invalid list (empty items), and its repair stays invalid -> object drop
    return { json: { object: { objectType: 'list', renderHint: 'list', region: 'notebook_area', content: { items: [] } } }, usage: null };
  };
  return { call, calls };
}

test('decomposed board: parallel per-object calls; element repair saves a bad object; a hopeless object drops ALONE', async () => {
  const { call, calls } = fakeQwen();
  const { objects } = await designBoard({ sourcePack: pack(), layout: 'teacher_notebook_code', brief: { title: 'Equilibrium', pedagogicalRole: 'worked_example', directive: 'show the crossing' }, call });

  assert.equal(calls.plan, 1);
  assert.equal(calls.object, 4); // one focused call per stub
  assert.ok(calls.repair >= 1); // the table went through element repair

  const ids = objects.map((o) => o.id);
  assert.deepEqual(ids, ['title', 'main_chart', 'compare']); // hopeless dropped ALONE, scene alive
  const table = objects.find((o) => o.id === 'compare');
  assert.deepEqual(table.content.rows[1].values, ['up']); // the repaired cell
  const title = objects.find((o) => o.id === 'title');
  assert.equal(title.decorative, true); // unsourced title coerced, not dropped
});

test('decomposed board: a board with NO teachable survivor still fails loudly (never ship an empty scene)', async () => {
  const call = async ({ system }) => {
    if (system.includes('PLAN the board')) {
      return { json: { objects: [{ id: 'title', renderHint: 'text', region: 'notebook_area', purpose: 'name it' }] }, usage: null };
    }
    return { json: { object: { objectType: 'scene_title', renderHint: 'text', region: 'notebook_area', content: 'Just a title' } }, usage: null };
  };
  await assert.rejects(
    designBoard({ sourcePack: pack(), layout: 'teacher_notebook_code', brief: { title: 'T', pedagogicalRole: 'worked_example', directive: 'd' }, call }),
    /no teachable object survived/,
  );
});
