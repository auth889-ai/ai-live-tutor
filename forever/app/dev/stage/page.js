'use client';

// DEV PREVIEW of the clock-driven AlgorithmStage (not product content — these traces are
// fixtures so you can scrub the clock and watch every view type move in sync). In a real lesson
// these come from the Execution Tracer (real code run). Scrub to see: binary search (array +
// pointers), BFS (graph + queue + active edge), Fibonacci DP (2D table filling), bubble sort
// (compare/swap/sorted markers). One AlgorithmStage renders them all — one primitive.

import { useState } from 'react';
import { AlgorithmStage } from '../../../components/course-player/algorithm-stage/algorithm-stage.js';

const BINARY_SEARCH = {
  language: 'python',
  code: 'def binary_search(arr, target):\n    low, high = 0, len(arr) - 1\n    while low <= high:\n        mid = (low + high) // 2\n        if arr[mid] == target:\n            return mid\n        elif arr[mid] < target:\n            low = mid + 1\n        else:\n            high = mid - 1',
  views: { array: { values: [1, 3, 5, 7, 9, 11, 13] } },
  steps: [
    { line: 4, explanation: 'mid=3 → arr[3]=7 < 11, discard the left half.', array: { current: 3, eliminated: [0, 1, 2, 3], pointers: { low: 0, mid: 3, high: 6 } }, variables: { low: 0, high: 6, mid: 3 }, traceRow: { step: 1, low: 0, high: 6, mid: 3, 'arr[mid]': 7, decision: '7<11 → right' } },
    { line: 4, explanation: 'mid=5 → arr[5]=11 == target.', array: { current: 5, eliminated: [0, 1, 2, 3], pointers: { low: 4, mid: 5, high: 6 } }, variables: { low: 4, high: 6, mid: 5 }, traceRow: { step: 2, low: 4, high: 6, mid: 5, 'arr[mid]': 11, decision: '11==11 → found' } },
    { line: 6, explanation: 'Found target 11 at index 5.', array: { current: 5, eliminated: [0, 1, 2, 3, 4] }, variables: { result: 5 }, traceRow: { step: 3, low: 4, high: 6, mid: 5, 'arr[mid]': 11, decision: 'return 5' } },
  ],
};

const BFS = {
  language: 'python',
  code: 'def bfs(graph, start):\n    queue = [start]\n    seen = {start}\n    while queue:\n        node = queue.pop(0)\n        for nb in graph[node]:\n            if nb not in seen:\n                seen.add(nb); queue.append(nb)',
  views: { graph: { nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }, { id: 'C', label: 'C' }, { id: 'D', label: 'D' }, { id: 'E', label: 'E' }], edges: [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }, { from: 'B', to: 'D' }, { from: 'C', to: 'E' }], directed: true } },
  steps: [
    { line: 2, explanation: 'Start at A: enqueue, mark seen.', graph: { current: 'A', visited: [] }, queue: ['A'], traceRow: { step: 1, node: 'A', queue: '[A]' } },
    { line: 5, explanation: 'Dequeue A; walk edge A→B.', graph: { current: 'B', visited: ['A'] }, activeEdge: ['A', 'B'], queue: ['C', 'B'], traceRow: { step: 2, node: 'A', queue: '[C,B]' } },
    { line: 5, explanation: 'Dequeue B; walk edge B→D.', graph: { current: 'D', visited: ['A', 'B'] }, activeEdge: ['B', 'D'], queue: ['C', 'D'], traceRow: { step: 3, node: 'B', queue: '[C,D]' } },
    { line: 5, explanation: 'Dequeue C; walk edge C→E.', graph: { current: 'E', visited: ['A', 'B', 'C'] }, activeEdge: ['C', 'E'], queue: ['D', 'E'], traceRow: { step: 4, node: 'C', queue: '[D,E]' } },
  ],
};

const DP_FIB = {
  language: 'python',
  code: 'def fib(n):\n    dp = [0, 1]\n    for i in range(2, n + 1):\n        dp.append(dp[i-1] + dp[i-2])\n    return dp[n]',
  views: { array2d: { rows: 1, cols: 7, colLabels: ['0', '1', '2', '3', '4', '5', '6'] } },
  steps: [
    { line: 2, explanation: 'Base cases: dp[0]=0, dp[1]=1.', array2d: { filled: [], highlight: [], values: [[0, 0, 0], [0, 1, 1]], current: [0, 1] }, traceRow: { i: 1, 'dp[i]': 1 } },
    { line: 4, explanation: 'dp[2] = dp[1]+dp[0] = 1.', array2d: { current: [0, 2], filled: [[0, 0], [0, 1]], highlight: [[0, 0], [0, 1]], values: [[0, 2, 1]] }, traceRow: { i: 2, 'dp[i]': 1 } },
    { line: 4, explanation: 'dp[3] = dp[2]+dp[1] = 2.', array2d: { current: [0, 3], filled: [[0, 0], [0, 1], [0, 2]], highlight: [[0, 1], [0, 2]], values: [[0, 3, 2]] }, traceRow: { i: 3, 'dp[i]': 2 } },
    { line: 4, explanation: 'dp[4] = dp[3]+dp[2] = 3.', array2d: { current: [0, 4], filled: [[0, 0], [0, 1], [0, 2], [0, 3]], highlight: [[0, 2], [0, 3]], values: [[0, 4, 3]] }, traceRow: { i: 4, 'dp[i]': 3 } },
    { line: 4, explanation: 'dp[5] = dp[4]+dp[3] = 5.', array2d: { current: [0, 5], filled: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], highlight: [[0, 3], [0, 4]], values: [[0, 5, 5]] }, traceRow: { i: 5, 'dp[i]': 5 } },
    { line: 4, explanation: 'dp[6] = dp[5]+dp[4] = 8.', array2d: { current: [0, 6], filled: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5]], highlight: [[0, 4], [0, 5]], values: [[0, 6, 8]] }, traceRow: { i: 6, 'dp[i]': 8 } },
  ],
};

const SORT = {
  language: 'python',
  code: 'for i in range(n):\n    for j in range(0, n-i-1):\n        if a[j] > a[j+1]:\n            a[j], a[j+1] = a[j+1], a[j]',
  views: { array: { values: [5, 2, 8, 1, 9, 3] } },
  steps: [
    { line: 3, explanation: 'Compare 5 and 2 → out of order, swap.', array: { comparing: [0, 1], swapped: [0, 1] }, traceRow: { i: 0, j: 0, action: 'swap 5,2' } },
    { line: 3, explanation: 'Compare 5 and 8 → in order.', array: { comparing: [1, 2] }, traceRow: { i: 0, j: 1, action: 'ok' } },
    { line: 3, explanation: 'Compare 8 and 1 → swap.', array: { comparing: [2, 3], swapped: [2, 3] }, traceRow: { i: 0, j: 2, action: 'swap 8,1' } },
    { line: 4, explanation: 'Largest (9) bubbled to the end — locked.', array: { sorted: [5], comparing: [3, 4] }, traceRow: { i: 0, j: 4, action: '9 locked' } },
  ],
};

const SAMPLES = { 'Binary search (array)': BINARY_SEARCH, 'BFS (graph + queue + edge)': BFS, 'Fibonacci DP (2D table)': DP_FIB, 'Bubble sort (compare/swap)': SORT };

export default function StagePreview() {
  const [name, setName] = useState('BFS (graph + queue + edge)');
  const [progress, setProgress] = useState(0.85); // dev default lands on the richest view
  const trace = SAMPLES[name];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>AlgorithmStage — one primitive, every algorithm</h1>
      <p style={{ color: '#8a8172', fontSize: 13, marginTop: 0 }}>
        One ExecutionTrace drives all panels. Scrub the clock to watch the code line, structure, pointers, queue, DP table and trace table advance together.
      </p>

      <div style={{ display: 'flex', gap: 8, margin: '12px 0', flexWrap: 'wrap' }}>
        {Object.keys(SAMPLES).map((k) => (
          <button key={k} onClick={() => { setName(k); setProgress(0); }} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #e8ddc9', background: k === name ? '#d35400' : '#fffdf8', color: k === name ? '#fff' : '#5a4a2a', cursor: 'pointer', fontSize: 13 }}>
            {k}
          </button>
        ))}
      </div>

      <input type="range" min={0} max={1000} value={Math.round(progress * 1000)} onChange={(e) => setProgress(Number(e.target.value) / 1000)} style={{ width: '100%', margin: '8px 0 18px' }} />

      <AlgorithmStage trace={trace} progress={progress} />
    </div>
  );
}
