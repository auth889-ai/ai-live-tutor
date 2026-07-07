'use client';

// DEV PREVIEW of the AlgorithmStage (not product content — these two traces are fixtures so you
// can scrub the clock and watch all 5 panels move in sync). The binary-search trace is the exact
// output captured from a REAL Execution Tracer run; the BFS trace is hand-authored to exercise
// the graph + queue + visited panels. In a real lesson these come from the Execution Tracer.

import { useState } from 'react';
import { AlgorithmStage } from '../../../components/course-player/panels/algorithm-stage.js';

const BINARY_SEARCH = {
  language: 'python',
  code: 'def binary_search(arr, target):\n    low = 0\n    high = len(arr) - 1\n    while low <= high:\n        mid = (low + high) // 2\n        if arr[mid] == target:\n            return mid\n        elif arr[mid] < target:\n            low = mid + 1\n        else:\n            high = mid - 1\n    return -1',
  views: { array: { values: [1, 3, 5, 7, 9, 11, 13] } },
  steps: [
    { line: 5, explanation: 'mid=(0+6)//2=3 → arr[3]=7 < target 11, discard the left half.', array: { current: 3, eliminated: [0, 1, 2, 3], pointers: { low: 0, mid: 3, high: 6 } }, variables: { low: 0, high: 6, mid: 3 } },
    { line: 5, explanation: 'mid=(4+6)//2=5 → arr[5]=11 == target 11.', array: { current: 5, eliminated: [0, 1, 2, 3], pointers: { low: 4, mid: 5, high: 6 } }, variables: { low: 4, high: 6, mid: 5 } },
    { line: 7, explanation: 'Found target 11 at index 5 — return it.', array: { current: 5, eliminated: [0, 1, 2, 3, 4] }, variables: { low: 4, high: 6, mid: 5, result: 5 } },
  ],
};

const BFS = {
  language: 'python',
  code: 'def bfs(graph, start):\n    queue = [start]\n    seen = {start}\n    while queue:\n        node = queue.pop(0)\n        for nb in graph[node]:\n            if nb not in seen:\n                seen.add(nb)\n                queue.append(nb)',
  views: {
    graph: {
      nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }, { id: 'C', label: 'C' }, { id: 'D', label: 'D' }, { id: 'E', label: 'E' }],
      edges: [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }, { from: 'B', to: 'D' }, { from: 'C', to: 'E' }],
      directed: true,
    },
  },
  steps: [
    { line: 2, explanation: 'Start at A: enqueue it and mark it seen.', graph: { current: 'A', visited: [], pointers: { node: 'A' } }, queue: ['A'], variables: { start: 'A' } },
    { line: 5, explanation: 'Dequeue A. Visit its neighbours B and C.', graph: { current: 'A', visited: [], pointers: { node: 'A' } }, queue: [], variables: { node: 'A' } },
    { line: 8, explanation: 'Enqueue B and C behind A.', graph: { current: 'A', visited: [], pointers: {} }, queue: ['B', 'C'], variables: { node: 'A' } },
    { line: 5, explanation: 'Dequeue B (front of queue). Explore its neighbour D.', graph: { current: 'B', visited: ['A'], pointers: { node: 'B' } }, queue: ['C', 'D'], variables: { node: 'B' } },
    { line: 5, explanation: 'Dequeue C. Explore its neighbour E.', graph: { current: 'C', visited: ['A', 'B'], pointers: { node: 'C' } }, queue: ['D', 'E'], variables: { node: 'C' } },
    { line: 5, explanation: 'Dequeue D — no unseen neighbours.', graph: { current: 'D', visited: ['A', 'B', 'C'], pointers: { node: 'D' } }, queue: ['E'], variables: { node: 'D' } },
    { line: 5, explanation: 'Dequeue E — queue empty, BFS done.', graph: { current: 'E', visited: ['A', 'B', 'C', 'D'], pointers: { node: 'E' } }, queue: [], variables: { node: 'E' } },
  ],
};

const SAMPLES = { 'Binary search (array)': BINARY_SEARCH, 'BFS (graph + queue)': BFS };

export default function StagePreview() {
  const [name, setName] = useState('Binary search (array)');
  const [progress, setProgress] = useState(0);
  const trace = SAMPLES[name];

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>AlgorithmStage — synced dry run</h1>
      <p style={{ color: '#8a8172', fontSize: 13, marginTop: 0 }}>
        One ExecutionTrace drives all panels. Scrub the clock to watch the code line, structure, queue, and variable table advance together.
      </p>

      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        {Object.keys(SAMPLES).map((k) => (
          <button
            key={k}
            onClick={() => { setName(k); setProgress(0); }}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid #e8ddc9',
              background: k === name ? '#d35400' : '#fffdf8',
              color: k === name ? '#fff' : '#5a4a2a',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {k}
          </button>
        ))}
      </div>

      <input type="range" min={0} max={1000} value={Math.round(progress * 1000)} onChange={(e) => setProgress(Number(e.target.value) / 1000)} style={{ width: '100%', margin: '8px 0 18px' }} />

      <AlgorithmStage trace={trace} progress={progress} />
    </div>
  );
}
