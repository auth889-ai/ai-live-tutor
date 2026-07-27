// Typed teaching contract: the Voice Writer DECLARES which lines carry which teaching
// move, and validateTeachingContract checks the structure deterministically — typed
// evidence instead of regex-guessing, plus a SEMANTIC FLOOR (cited lines must speak the
// cited chunk's own content words — a digit or a "because" in generic prose is not
// evidence). Plus the writeVoice wiring: violations feed the repair retry by name; an
// omitted contract is ALWAYS a violation (fail-closed, no env opt-out).

import assert from 'node:assert/strict';
import test from 'node:test';

import { validateTeachingContract } from '../../lib/generation/voice/voice-lines.js';
import { writeVoice } from '../../lib/orchestration/agents/authoring/voice-writer.js';

const LINES = [
  { id: 'v1', text: 'A stack is a list where you only ever touch the top item.', targetObjectId: 'obj_note' },
  { id: 'v2', text: 'For example, suppose we push 3 plates onto the stack and then pop 1 off.', targetObjectId: 'obj_note' },
  { id: 'v3', text: 'It works because the last plate in is the first plate out.', targetObjectId: 'obj_note' },
  { id: 'v4', text: 'Step one: we push the value 5 onto the empty stack structure.', targetObjectId: 'obj_note' },
  { id: 'v5', text: 'Pause and predict: what would pop return right now?', targetObjectId: 'obj_note' },
  // Carries a digit, a causal marker, a defining frame AND both chunks' content words —
  // passes the evidence rules for every move type, so citing it everywhere isolates the
  // one-line-cannot-be-everything rule.
  { id: 'v6', text: 'Because we push 3 plates onto the stack, the top plate changes, which means pop sees the newest one.', targetObjectId: 'obj_note' },
];
const CHUNKS = [
  { id: 'chunk_0001', text: 'Push and pop on a stack.' },
  { id: 'chunk_0002', text: 'The top plate moves.' },
];
const GOOD = [
  { type: 'definition', voiceLineIds: ['v1'], chunkId: 'chunk_0001' },
  { type: 'concrete_example', voiceLineIds: ['v2'], chunkId: 'chunk_0001' },
  { type: 'mechanism', voiceLineIds: ['v3'], chunkId: 'chunk_0002' },
  { type: 'worked_step', voiceLineIds: ['v4'], chunkId: 'chunk_0001' },
  { type: 'learner_check', voiceLineIds: ['v5'], chunkId: 'chunk_0002' },
];

test('a structurally sound contract passes with zero violations', () => {
  assert.deepEqual(validateTeachingContract(GOOD, LINES, CHUNKS), []);
});

test('rule a: missing any of definition/concrete_example/mechanism is named', () => {
  const violations = validateTeachingContract(GOOD.filter((m) => m.type !== 'mechanism'), LINES, CHUNKS);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /no mechanism move declared/);
});

test('rule b: one line cited by all five move types cannot carry them all', () => {
  const everything = GOOD.map((m) => ({ ...m, voiceLineIds: ['v6'] }));
  const violations = validateTeachingContract(everything, LINES, CHUNKS);
  assert.equal(violations.length, 1, violations.join('; '));
  assert.match(violations[0], /voice line v6 is cited by 5 different move types/);
});

test('rule c: citing an unknown voiceLineId is a violation', () => {
  const violations = validateTeachingContract(
    GOOD.map((m) => (m.type === 'definition' ? { ...m, voiceLineIds: ['v99'] } : m)), LINES, CHUNKS);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /unknown voice line "v99"/);
});

test('rule d: a concrete_example whose cited lines carry no concrete value fails', () => {
  // v1 is a pure definition — no digit, no quoted value, no example marker.
  const violations = validateTeachingContract(
    GOOD.map((m) => (m.type === 'concrete_example' ? { ...m, voiceLineIds: ['v1'] } : m)), LINES, CHUNKS);
  assert.equal(violations.length, 1, violations.join('; '));
  assert.match(violations[0], /no concrete value/);
});

test('rule e: a mechanism whose cited lines carry no cause-effect marker fails', () => {
  // v4 narrates a step — no because/so that/therefore/which means/leads to/that's why.
  const violations = validateTeachingContract(
    GOOD.map((m) => (m.type === 'mechanism' ? { ...m, voiceLineIds: ['v4'] } : m)), LINES, CHUNKS);
  assert.equal(violations.length, 1, violations.join('; '));
  assert.match(violations[0], /no cause-effect marker/);
});

test('rule f: a chunkId outside the focused chunks fails; no chunks provided = not judged', () => {
  const stray = GOOD.map((m) => (m.type === 'definition' ? { ...m, chunkId: 'chunk_9999' } : m));
  const violations = validateTeachingContract(stray, LINES, CHUNKS);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /chunk_9999.*not one of this scene's focused chunks/);
  assert.deepEqual(validateTeachingContract(stray, LINES, []), []);
});

// ── SEMANTIC FLOOR: evidence must be about the CITED CHUNK, not generic filler ──

test('semantic floor: "for example, 5 things because reasons" against an unrelated chunk FAILS', () => {
  const genericLines = [
    { id: 'g1', text: 'This concept is a thing you should really understand today.', targetObjectId: 'obj_note' },
    { id: 'g2', text: 'For example, 5 things happen when you try it yourself.', targetObjectId: 'obj_note' },
    { id: 'g3', text: 'It matters because reasons that will become clear later.', targetObjectId: 'obj_note' },
  ];
  const chunks = [{ id: 'chunk_0001', text: 'Photosynthesis converts sunlight into chemical energy inside the chloroplast.' }];
  const moves = [
    { type: 'definition', voiceLineIds: ['g1'], chunkId: 'chunk_0001' },
    { type: 'concrete_example', voiceLineIds: ['g2'], chunkId: 'chunk_0001' },
    { type: 'mechanism', voiceLineIds: ['g3'], chunkId: 'chunk_0001' },
  ];
  const violations = validateTeachingContract(moves, genericLines, chunks);
  assert.equal(violations.length, 3, violations.join('; '));
  assert.ok(violations.some((v) => /definition.*without using any content word from chunk_0001/.test(v)), violations.join('; '));
  assert.ok(violations.some((v) => /concrete_example.*never speak the cited chunk's own content/.test(v)), violations.join('; '));
  assert.ok(violations.some((v) => /mechanism.*cause-effect sentence never mentions chunk_0001/.test(v)), violations.join('; '));
  // Repair-friendly: each message names the chunk AND its candidate terms.
  for (const v of violations) assert.match(v, /chunk_0001.*(photosynthesis|sunlight|chemical|energy|chloroplast|converts)/s);
});

test('semantic floor: real evidence built from the chunk still passes', () => {
  const realLines = [
    { id: 'r1', text: 'Photosynthesis is the process a plant uses to feed itself.', targetObjectId: 'obj_note' },
    { id: 'r2', text: 'For example, one leaf turns sunlight into about 5 units of sugar energy.', targetObjectId: 'obj_note' },
    { id: 'r3', text: 'The chloroplast matters because it is where light becomes chemical energy.', targetObjectId: 'obj_note' },
  ];
  const chunks = [{ id: 'chunk_0001', text: 'Photosynthesis converts sunlight into chemical energy inside the chloroplast.' }];
  const moves = [
    { type: 'definition', voiceLineIds: ['r1'], chunkId: 'chunk_0001' },
    { type: 'concrete_example', voiceLineIds: ['r2'], chunkId: 'chunk_0001' },
    { type: 'mechanism', voiceLineIds: ['r3'], chunkId: 'chunk_0001' },
  ];
  assert.deepEqual(validateTeachingContract(moves, realLines, chunks), []);
});

test('semantic floor: a mechanism whose "because" sentence is filler fails even when ANOTHER cited line names the chunk', () => {
  const lines = [
    { id: 'm1', text: 'The chloroplast and sunlight are on the board here.', targetObjectId: 'obj_note' },
    { id: 'm2', text: 'And this happens because reasons we will see later.', targetObjectId: 'obj_note' },
  ];
  const chunks = [{ id: 'chunk_0001', text: 'Photosynthesis converts sunlight into chemical energy inside the chloroplast.' }];
  const moves = [
    { type: 'definition', voiceLineIds: ['v_d'], chunkId: 'chunk_0001' },
    { type: 'concrete_example', voiceLineIds: ['v_e'], chunkId: 'chunk_0001' },
    { type: 'mechanism', voiceLineIds: ['m1', 'm2'], chunkId: 'chunk_0001' },
  ];
  const violations = validateTeachingContract(moves, lines, chunks);
  assert.ok(violations.some((v) => /mechanism.*cause-effect sentence never mentions chunk_0001/.test(v)), violations.join('; '));
});

test('semantic floor: a definition without a defining pattern is named even when it speaks the chunk', () => {
  const lines = [{ id: 'd1', text: 'Look at the chloroplast capturing sunlight for chemical energy.', targetObjectId: 'obj_note' }];
  const chunks = [{ id: 'chunk_0001', text: 'Photosynthesis converts sunlight into chemical energy inside the chloroplast.' }];
  const violations = validateTeachingContract(
    [{ type: 'definition', voiceLineIds: ['d1'], chunkId: 'chunk_0001' },
      { type: 'concrete_example', voiceLineIds: ['d1'], chunkId: 'chunk_0001' },
      { type: 'mechanism', voiceLineIds: ['d1'], chunkId: 'chunk_0001' }],
    lines, chunks);
  assert.ok(violations.some((v) => /definition.*never actually DEFINE/.test(v)), violations.join('; '));
});

test('semantic floor: a chunk too thin to yield content words is not judged (no noise failures)', () => {
  const chunks = [{ id: 'chunk_0001', text: 'Push and pop.' }, { id: 'chunk_0002', text: 'The top plate moves.' }];
  // GOOD's definition/example cite chunk_0001, whose only words are under 5 chars — the
  // semantic floor stays silent rather than failing on unjudgeable vocabulary.
  assert.deepEqual(validateTeachingContract(GOOD, LINES, chunks), []);
});

test('an unknown move type and an empty citation list are both named violations', () => {
  const violations = validateTeachingContract(
    [...GOOD, { type: 'vibe_check', voiceLineIds: [], chunkId: 'chunk_0001' }], LINES, CHUNKS);
  assert.ok(violations.some((v) => /unknown move type/.test(v)), violations.join('; '));
  assert.ok(violations.some((v) => /cites no voiceLineIds/.test(v)), violations.join('; '));
});

// ── writeVoice wiring: repairable violations, silent fallback when moves are omitted ──
// The recap role bypasses the depth floor and the tiny chunks are below the keyterm-
// coverage judging threshold, so these tests exercise ONLY the contract path.
const OBJECTS = [{ id: 'obj_note', objectType: 'tutor_note', renderHint: 'text', content: 'Stacks' }];
const SOURCE_PACK = { chunks: CHUNKS };
const BRIEF = { pedagogicalRole: 'recap' };

test('writeVoice: an omitted teachingMoves field is retried until the contract is declared', async () => {
  const systems = [];
  const result = await writeVoice({ objects: OBJECTS, sourcePack: SOURCE_PACK, brief: BRIEF }, {
    runAgentChain: async ({ system }) => {
      systems.push(system);
      return { json: { voiceLines: LINES, ...(systems.length > 1 ? { teachingMoves: GOOD } : {}) }, usage: { total: 1 } };
    },
  });
  assert.equal(systems.length, 2);
  assert.match(systems[1], /no teachingMoves declared/);
  assert.deepEqual(result.teachingMoves, GOOD);
});

test('writeVoice: a model that never declares the contract fails honestly (fail-closed)', async () => {
  await assert.rejects(
    writeVoice({ objects: OBJECTS, sourcePack: SOURCE_PACK, brief: BRIEF }, {
      runAgentChain: async () => ({ json: { voiceLines: LINES }, usage: null }),
    }),
    /failed contract validation after repair.*no teachingMoves declared/s,
  );
});

test('writeVoice: there is NO strictness escape — omission throws even with TEACHING_CONTRACT_STRICT=0 set', async () => {
  // The env opt-out used to relax the contract to the legacy regex-only path; the audit
  // closed it. An omitted contract now ALWAYS fails, whatever the environment says.
  process.env.TEACHING_CONTRACT_STRICT = '0';
  try {
    await assert.rejects(
      writeVoice({ objects: OBJECTS, sourcePack: SOURCE_PACK, brief: BRIEF }, {
        runAgentChain: async () => ({ json: { voiceLines: LINES }, usage: { total: 1 } }),
      }),
      /failed contract validation after repair.*no teachingMoves declared/s,
    );
  } finally {
    delete process.env.TEACHING_CONTRACT_STRICT;
  }
});

test('writeVoice: a violated contract is retried with the violations named, then accepted', async () => {
  const bad = GOOD.map((m) => (m.type === 'mechanism' ? { ...m, voiceLineIds: ['v4'] } : m));
  const systems = [];
  const result = await writeVoice({ objects: OBJECTS, sourcePack: SOURCE_PACK, brief: BRIEF }, {
    runAgentChain: async ({ system }) => {
      systems.push(system);
      return { json: { voiceLines: LINES, teachingMoves: systems.length === 1 ? bad : GOOD }, usage: null };
    },
  });
  assert.equal(systems.length, 2);
  assert.match(systems[1], /teaching contract is structurally invalid/);
  assert.match(systems[1], /no cause-effect marker/);
  assert.deepEqual(result.teachingMoves, GOOD);
});

test('writeVoice: a contract still violated after repair fails honestly', async () => {
  const bad = GOOD.map((m) => (m.type === 'concrete_example' ? { ...m, voiceLineIds: ['v1'] } : m));
  await assert.rejects(
    writeVoice({ objects: OBJECTS, sourcePack: SOURCE_PACK, brief: BRIEF }, {
      runAgentChain: async () => ({ json: { voiceLines: LINES, teachingMoves: bad }, usage: null }),
    }),
    /failed contract validation after repair.*no concrete value/s,
  );
});
