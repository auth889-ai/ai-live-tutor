import assert from 'node:assert/strict';
import test from 'node:test';

import { gateLesson, buildRepairNote } from '../../lib/generation/gate/lesson-gate.js';

// Universal Course Build Step 1: the zero-token gate. Fixtures mirror the REAL stored
// lesson schema (payload.scenes[].objects/voiceLines/timeline.actions).

const goodScene = (sceneId, role, extra = {}) => ({
  sceneId,
  pedagogicalRole: role,
  objects: [{ id: 'main', objectType: 'display', renderHint: 'list', content: 'joins drop from 3 to 0 with 45 opcodes' }],
  voiceLines: [{ id: `${sceneId}_v1`, text: 'Watch the join count drop from 3 to 0 here.', targetObjectId: 'main' }],
  timeline: { sceneId, actions: [{ id: `${sceneId}_a1`, kind: 'speech', voiceLineId: `${sceneId}_v1`, targetObjectId: 'main' }] },
  ...extra,
});

const GOOD = { scenes: [
  goodScene('s1', 'worked_example'),
  goodScene('s2', 'misconception'),
  goodScene('s3', 'checkpoint'),
  goodScene('s4', 'recap'),
] };

test('a coherent four-beat lesson passes the gate', () => {
  const r = gateLesson(GOOD, { sourceText: 'joins drop from 3 to 0 with 45 opcodes' });
  assert.deepEqual(r, { ok: true, violations: [] });
});

test('a missing beat, dangling target, empty board and unsourced number are each caught by name', () => {
  const bad = { scenes: [
    { ...goodScene('s1', 'worked_example'), voiceLines: [{ id: 'v', text: 'The cost is 9999 dollars.', targetObjectId: 'ghost' }] },
    { sceneId: 's2', pedagogicalRole: 'motivate', objects: [], voiceLines: [], timeline: { actions: [] } },
  ] };
  const r = gateLesson(bad, { sourceText: '' });
  const rules = r.violations.map((v) => v.rule);
  assert.equal(r.ok, false);
  assert.ok(rules.includes('beat-missing'));
  assert.ok(rules.includes('voiceline-dangling-target'));
  assert.ok(rules.includes('scene-empty-board'));
  assert.ok(rules.includes('number-unsourced'));
  // note: s1's timeline still targets 'main', so coverage passes via timeline — that is
  // the gate being RIGHT (timeline reference counts); coverage failure is tested below.
  const noRef = gateLesson({ scenes: [{ sceneId: 'x', pedagogicalRole: 'worked_example',
    objects: [{ id: 'orphan', renderHint: 'text', content: 'abandoned' }],
    voiceLines: [], timeline: { actions: [] } }] }, { sourceText: '' });
  assert.ok(noRef.violations.some((v) => v.rule === 'object-never-referenced'));
  const note = buildRepairNote(r.violations);
  assert.match(note, /SCENE s1/);
  assert.match(note, /ghost/);
});

test('question flood in a check-in and dangling timeline refs are caught', () => {
  const bad = { scenes: [
    goodScene('s1', 'worked_example'),
    goodScene('s2', 'misconception'),
    { ...goodScene('s3', 'checkpoint'), voiceLines: [{ id: 'q', text: 'Why? How? What? Really?', targetObjectId: 'main' }] },
    { ...goodScene('s4', 'recap'), timeline: { actions: [{ id: 'a', kind: 'point', targetObjectId: 'nope' }, { id: 'b', kind: 'speech', voiceLineId: 'missing' }] } },
  ] };
  const r = gateLesson(bad, { sourceText: '' });
  const rules = r.violations.map((v) => v.rule);
  assert.ok(rules.includes('checkin-question-flood'));
  assert.ok(rules.includes('timeline-dangling-target'));
  assert.ok(rules.includes('timeline-dangling-voiceline'));
});

test('the REAL stored Kid-Shop scene shape passes structural parsing (schema fidelity)', () => {
  const real = { scenes: [{
    sceneId: 'sc_04', pedagogicalRole: 'worked_example', layout: 'teacher_notebook_code',
    objects: [{ id: 'title', renderHint: 'text', content: 'The Two-Database Architecture', decorative: true },
              { id: 'benefits_list', renderHint: 'list', content: { items: ['ETL sync at 6:00 AM'] } }],
    voiceLines: [{ id: 'title_1', text: 'Let me explain the two-database architecture.', targetObjectId: 'title' },
                 { id: 'b1', text: 'The sync lands by morning.', targetObjectId: 'benefits_list' }],
    timeline: { sceneId: 'sc_04', timingSource: 'provisional', actions: [
      { id: 'act_point_title', kind: 'point', startMs: 0, durationMs: 600, targetObjectId: 'title' },
      { id: 'act_speak', kind: 'speech', startMs: 200, durationMs: 6460, voiceLineId: 'title_1' }] },
  }, goodScene('s2', 'misconception'), goodScene('s3', 'checkpoint'), goodScene('s4', 'recap')] };
  const r = gateLesson(real, { sourceText: 'ETL sync at 6:00 AM two-database joins drop from 3 to 0 with 45 opcodes' });
  assert.equal(r.ok, true, JSON.stringify(r.violations));
});

test('board laundering is caught: an invented number on an AI-drawn diagram cannot vouch for itself', () => {
  const laundered = { scenes: [
    goodScene('s1', 'worked_example', {
      objects: [
        { id: 'main', objectType: 'display', renderHint: 'list', content: 'joins drop from 3 to 0 with 45 opcodes' },
        { id: 'fake_graph', objectType: 'diagram', renderHint: 'diagram', content: { nodes: [{ label: 'demand 2200', x: 140, y: 90 }] }, sourceRef: { chunkId: 'chunk_1' } },
      ],
      voiceLines: [
        { id: 's1_v1', text: 'Watch the join count drop from 3 to 0 here.', targetObjectId: 'main' },
        { id: 's1_v2', text: 'Demand jumps to 2200 cups.', targetObjectId: 'fake_graph' },
      ],
    }),
    goodScene('s2', 'misconception'), goodScene('s3', 'checkpoint'), goodScene('s4', 'recap'),
  ] };
  const r = gateLesson(laundered, { sourceText: 'joins drop from 3 to 0 with 45 opcodes' });
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.rule === 'board-number-unsourced' && v.detail.includes('2200')));
  // layout coordinates (numeric-typed x/y) are NOT flagged
  assert.ok(!r.violations.some((v) => v.detail.includes('"140"') || v.detail.includes('"90"')));

  // the SAME number vouched by an EXECUTED evidence object passes
  const proven = JSON.parse(JSON.stringify(laundered));
  proven.scenes[0].objects.push({ id: 'computed_evidence', objectType: 'computed evidence table', renderHint: 'table', content: { rows: [['demand after shift', '1600 + 600', '2200']] }, sourceRef: { engine: 'calc-evidence', provenance: 'executed' } });
  proven.scenes[0].voiceLines.push({ id: 's1_v3', text: 'Measured, not guessed.', targetObjectId: 'computed_evidence' });
  const r2 = gateLesson(proven, { sourceText: 'joins drop from 3 to 0 with 45 opcodes' });
  assert.ok(!r2.violations.some((v) => v.rule === 'board-number-unsourced'), JSON.stringify(r2.violations));
});
