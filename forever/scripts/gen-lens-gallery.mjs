// Lens gallery generator: run ONE representative problem per pattern family through the REAL
// universal engine (local python3, zero AI tokens) and save the traces for /dev/lenses —
// so every family's cockpit rendering can be LOOKED AT, not assumed. (BFS/grid already
// screenshot-verified via full lessons; this covers the rest cheaply.)
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { traceUniversal } from '../lib/execution/trace/universal/trace.js';

const exec = async ({ source }) => {
  try { return { stdout: execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15000 }), stderr: '', timedOut: false }; }
  catch (e) { return { stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? e.message), timedOut: false }; }
};

const PROBLEMS = [
  ['binary-search (pointer-array)', `def bsearch(a, t):
    lo, hi = 0, len(a) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if a[mid] == t: return mid
        if a[mid] < t: lo = mid + 1
        else: hi = mid - 1
    return -1`, 'bsearch([2, 5, 8, 12, 16, 23, 38, 56, 72], 23)'],
  ['climbing-stairs (dp-table)', `def climb(n):
    dp = [0] * (n + 1)
    dp[0] = 1
    dp[1] = 1
    for i in range(2, n + 1):
        dp[i] = dp[i - 1] + dp[i - 2]
    return dp[n]`, 'climb(8)'],
  ['kth-largest (heap)', `import heapq
def kth_largest(nums, k):
    heap = []
    for x in nums:
        heapq.heappush(heap, x)
        if len(heap) > k:
            heapq.heappop(heap)
    return heap[0]`, 'kth_largest([3, 2, 1, 5, 6, 4], 2)'],
  ['reverse-list (linked-list)', `class ListNode:
    def __init__(self, val):
        self.val = val
        self.next = None

def build(vals):
    head = None
    for v in reversed(vals):
        node = ListNode(v)
        node.next = head
        head = node
    return head

def reverse(head):
    prev = None
    curr = head
    while curr:
        nxt = curr.next
        curr.next = prev
        prev = curr
        curr = nxt
    return prev

lst = build([1, 2, 3, 4, 5])`, 'reverse(lst)'],
  ['trie-insert (trie-dict)', `def build_trie(words):
    root = {}
    for word in words:
        node = root
        for ch in word:
            if ch not in node:
                node[ch] = {}
            node = node[ch]
        node['$'] = True
    return root`, "build_trie(['cat', 'car', 'dog'])"],
  ['merge-intervals (intervals)', `def merge(intervals):
    intervals.sort()
    out = [intervals[0]]
    for lo, hi in intervals[1:]:
        if lo <= out[-1][1]:
            out[-1][1] = max(out[-1][1], hi)
        else:
            out.append([lo, hi])
    return out`, 'merge([[1, 3], [2, 6], [8, 10], [15, 18]])'],
  ['merge-sort (divide-conquer)', `def msort(a, lo, hi):
    if hi - lo <= 1: return
    mid = (lo + hi) // 2
    msort(a, lo, mid)
    msort(a, mid, hi)
    merged = []
    i, j = lo, mid
    while i < mid and j < hi:
        if a[i] <= a[j]: merged.append(a[i]); i += 1
        else: merged.append(a[j]); j += 1
    merged.extend(a[i:mid]); merged.extend(a[j:hi])
    a[lo:hi] = merged

arr = [38, 27, 43, 3, 9, 82, 10]`, 'msort(arr, 0, 7)'],
  ['union-find (union-find)', `def find(parent, x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x

def count_components(n, edges):
    parent = list(range(n))
    count = n
    for a, b in edges:
        ra, rb = find(parent, a), find(parent, b)
        if ra != rb:
            parent[ra] = rb
            count -= 1
    return count`, 'count_components(5, [[0, 1], [1, 2], [3, 4]])'],
  ['dijkstra (weighted graph + distances)', `import heapq
def dijkstra(adj, src):
    dist = {v: float('inf') for v in adj}
    dist[src] = 0
    heap = [(0, src)]
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist[u]:
            continue
        for v, w in adj[u]:
            if d + w < dist[v]:
                dist[v] = d + w
                heapq.heappush(heap, (dist[v], v))
    return dist

g = {"A": [("B", 4), ("C", 1)], "B": [("D", 1)], "C": [("B", 2), ("D", 5)], "D": []}`, "dijkstra(g, 'A')"],
  ['LCS (2-D dp-table)', `def lcs(a, b):
    m, n = len(a), len(b)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if a[i - 1] == b[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])
    return dp[m][n]`, "lcs('ace', 'abcde')"],
  ['rotting-oranges (multi-source grid BFS, LC994)', `from collections import deque
def oranges(grid):
    rows, cols = len(grid), len(grid[0])
    queue = deque()
    fresh = 0
    for r in range(rows):
        for c in range(cols):
            if grid[r][c] == 2: queue.append((r, c, 0))
            elif grid[r][c] == 1: fresh += 1
    minutes = 0
    while queue:
        r, c, t = queue.popleft()
        minutes = max(minutes, t)
        for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] == 1:
                grid[nr][nc] = 2
                fresh -= 1
                queue.append((nr, nc, t + 1))
    return minutes if fresh == 0 else -1

g = [[2,1,1],[1,1,0],[0,1,1]]`, 'oranges(g)'],
  ['bellman-ford (LC787-style relaxation)', `def bellman(n, edges, src):
    dist = [float('inf')] * n
    dist[src] = 0
    for _ in range(n - 1):
        for u, v, w in edges:
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
    return dist`, 'bellman(4, [[0,1,4],[0,2,1],[2,1,2],[1,3,1],[2,3,6]], 0)'],
  ['01-bfs (deque, weighted 0/1 edges)', `from collections import deque
def zero_one_bfs(adj, src, n):
    dist = [float('inf')] * n
    dist[src] = 0
    dq = deque([src])
    while dq:
        u = dq.popleft()
        for v, w in adj[u]:
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                if w == 0: dq.appendleft(v)
                else: dq.append(v)
    return dist

graph = {0: [(1, 0), (2, 1)], 1: [(3, 1)], 2: [(3, 0)], 3: []}`, 'zero_one_bfs(graph, 0, 4)'],
];

const gallery = [];
for (const [name, code, entry] of PROBLEMS) {
  try {
    const { trace, lens } = await traceUniversal({ code, entry, exec });
    gallery.push({ name, lens, trace });
    console.log('✓', name, '→', lens, '·', trace.steps.length, 'steps');
  } catch (err) {
    gallery.push({ name, lens: 'ERROR', error: String(err.message) });
    console.log('✖', name, '→', String(err.message).slice(0, 80));
  }
}
await writeFile('app/dev/lenses/gallery.json', JSON.stringify(gallery, null, 1));
console.log('saved app/dev/lenses/gallery.json');
