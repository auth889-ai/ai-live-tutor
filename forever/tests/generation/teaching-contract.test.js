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

// ── BOARD-DESCRIPTION LAW (external audit 2026-07-28) ────────────────────────────────
// The audit's counterexample passed every rule: it carried the defining frame, a number,
// a causal marker AND the chunk's own vocabulary — while describing the PICTURE instead of
// the material. Both rules are self-calibrated against the source, so a lesson whose
// subject genuinely IS shapes keeps its full vocabulary.
const BIO_CHUNKS = [{
  id: 'chunk_0001',
  text: 'Photosynthesis converts light energy into chemical energy. Chlorophyll absorbs sunlight in the chloroplast, and the plant stores glucose.',
}];

test('BOARD LAW A: a "definition" that says the concept IS a drawing primitive is rejected', () => {
  const lines = [{ id: 'b1', text: 'Photosynthesis is a triangle containing chlorophyll beside sunlight.' }];
  const moves = [{ type: 'definition', voiceLineIds: ['b1'], chunkId: 'chunk_0001' }];
  // Isolated with the recap role so only the definition's own evidence is judged.
  const violations = validateTeachingContract(moves, lines, BIO_CHUNKS, { role: 'qa' });
  assert.equal(violations.length, 1, violations.join('; '));
  assert.match(violations[0], /says the concept IS a triangle — that describes the drawing/);
});

test('BOARD LAW B: an example that counts board furniture instead of material is rejected', () => {
  const lines = [{ id: 'b2', text: 'For example, 5 photosynthesis objects carry chlorophyll near sunlight.' }];
  const moves = [{ type: 'concrete_example', voiceLineIds: ['b2'], chunkId: 'chunk_0001' }];
  const violations = validateTeachingContract(moves, lines, BIO_CHUNKS, { role: 'qa' });
  assert.equal(violations.length, 1, violations.join('; '));
  assert.match(violations[0], /counts the BOARD, not the material \("5 objects"\)/);
});

test('BOARD LAW: SOURCE-CALIBRATED — a geometry lesson may still define a triangle and count its angles', () => {
  // The identical words are legitimate vocabulary here because the SOURCE uses them. A
  // blanket ban would have made this lesson ungeneratable — the law must read the source.
  const geoChunks = [{
    id: 'chunk_0001',
    text: 'A triangle is a polygon with three sides and three angles. The interior angles of any triangle sum to 180 degrees.',
  }];
  const geoLines = [
    { id: 'g1', text: 'A triangle is a polygon that has exactly three straight sides.' },
    { id: 'g2', text: 'For example, take a triangle whose angles are 60, 60 and 60 degrees.' },
    { id: 'g3', text: 'The angles always total 180 degrees because a triangle splits into a straight angle.' },
  ];
  const geoMoves = [
    { type: 'definition', voiceLineIds: ['g1'], chunkId: 'chunk_0001' },
    { type: 'concrete_example', voiceLineIds: ['g2'], chunkId: 'chunk_0001' },
    { type: 'mechanism', voiceLineIds: ['g3'], chunkId: 'chunk_0001' },
  ];
  assert.deepEqual(validateTeachingContract(geoMoves, geoLines, geoChunks, { role: 'intuition' }), []);
});

test('BOARD LAW: a real definition pointing at a figure is NOT punished — only the genus is judged', () => {
  // Naming board furniture is fine; CLASSIFYING the concept as furniture is not.
  const lines = [{ id: 'b3', text: 'Photosynthesis is the process that converts light energy into chemical energy, shown by the arrow on this figure.' }];
  const moves = [{ type: 'definition', voiceLineIds: ['b3'], chunkId: 'chunk_0001' }];
  assert.deepEqual(validateTeachingContract(moves, lines, BIO_CHUNKS, { role: 'qa' }), []);
});

// ── ROLE-AWARE REQUIRED SET (external audit 2026-07-28) ──────────────────────────────
// Hard rules must not stop a scene from being generated for owing a move its ROLE does not
// owe. The required SET is role-shaped; every declared move still faces the full evidence
// rules. Default (unknown/absent role) stays the strict triad — fail closed.

test('ROLE recap: a retrieval-only contract passes — a recap makes the learner recall, it does not re-define', () => {
  const recap = [{ type: 'learner_check', voiceLineIds: ['v5'], chunkId: 'chunk_0002' }];
  assert.deepEqual(validateTeachingContract(recap, LINES, CHUNKS, { role: 'recap' }), []);
  // …and the same contract IS a violation for a normal taught scene.
  const strict = validateTeachingContract(recap, LINES, CHUNKS, { role: 'intuition' });
  assert.equal(strict.length, 3, strict.join('; '));
  assert.ok(strict.every((v) => /no (definition|concrete_example|mechanism) move declared/.test(v)), strict.join('; '));
});

test('ROLE recap/practice/checkpoint: the learner_check is REQUIRED — a recap that only re-teaches is rejected', () => {
  const reTeach = GOOD.filter((m) => m.type !== 'learner_check');
  for (const role of ['recap', 'practice', 'checkpoint']) {
    const violations = validateTeachingContract(reTeach, LINES, CHUNKS, { role });
    assert.equal(violations.length, 1, `${role}: ${violations.join('; ')}`);
    assert.match(violations[0], /no learner_check move declared/);
    assert.match(violations[0], /retrieve or attempt it themselves/);
  }
});

test('ROLE motivate: the concrete hook is required, the definition/mechanism triad is not', () => {
  const hook = [{ type: 'concrete_example', voiceLineIds: ['v2'], chunkId: 'chunk_0001' }];
  assert.deepEqual(validateTeachingContract(hook, LINES, CHUNKS, { role: 'motivate' }), []);
  const noHook = [{ type: 'definition', voiceLineIds: ['v1'], chunkId: 'chunk_0001' }];
  const violations = validateTeachingContract(noHook, LINES, CHUNKS, { role: 'motivate' });
  assert.equal(violations.length, 1, violations.join('; '));
  assert.match(violations[0], /no concrete_example move declared/);
});

test('ROLE default: an unknown or absent role keeps the strict triad (fail closed)', () => {
  const thin = [{ type: 'definition', voiceLineIds: ['v1'], chunkId: 'chunk_0001' }];
  for (const role of ['', 'dry_run', 'edge_cases', 'some_new_role']) {
    const violations = validateTeachingContract(thin, LINES, CHUNKS, { role });
    assert.equal(violations.length, 2, `${role}: ${violations.join('; ')}`);
    assert.ok(violations.some((v) => /no concrete_example move declared/.test(v)));
    assert.ok(violations.some((v) => /no mechanism move declared/.test(v)));
  }
  // No options argument at all behaves identically to the strict default.
  assert.deepEqual(validateTeachingContract(thin, LINES, CHUNKS), validateTeachingContract(thin, LINES, CHUNKS, { role: '' }));
});

test('ROLE relaxation never relaxes EVIDENCE: a recap\'s declared moves still face every rule', () => {
  // v1 defines but carries no concrete value — declaring it as the example still fails,
  // recap or not. The role changes WHICH moves are owed, never what a move must prove.
  const recap = [
    { type: 'learner_check', voiceLineIds: ['v5'], chunkId: 'chunk_0002' },
    { type: 'concrete_example', voiceLineIds: ['v1'], chunkId: 'chunk_0001' },
  ];
  const violations = validateTeachingContract(recap, LINES, CHUNKS, { role: 'recap' });
  assert.equal(violations.length, 1, violations.join('; '));
  assert.match(violations[0], /no concrete value/);
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

test('writeVoice: the ROLE reaches the validator AND the prompt — a practice scene is asked for the learner_check, not the triad', async () => {
  const systems = [];
  const practiceMoves = [{ type: 'learner_check', voiceLineIds: ['v5'], chunkId: 'chunk_0002' }];
  const result = await writeVoice({ objects: OBJECTS, sourcePack: SOURCE_PACK, brief: { pedagogicalRole: 'practice' } }, {
    runAgentChain: async ({ system }) => {
      systems.push(system);
      return { json: { voiceLines: LINES, teachingMoves: practiceMoves }, usage: null };
    },
  });
  // One call: a retrieval-only contract is ACCEPTED for practice — no repair round needed.
  assert.equal(systems.length, 1);
  assert.match(systems[0], /Required for this practice scene: at least one learner_check/);
  assert.match(systems[0], /never reveal the answer before the learner attempts it/);
  assert.doesNotMatch(systems[0], /Required: at least one definition/);
  assert.deepEqual(result.teachingMoves, practiceMoves);
});

test('writeVoice: a taught scene still gets the strict triad instruction (and still owes the depth floor)', async () => {
  const systems = [];
  // These 6 lines pass the contract but sit under the 8-line depth floor — which a TAUGHT
  // role owes and recap/practice do not. So this asserts both halves of role-awareness at
  // once: the strict prompt goes out, and the taught scene is still held to lecture depth.
  await assert.rejects(
    writeVoice({ objects: OBJECTS, sourcePack: SOURCE_PACK, brief: { pedagogicalRole: 'intuition' } }, {
      runAgentChain: async ({ system }) => {
        systems.push(system);
        return { json: { voiceLines: LINES, teachingMoves: GOOD }, usage: null };
      },
    }),
    /only 6 voice lines — a taught scene needs at least 8/,
  );
  assert.match(systems[0], /Required: at least one definition, one concrete_example, and one mechanism/);
  assert.doesNotMatch(systems[0], /Required for this/);
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
