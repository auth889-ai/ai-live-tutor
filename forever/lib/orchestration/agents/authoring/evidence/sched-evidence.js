// OS SCHEDULER ENGINE — the OS field's engine=truth, PURE JS logic (no external tool). Given
// a set of processes (arrival + burst times), it SIMULATES each classic scheduling policy and
// computes the exact per-process waiting/turnaround times and the averages. So an OS lesson
// proves "SJF beats FCFS on average wait, 8.5ms -> 5ms" by RUNNING both schedulers, never by
// asserting it. Deterministic; ties broken by arrival then declaration order.
//
// Contract (AI-declared, engine-executed):
//   processes: [{ id, arrival, burst }]
//   policy:    "fcfs" | "sjf" | "rr"
//   quantum:   time slice for round-robin (required for rr)
// Returns { order, perProcess:[{id, start, completion, waiting, turnaround}], avgWaiting, avgTurnaround }

function fcfs(procs) {
  const ps = [...procs].sort((a, b) => a.arrival - b.arrival);
  let t = 0;
  const order = [];
  const per = [];
  for (const p of ps) {
    const start = Math.max(t, p.arrival);
    const completion = start + p.burst;
    per.push({ id: p.id, start, completion, waiting: start - p.arrival, turnaround: completion - p.arrival });
    order.push(p.id);
    t = completion;
  }
  return { order, per };
}

function sjf(procs) {
  // non-preemptive shortest-job-first
  const remaining = [...procs];
  let t = 0;
  const order = [];
  const per = [];
  while (remaining.length) {
    const ready = remaining.filter((p) => p.arrival <= t);
    const pool = ready.length ? ready : remaining;
    if (!ready.length) t = Math.min(...remaining.map((p) => p.arrival));
    pool.sort((a, b) => a.burst - b.burst || a.arrival - b.arrival);
    const p = pool[0];
    const start = Math.max(t, p.arrival);
    const completion = start + p.burst;
    per.push({ id: p.id, start, completion, waiting: start - p.arrival, turnaround: completion - p.arrival });
    order.push(p.id);
    t = completion;
    remaining.splice(remaining.indexOf(p), 1);
  }
  return { order, per };
}

function rr(procs, quantum) {
  const ps = [...procs].sort((a, b) => a.arrival - b.arrival);
  const rem = new Map(ps.map((p) => [p.id, p.burst]));
  const first = new Map();
  const done = new Map();
  const order = [];
  let t = ps.length ? Math.min(...ps.map((p) => p.arrival)) : 0;
  const queue = [];
  let idx = 0;
  const enqueueArrived = (upto) => { while (idx < ps.length && ps[idx].arrival <= upto) { queue.push(ps[idx]); idx += 1; } };
  enqueueArrived(t);
  while (queue.length) {
    const p = queue.shift();
    if (!first.has(p.id)) first.set(p.id, t);
    const run = Math.min(quantum, rem.get(p.id));
    order.push(p.id);
    t += run;
    rem.set(p.id, rem.get(p.id) - run);
    enqueueArrived(t);
    if (rem.get(p.id) > 0) queue.push(p);
    else done.set(p.id, t);
    if (!queue.length) { enqueueArrived(t); if (!queue.length && idx < ps.length) { t = ps[idx].arrival; enqueueArrived(t); } }
  }
  const per = ps.map((p) => {
    const completion = done.get(p.id);
    return { id: p.id, start: first.get(p.id), completion, waiting: completion - p.arrival - p.burst, turnaround: completion - p.arrival };
  });
  return { order, per };
}

export function runSchedEvidence({ processes, policy, quantum }) {
  if (!Array.isArray(processes) || !processes.length) throw new Error('sched evidence needs a non-empty processes list');
  for (const p of processes) {
    if (typeof p.id === 'undefined' || !(p.burst > 0) || !(p.arrival >= 0)) throw new Error(`invalid process ${JSON.stringify(p)} — need {id, arrival>=0, burst>0}`);
  }
  let result;
  if (policy === 'fcfs') result = fcfs(processes);
  else if (policy === 'sjf') result = sjf(processes);
  else if (policy === 'rr') {
    if (!(quantum > 0)) throw new Error('round-robin needs quantum > 0');
    result = rr(processes, quantum);
  } else throw new Error(`unknown policy: ${policy}`);

  const n = result.per.length;
  const avg = (k) => Math.round((result.per.reduce((s, p) => s + p[k], 0) / n) * 1000) / 1000;
  return { order: result.order, perProcess: result.per, avgWaiting: avg('waiting'), avgTurnaround: avg('turnaround') };
}
