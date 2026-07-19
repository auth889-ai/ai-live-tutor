import assert from 'node:assert/strict';
import test from 'node:test';

import { runSchedEvidence } from '../../lib/orchestration/agents/authoring/evidence/sched-evidence.js';

// The OS material's own example: jobs of 8,4,2,6 all arriving at t=0.
const JOBS = [
  { id: 'P1', arrival: 0, burst: 8 },
  { id: 'P2', arrival: 0, burst: 4 },
  { id: 'P3', arrival: 0, burst: 2 },
  { id: 'P4', arrival: 0, burst: 6 },
];

test('FCFS in declared order gives avg waiting 8.5 (matches the material)', () => {
  const ev = runSchedEvidence({ processes: JOBS, policy: 'fcfs' });
  // waits: 0, 8, 12, 14 -> avg 8.5
  assert.equal(ev.avgWaiting, 8.5);
  assert.deepEqual(ev.order, ['P1', 'P2', 'P3', 'P4']);
});

test('SJF reorders shortest-first and proves the lower avg waiting 5.0', () => {
  const ev = runSchedEvidence({ processes: JOBS, policy: 'sjf' });
  // order 2,4,6,8 -> waits 0,2,6,12 -> avg 5.0
  assert.equal(ev.avgWaiting, 5);
  assert.deepEqual(ev.order, ['P3', 'P2', 'P4', 'P1']);
  // the teaching claim, PROVEN: SJF beats FCFS on average wait
  const fcfs = runSchedEvidence({ processes: JOBS, policy: 'fcfs' });
  assert.ok(ev.avgWaiting < fcfs.avgWaiting);
});

test('round-robin interleaves by quantum and every process completes', () => {
  const ev = runSchedEvidence({ processes: JOBS, policy: 'rr', quantum: 3 });
  assert.equal(ev.perProcess.length, 4);
  // total completion time equals total burst (no idle, all arrive at 0)
  const lastCompletion = Math.max(...ev.perProcess.map((p) => p.completion));
  assert.equal(lastCompletion, 8 + 4 + 2 + 6);
  for (const p of ev.perProcess) assert.ok(p.waiting >= 0);
});

test('staggered arrivals: SJF picks among only the ARRIVED jobs', () => {
  const procs = [
    { id: 'A', arrival: 0, burst: 5 },
    { id: 'B', arrival: 1, burst: 2 },
    { id: 'C', arrival: 2, burst: 1 },
  ];
  const ev = runSchedEvidence({ processes: procs, policy: 'sjf' });
  // A runs 0-5 (only one arrived at t=0), then among B,C the shorter C runs, then B
  assert.deepEqual(ev.order, ['A', 'C', 'B']);
});

test('guards reject malformed specs instead of fabricating', () => {
  assert.throws(() => runSchedEvidence({ processes: [], policy: 'fcfs' }));
  assert.throws(() => runSchedEvidence({ processes: JOBS, policy: 'rr' })); // no quantum
  assert.throws(() => runSchedEvidence({ processes: [{ id: 'X', arrival: 0, burst: 0 }], policy: 'fcfs' }));
  assert.throws(() => runSchedEvidence({ processes: JOBS, policy: 'lottery' }));
});
