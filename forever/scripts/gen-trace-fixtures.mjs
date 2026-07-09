// Generate REAL engine traces (not hand-made fixtures) for the /dev/gallery visual-verify page.
// Each entry runs an actual solution through its engine — traced engines execute real python3 —
// and the validated ExecutionTrace is written to app/dev/gallery/traces.json. The gallery page
// renders each with the real AlgorithmStage so we can SCREENSHOT and inspect every structure.
//
//   node scripts/gen-trace-fixtures.mjs      (python3 required for the traced engines)

import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { compilePointerWalk } from '../lib/execution/trace/pointer-walk/compiler.js';
import { assembleLineProgram, parseLineEvents, compileLineTrace } from '../lib/execution/trace/line-sim/compiler.js';
import { compileGraphWalk } from '../lib/execution/trace/graph-walk/compiler.js';
import { compileLinkedListTrace } from '../lib/execution/trace/linked-list/compiler.js';
import { assembleListProgram, parseListEvents } from '../lib/execution/trace/linked-list/tracker.js';
import { compileDivideConquer } from '../lib/execution/trace/divide-conquer/compiler.js';
import { assembleDivideProgram, parseDivideEvents } from '../lib/execution/trace/divide-conquer/tracker.js';
import { compileTrieTrace } from '../lib/execution/trace/trie/compiler.js';
import { assembleTrieProgram, parseTrieEvents } from '../lib/execution/trace/trie/tracker.js';
import { compileDpTable } from '../lib/execution/trace/dp-table/compiler.js';
import { assembleDpProgram, parseDpEvents } from '../lib/execution/trace/dp-table/tracker.js';
import { compileOperationsTrace } from '../lib/execution/trace/operations/compiler.js';

const py = (source) => execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 20000 });
const out = [];
const add = (name, trace) => out.push({ name, trace });

// --- trie (LC 208, apple/app) ---
{
  const code = 'class TrieNode:\n    def __init__(self):\n        self.children = {}\n        self.is_end = False\nclass Trie:\n    def __init__(self):\n        self.root = TrieNode()\n    def insert(self, word):\n        node = self.root\n        for ch in word:\n            if ch not in node.children:\n                node.children[ch] = TrieNode()\n            node = node.children[ch]\n        node.is_end = True\ntrie = Trie()\ndef demo():\n    trie.insert("cat")\n    trie.insert("car")\n    trie.insert("card")\n    trie.insert("dog")\n    return "done"';
  const payload = parseTrieEvents(py(assembleTrieProgram({ code, entry: 'demo()', root: 'trie' })));
  add('Trie — insert cat/car/card/dog', compileTrieTrace({ ...payload, code, entry: 'demo()' }));
}

// --- graph-walk (Dijkstra) ---
{
  const code = 'import heapq\ndef dijkstra(graph, start):\n    dist = {start: 0}\n    visited = set()\n    pq = [(0, start)]\n    while pq:\n        d, u = heapq.heappop(pq)\n        if u in visited:\n            continue\n        visited.add(u)\n        for v, w in graph.get(u, []):\n            nd = d + w\n            if v not in dist or nd < dist[v]:\n                dist[v] = nd\n                heapq.heappush(pq, (nd, v))\n    return dist';
  const entry = "dijkstra({'A': [('B', 4), ('C', 1)], 'C': [('B', 2), ('D', 5)], 'B': [('D', 1)]}, 'A')";
  const payload = parseLineEvents(py(assembleLineProgram({ code, entry })));
  add('Graph-walk — Dijkstra shortest paths', compileGraphWalk({
    ...payload, code, entry,
    graph: { nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }], edges: [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }, { from: 'C', to: 'B' }, { from: 'C', to: 'D' }, { from: 'B', to: 'D' }], directed: true },
    lens: { current: 'u', dist: 'dist', visited: 'visited', pq: 'pq' },
  }));
}

// --- linked list (LC 206 reverse) — the list is BUILT at module level (untraced setup) so the
// dry run shows ONLY the reverse operation, and the first traced snapshot registers nodes in
// chain order (head → tail), left to right. ---
{
  const code = 'class Node:\n    def __init__(self, val):\n        self.val = val\n        self.next = None\ndef build(vals):\n    head = None\n    for v in reversed(vals):\n        n = Node(v)\n        n.next = head\n        head = n\n    return head\nlst = build([1, 2, 3, 4])\ndef reverse(head):\n    prev = None\n    curr = head\n    while curr:\n        nxt = curr.next\n        curr.next = prev\n        prev = curr\n        curr = nxt\n    return prev';
  const entry = 'reverse(lst)';
  const payload = parseListEvents(py(assembleListProgram({ code, entry, roots: ['head', 'prev', 'curr', 'nxt'] })));
  add('Linked list — reverse', compileLinkedListTrace({ ...payload, code, entry }));
}

// --- divide & conquer (quicksort) ---
{
  const code = 'def qs(arr, low, high):\n    if low >= high:\n        return arr\n    p = arr[high]\n    i = low\n    for j in range(low, high):\n        if arr[j] < p:\n            arr[i], arr[j] = arr[j], arr[i]\n            i += 1\n    arr[i], arr[high] = arr[high], arr[i]\n    qs(arr, low, i - 1)\n    qs(arr, i + 1, high)\n    return arr';
  const entry = 'qs([5, 2, 8, 1, 9, 3], 0, 5)';
  const payload = parseDivideEvents(py(assembleDivideProgram({ code, entry, fn: 'qs', arrayVar: 'arr', loVar: 'low', hiVar: 'high' })));
  add('Divide & conquer — quicksort', compileDivideConquer({ ...payload, code, entry, fn: 'qs', pointers: ['i', 'j'] }));
}

// --- dp table (LCS) ---
{
  const code = 'def lcs(a, b):\n    dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]\n    for i in range(1, len(a) + 1):\n        for j in range(1, len(b) + 1):\n            if a[i-1] == b[j-1]:\n                dp[i][j] = dp[i-1][j-1] + 1\n            else:\n                dp[i][j] = max(dp[i-1][j], dp[i][j-1])\n    return dp[-1][-1]';
  const entry = "lcs('abcde', 'ace')";
  const payload = parseDpEvents(py(assembleDpProgram({ code, entry })));
  add('DP table — LCS', compileDpTable({ ...payload, code, entry, rowLabels: ['', 'a', 'b', 'c', 'd', 'e'], colLabels: ['', 'a', 'c', 'e'] }));
}

// --- pointer-walk (sliding window: longest substring w/o repeat) ---
{
  const code = 'def longest_unique(s):\n    seen = {}\n    left = 0\n    best = 0\n    for right in range(len(s)):\n        c = s[right]\n        if c in seen and seen[c] >= left:\n            left = seen[c] + 1\n        seen[c] = right\n        best = max(best, right - left + 1)\n    return best';
  const entry = "longest_unique('abcabcbb')";
  const arr = 'abcabcbb'.split('');
  const payload = parseLineEvents(py(assembleLineProgram({ code, entry })));
  add('Sliding window — longest unique substring', compilePointerWalk({
    ...payload, code, array: arr, pointers: ['left', 'right'], window: ['left', 'right'], examine: 'right',
  }));
}

// --- operations: stack, queue, hash map (deterministic) ---
add('Stack — push/pop (LIFO)', compileOperationsTrace({
  structure: 'stack', code: 's = []\ns.append(x)\ns.pop()\ns[-1]', lines: { push: 2, pop: 3, peek: 4 },
  ops: [{ op: 'push', value: 5 }, { op: 'push', value: 8 }, { op: 'push', value: 3 }, { op: 'pop' }, { op: 'peek' }, { op: 'pop' }],
}));
add('Queue — enqueue/dequeue (FIFO)', compileOperationsTrace({
  structure: 'queue', code: 'from collections import deque\nq = deque()\nq.append(x)\nq.popleft()', lines: { enqueue: 3, dequeue: 4 },
  ops: [{ op: 'enqueue', value: 'A' }, { op: 'enqueue', value: 'B' }, { op: 'enqueue', value: 'C' }, { op: 'dequeue' }, { op: 'dequeue' }],
}));
add('Hash map — put/get with collision', compileOperationsTrace({
  structure: 'hash_map', code: 'm = {}\nm[k] = v\nm.get(k)\ndel m[k]', buckets: 4, lines: { put: 2, get: 3, remove: 4 },
  ops: [{ op: 'put', key: 'cat', value: 1 }, { op: 'put', key: 'dog', value: 2 }, { op: 'put', key: 'act', value: 3 }, { op: 'get', key: 'act' }, { op: 'get', key: 'ghost' }],
}));

// --- LINE-SIM FLOOR examples (fit no engine — the honest "floor": real line-by-line trace) ---
{
  const code = 'def valid(s):\n    st = []\n    pairs = {")": "(", "]": "[", "}": "{"}\n    for c in s:\n        if c in pairs:\n            if not st or st.pop() != pairs[c]:\n                return False\n        else:\n            st.append(c)\n    return not st';
  const entry = 'valid("([{}])")';
  add('FLOOR: Valid Parentheses (line-sim)', compileLineTrace({ ...parseLineEvents(py(assembleLineProgram({ code, entry }))), code, entry }));
}
{
  const code = 'def kadane(a):\n    best = a[0]\n    cur = a[0]\n    for x in a[1:]:\n        cur = max(x, cur + x)\n        best = max(best, cur)\n    return best';
  const entry = 'kadane([-2, 1, -3, 4, -1, 2, 1, -5, 4])';
  add('FLOOR: Max Subarray / Kadane (line-sim)', compileLineTrace({ ...parseLineEvents(py(assembleLineProgram({ code, entry }))), code, entry }));
}

const dir = dirname(fileURLToPath(import.meta.url));
const target = join(dir, '..', 'app', 'dev', 'gallery', 'traces.json');
writeFileSync(target, JSON.stringify(out, null, 2));
// eslint-disable-next-line no-console
console.log(`wrote ${out.length} real traces -> ${target}`);
for (const { name, trace } of out) console.log(`  ${name}: ${trace.steps.length} steps, views=[${Object.keys(trace.views || {}).join(',')}]`);
