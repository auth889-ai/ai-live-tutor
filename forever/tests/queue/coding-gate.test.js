// CODING GATE (audit: "coding lessons lack a final quality gate"): the repair gate is
// non-coding-only by design, so coding lessons shipped with NO final verdict. The
// deterministic scan below is that verdict — dry runs must carry real executed trace steps.

import assert from 'node:assert/strict';
import test from 'node:test';

import { processLessonJob, codingGateViolations } from '../../lib/queue/lesson-processor.js';

const algo = (steps) => ({
  id: 'obj_algo_trace', objectType: 'algorithm_dry_run', renderHint: 'algorithm', region: 'code_panel',
  content: { language: 'python', code: 'print(1)', views: {}, steps },
});
const scene = (sceneId, pedagogicalRole, objects) => ({ sceneId, pedagogicalRole, objects });
const step = { line: 1, explain: 'start' };

test('codingGateViolations: a real dry run with executed steps is clean', () => {
  const lesson = { domain: 'dsa', scenes: [
    scene('sc_01', 'motivate', [{ id: 'obj_t', renderHint: 'text' }]),
    scene('sc_02', 'dry_run', [algo([step, step])]),
  ] };
  assert.deepEqual(codingGateViolations(lesson), []);
});

test('codingGateViolations: a dry_run scene WITHOUT an executed trace is a violation naming the scene', () => {
  // The exact failure the audit named: a "dry run" that is only text/diagram — the scene
  // wears the role but carries no executed evidence.
  const lesson = { domain: 'dsa', scenes: [
    scene('sc_05', 'dry_run', [{ id: 'obj_txt', renderHint: 'text' }]),
  ] };
  const violations = codingGateViolations(lesson);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'coding-dry-run-trace');
  assert.equal(violations[0].sceneId, 'sc_05');
});

test('codingGateViolations: an algorithm object with EMPTY steps is a dead animation — flagged wherever it sits', () => {
  const lesson = { domain: 'dsa', scenes: [scene('sc_03', 'worked_example', [algo([])])] };
  const violations = codingGateViolations(lesson);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].objectId, 'obj_algo_trace');
  // a dry_run scene with ONLY an empty-trace algorithm object trips both rules (a) and (b)
  const both = codingGateViolations({ scenes: [scene('sc_04', 'dry_run', [algo([])])] });
  assert.equal(both.length, 2);
});

test('codingGateViolations: legacy trace[] shape counts as executed steps', () => {
  const legacy = { id: 'obj_a', renderHint: 'algorithm', content: { trace: [step] } };
  assert.deepEqual(codingGateViolations({ scenes: [scene('sc_01', 'dry_run', [legacy])] }), []);
});

// --- through the processor: the verdict must reach finalLesson.gate and the status ---

const runJob = async (fakeLesson) => {
  const saved = {};
  await processLessonJob(
    { text: 'x'.repeat(80) },
    {
      deps: {
        generate: async () => fakeLesson,
        publishAssets: async (lesson) => lesson,
        findTopicImage: async () => null,
        // the repair gate (non-coding path) must never reach a live model in a unit test
        repair: async () => ({ before: { violations: [] }, after: { ok: true, violations: [] } }),
        save: async (id, lesson) => { saved[id] = lesson; },
        env: { DISABLE_TTS: '1' },
      },
    },
  );
  return Object.values(saved).at(-1);
};

test('processor: a coding lesson whose dry run lacks a trace lands as needs_review with gate.ok=false', async () => {
  const stored = await runJob({
    sourcePackId: 'sp_CODE1', lessonTitle: 'BFS', domain: 'dsa', skippedScenes: 0,
    scenes: [scene('sc_01', 'dry_run', [{ id: 'obj_txt', renderHint: 'text' }])],
  });
  assert.equal(stored.gate.ok, false);
  assert.equal(stored.gate.violations, 1);
  assert.deepEqual(stored.gate.rules, ['coding-dry-run-trace']);
  assert.equal(stored.status, 'needs_review'); // fail-closed: never silently 'ready'
});

test('processor: a coding lesson with a real executed dry run ships ready with a clean gate verdict', async () => {
  const stored = await runJob({
    sourcePackId: 'sp_CODE2', lessonTitle: 'BFS', domain: 'dsa', skippedScenes: 0,
    scenes: [scene('sc_01', 'dry_run', [algo([step])])],
  });
  assert.equal(stored.gate.ok, true);
  assert.equal(stored.gate.violations, 0);
  assert.equal(stored.status, 'ready');
});

test('processor: non-coding lessons are untouched by the coding gate', async () => {
  const stored = await runJob({
    sourcePackId: 'sp_ECON1', lessonTitle: 'Supply', domain: 'economics', skippedScenes: 0,
    scenes: [scene('sc_01', 'intuition', [{ id: 'obj_t', renderHint: 'text' }])],
    gate: { ok: true, violations: 0, repaired: 0, rules: [] }, // the repair gate's own verdict
  });
  assert.equal(stored.status, 'ready');
  assert.deepEqual(stored.gate.rules, []); // no coding rule injected into a non-coding verdict
});
