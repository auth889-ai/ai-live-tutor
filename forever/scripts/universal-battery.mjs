// THE 50-PROBLEM BATTERY — the universal dry-run engine's measured coverage across the whole
// LeetCode taxonomy (graph section = Striver's own teaching set). Every problem runs BLIND:
// real python3 execution, structure detected from the recording, no per-problem code anywhere.
//
//   node scripts/universal-battery.mjs        (python3 required)
//
// Output: one row per problem (lens, steps, gate) and the summary that IS the product metric:
// structural-elite %, floor %, error %. Also the regression harness: run it after every
// detector change — a lens that regresses shows up as a moved row, not a hunch.

import { execFileSync } from 'node:child_process';

import { traceUniversal } from '../lib/execution/trace/universal/trace.js';
import { dryRunQualityIssue } from '../lib/orchestration/agents/coding/execution-tracer.js';

const exec = async ({ source }) => {
  try {
    return { stdout: execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15_000 }), stderr: '', timedOut: false };
  } catch (err) {
    return { stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? err.message), timedOut: false };
  }
};

const LIST_PRELUDE = `class ListNode:
    def __init__(self, val):
        self.val = val
        self.next = None
def build(vals):
    head = ListNode(vals[0])
    node = head
    for v in vals[1:]:
        node.next = ListNode(v)
        node = node.next
    return head`;

const TREE_PRELUDE = `class TreeNode:
    def __init__(self, val):
        self.val = val
        self.left = None
        self.right = None
def build():
    r = TreeNode(5)
    r.left = TreeNode(3)
    r.right = TreeNode(8)
    r.left.left = TreeNode(1)
    r.left.right = TreeNode(4)
    return r
tree = build()`;

const PROBLEMS = [
  // ——— arrays / two pointers / sliding window ———
  ['arrays', 'LC53 class-Solution Kadane (LC submission shape)', `class Solution:
    def maxSubArray(self, nums):
        best = nums[0]
        cur = nums[0]
        for i in range(1, len(nums)):
            cur = max(nums[i], cur + nums[i])
            best = max(best, cur)
        return best

sol = Solution()`, 'sol.maxSubArray([-2, 1, -3, 4, -1, 2, 1, -5, 4])'],
  ['arrays', 'LC704 Binary Search', `def bs(arr, t):
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == t:
            return mid
        if arr[mid] < t:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1`, 'bs([1,3,5,7,9,11], 9)'],
  ['arrays', 'LC167 Two Sum II (sorted)', `def two_sum(arr, t):
    l, r = 0, len(arr) - 1
    while l < r:
        s = arr[l] + arr[r]
        if s == t:
            return [l, r]
        if s < t:
            l += 1
        else:
            r -= 1
    return []`, 'two_sum([1,3,4,6,8], 10)'],
  ['arrays', 'LC125 Valid Palindrome', `def pal(chars):
    l, r = 0, len(chars) - 1
    while l < r:
        if chars[l] != chars[r]:
            return False
        l += 1
        r -= 1
    return True`, "pal(['r','a','c','e','c','a','r'])"],
  ['arrays', 'LC344 Reverse String (in place)', `def rev(chars):
    l, r = 0, len(chars) - 1
    while l < r:
        chars[l], chars[r] = chars[r], chars[l]
        l += 1
        r -= 1
    return chars`, "rev(['h','e','l','l','o'])"],
  ['arrays', 'LC209 Min Size Subarray Sum', `def min_len(arr, target):
    l = 0
    total = 0
    best = 0
    for r in range(len(arr)):
        total += arr[r]
        while total >= target:
            width = r - l + 1
            if best == 0 or width < best:
                best = width
            total -= arr[l]
            l += 1
    return best`, 'min_len([2,3,1,2,4,3], 7)'],
  ['arrays', 'LC53 Max Subarray (Kadane)', `def kad(arr):
    best = arr[0]
    cur = arr[0]
    for i in range(1, len(arr)):
        cur = max(arr[i], cur + arr[i])
        best = max(best, cur)
    return best`, 'kad([-2,1,-3,4,-1,2,1])'],
  ['arrays', 'LC283 Move Zeroes', `def move(arr):
    l = 0
    for r in range(len(arr)):
        if arr[r] != 0:
            arr[l], arr[r] = arr[r], arr[l]
            l += 1
    return arr`, 'move([0,1,0,3,12])'],
  ['arrays', 'LC121 Buy and Sell Stock', `def profit(prices):
    best = 0
    low = prices[0]
    for i in range(1, len(prices)):
        if prices[i] < low:
            low = prices[i]
        elif prices[i] - low > best:
            best = prices[i] - low
    return best`, 'profit([7,1,5,3,6,4])'],

  // ——— stacks / queues / hash maps ———
  ['collections', 'LC20 Valid Parentheses', `def valid(s):
    st = []
    pairs = {')': '(', ']': '[', '}': '{'}
    for ch in s:
        if ch in pairs:
            if not st or st.pop() != pairs[ch]:
                return False
        else:
            st.append(ch)
    return len(st) == 0`, "valid('([])')"],
  ['collections', 'LC739 Daily Temperatures (monotonic)', `def temps(t):
    res = [0] * len(t)
    st = []
    for i in range(len(t)):
        while st and t[i] > t[st[-1]]:
            j = st.pop()
            res[j] = i - j
        st.append(i)
    return res`, 'temps([73,74,75,71,76])'],
  ['collections', 'Character Frequency Counter', `def freq(s):
    counts = {}
    for ch in s:
        if ch in counts:
            counts[ch] = counts[ch] + 1
        else:
            counts[ch] = 1
    return counts`, "freq('abcab')"],
  ['collections', 'Task Queue Simulation', `from collections import deque
def process(tasks):
    q = deque()
    for t in tasks:
        q.append(t)
    done = []
    while q:
        done.append(q.popleft())
    return done`, "process(['a','b','c'])"],
  ['collections', 'LC1 Two Sum (hash map)', `def two_sum(arr, t):
    seen = {}
    for i in range(len(arr)):
        need = t - arr[i]
        if need in seen:
            return [seen[need], i]
        seen[arr[i]] = i
    return []`, 'two_sum([2,7,11,15], 18)'],

  // ——— linked lists ———
  ['linked-list', 'LC206 Reverse Linked List', `${LIST_PRELUDE}
def reverseList(head):
    prev = None
    curr = head
    while curr:
        nxt = curr.next
        curr.next = prev
        prev = curr
        curr = nxt
    return prev
lst = build([1, 2, 3])`, 'reverseList(lst)'],
  ['linked-list', 'LC876 Middle of List (slow/fast)', `${LIST_PRELUDE}
def middle(head):
    slow = head
    fast = head
    while fast and fast.next:
        slow = slow.next
        fast = fast.next.next
    return slow
lst = build([1, 2, 3, 4, 5])`, 'middle(lst)'],
  ['linked-list', 'LC141 Cycle Detection (Floyd)', `${LIST_PRELUDE}
def hasCycle(head):
    slow = head
    fast = head
    while fast and fast.next:
        slow = slow.next
        fast = fast.next.next
        if slow is fast:
            return True
    return False
lst = build([1, 2, 3])
lst.next.next.next = lst.next`, 'hasCycle(lst)'],
  ['linked-list', 'LC21 Merge Two Sorted Lists', `${LIST_PRELUDE}
def merge(a, b):
    dummy = ListNode(0)
    tail = dummy
    while a and b:
        if a.val <= b.val:
            tail.next = a
            a = a.next
        else:
            tail.next = b
            b = b.next
        tail = tail.next
    tail.next = a if a else b
    return dummy.next
l1 = build([1, 3])
l2 = build([2, 4])`, 'merge(l1, l2)'],

  // ——— trees ———
  ['trees', 'LC94 Inorder Traversal', `${TREE_PRELUDE}
def inorder(node, out):
    if node is None:
        return out
    inorder(node.left, out)
    out.append(node.val)
    inorder(node.right, out)
    return out`, 'inorder(tree, [])'],
  ['trees', 'LC226 Invert Binary Tree', `${TREE_PRELUDE}
def invert(node):
    if node is None:
        return None
    node.left, node.right = invert(node.right), invert(node.left)
    return node`, 'invert(tree)'],
  ['trees', 'LC104 Maximum Depth', `${TREE_PRELUDE}
def depth(node):
    if node is None:
        return 0
    return 1 + max(depth(node.left), depth(node.right))`, 'depth(tree)'],
  ['trees', 'LC700 Search in a BST', `${TREE_PRELUDE}
def search(root, val):
    node = root
    while node:
        if node.val == val:
            return node
        node = node.left if val < node.val else node.right
    return None`, 'search(tree, 4)'],
  ['trees', 'LC102 Level Order Traversal', `${TREE_PRELUDE}
from collections import deque
def levels(root):
    q = deque([root])
    out = []
    while q:
        node = q.popleft()
        out.append(node.val)
        if node.left:
            q.append(node.left)
        if node.right:
            q.append(node.right)
    return out`, 'levels(tree)'],

  // ——— recursion / backtracking ———
  ['dp', 'TSP bitmask DP (read-into-temp idiom)', `def tsp(dist):
    n = len(dist)
    dp = [[10 ** 9] * n for _ in range(1 << n)]
    dp[1][0] = 0
    for mask in range(1, 1 << n):
        for u in range(n):
            if not (mask >> u) & 1:
                continue
            if dp[mask][u] >= 10 ** 9:
                continue
            for v in range(n):
                if (mask >> v) & 1:
                    continue
                nm = mask | (1 << v)
                nd = dp[mask][u] + dist[u][v]
                if nd < dp[nm][v]:
                    dp[nm][v] = nd
    return min(dp[(1 << n) - 1][u] + dist[u][0] for u in range(n))`, 'tsp([[0, 2, 9], [2, 0, 6], [9, 6, 0]])'],
  ['recursion', 'LC78 Subsets (closure backtracking)', `def subsets(nums):
    result = []
    path = []

    def search(index):
        result.append(path[:])
        for i in range(index, len(nums)):
            path.append(nums[i])
            search(i + 1)
            path.pop()

    search(0)
    return result`, 'subsets([1, 2, 3])'],
  ['recursion', 'LC509 Fibonacci (naive)', `def fib(n):
    if n <= 1:
        return n
    return fib(n - 1) + fib(n - 2)`, 'fib(4)'],
  ['recursion', 'LC78 Subsets (pick / not pick)', `def subs(i, cur, arr, out):
    if i == len(arr):
        out.append(list(cur))
        return
    cur.append(arr[i])
    subs(i + 1, cur, arr, out)
    cur.pop()
    subs(i + 1, cur, arr, out)
out = []`, 'subs(0, [], [1, 2], out)'],
  ['recursion', 'LC39 Combination Sum', `def comb(i, cur, cands, target, out):
    if target == 0:
        out.append(list(cur))
        return
    if i == len(cands) or target < 0:
        return
    cur.append(cands[i])
    comb(i, cur, cands, target - cands[i], out)
    cur.pop()
    comb(i + 1, cur, cands, target, out)
out = []`, 'comb(0, [], [1, 2], 3, out)'],
  ['recursion', 'Fibonacci with memo (hits pruned)', `memo = {}
def fib(n):
    if n in memo:
        return memo[n]
    if n <= 1:
        return n
    memo[n] = fib(n - 1) + fib(n - 2)
    return memo[n]`, 'fib(5)'],
  ['recursion', 'LC46 Permutations', `def perm(cur, rest, out):
    if not rest:
        out.append(list(cur))
        return
    for i in range(len(rest)):
        cur.append(rest[i])
        perm(cur, rest[:i] + rest[i+1:], out)
        cur.pop()
out = []`, 'perm([], [1, 2], out)'],

  // ——— grids ———
  ['grids', 'LC994 Rotten Oranges (G-10)', `from collections import deque
def rot(grid):
    R, C = len(grid), len(grid[0])
    q = deque()
    for r in range(R):
        for c in range(C):
            if grid[r][c] == 2:
                q.append((r, c))
    mins = 0
    while q:
        for _ in range(len(q)):
            r, c = q.popleft()
            for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):
                nr, nc = r + dr, c + dc
                if 0 <= nr < R and 0 <= nc < C and grid[nr][nc] == 1:
                    grid[nr][nc] = 2
                    q.append((nr, nc))
        if q:
            mins += 1
    return mins`, 'rot([[2,1],[1,1]])'],
  ['grids', 'LC200 Number of Islands (G-8)', `def islands(grid):
    R, C = len(grid), len(grid[0])
    def sink(r, c):
        if r < 0 or r >= R or c < 0 or c >= C or grid[r][c] == 0:
            return
        grid[r][c] = 0
        sink(r + 1, c)
        sink(r - 1, c)
        sink(r, c + 1)
        sink(r, c - 1)
    n = 0
    for r in range(R):
        for c in range(C):
            if grid[r][c] == 1:
                n += 1
                sink(r, c)
    return n`, 'islands([[1,1,0],[0,1,0],[0,0,1]])'],
  ['grids', 'LC733 Flood Fill', `def fill(grid, r, c, color):
    old = grid[r][c]
    if old == color:
        return grid
    def go(r, c):
        if r < 0 or r >= len(grid) or c < 0 or c >= len(grid[0]) or grid[r][c] != old:
            return
        grid[r][c] = color
        go(r + 1, c)
        go(r - 1, c)
        go(r, c + 1)
        go(r, c - 1)
    go(r, c)
    return grid`, 'fill([[1,1,1],[1,1,0],[1,0,1]], 1, 1, 2)'],
  ['grids', 'LC130 Surrounded Regions (G-14)', `def solve(board):
    R, C = len(board), len(board[0])
    def keep(r, c):
        if r < 0 or r >= R or c < 0 or c >= C or board[r][c] != 1:
            return
        board[r][c] = 2
        keep(r + 1, c)
        keep(r - 1, c)
        keep(r, c + 1)
        keep(r, c - 1)
    for r in range(R):
        keep(r, 0)
        keep(r, C - 1)
    for c in range(C):
        keep(0, c)
        keep(R - 1, c)
    for r in range(R):
        for c in range(C):
            if board[r][c] == 1:
                board[r][c] = 0
            elif board[r][c] == 2:
                board[r][c] = 1
    return board`, 'solve([[0,1,0],[1,1,1],[0,1,0]])'],
  ['grids', 'LC542 0/1 Matrix (G-13)', `from collections import deque
def dist01(grid):
    R, C = len(grid), len(grid[0])
    dist = [[-1] * C for _ in range(R)]
    q = deque()
    for r in range(R):
        for c in range(C):
            if grid[r][c] == 0:
                dist[r][c] = 0
                q.append((r, c))
    while q:
        r, c = q.popleft()
        for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < R and 0 <= nc < C and dist[nr][nc] == -1:
                dist[nr][nc] = dist[r][c] + 1
                q.append((nr, nc))
    return dist`, 'dist01([[0,0,0],[0,1,0],[1,1,1]])'],
  ['grids', 'LC1020 Number of Enclaves (G-15)', `def enclaves(grid):
    R, C = len(grid), len(grid[0])
    def drain(r, c):
        if r < 0 or r >= R or c < 0 or c >= C or grid[r][c] != 1:
            return
        grid[r][c] = 0
        drain(r + 1, c)
        drain(r - 1, c)
        drain(r, c + 1)
        drain(r, c - 1)
    for r in range(R):
        drain(r, 0)
        drain(r, C - 1)
    for c in range(C):
        drain(0, c)
        drain(R - 1, c)
    return sum(sum(row) for row in grid)`, 'enclaves([[0,0,0],[1,0,1],[0,1,1]])'],

  // ——— dynamic programming ———
  ['dp', 'LC1143 Longest Common Subsequence', `def lcs(a, b):
    dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            if a[i-1] == b[j-1]:
                dp[i][j] = dp[i-1][j-1] + 1
            else:
                dp[i][j] = max(dp[i-1][j], dp[i][j-1])
    return dp[len(a)][len(b)]`, "lcs('abc', 'bc')"],
  ['dp', 'LC62 Unique Paths', `def paths(m, n):
    dp = [[0] * n for _ in range(m)]
    for r in range(m):
        for c in range(n):
            if r == 0 or c == 0:
                dp[r][c] = 1
            else:
                dp[r][c] = dp[r-1][c] + dp[r][c-1]
    return dp[m-1][n-1]`, 'paths(3, 3)'],
  ['dp', 'LC64 Min Path Sum', `def min_path(grid):
    R, C = len(grid), len(grid[0])
    dp = [[0] * C for _ in range(R)]
    for r in range(R):
        for c in range(C):
            if r == 0 and c == 0:
                dp[r][c] = grid[r][c]
            elif r == 0:
                dp[r][c] = dp[r][c-1] + grid[r][c]
            elif c == 0:
                dp[r][c] = dp[r-1][c] + grid[r][c]
            else:
                dp[r][c] = min(dp[r-1][c], dp[r][c-1]) + grid[r][c]
    return dp[R-1][C-1]`, 'min_path([[1,3,1],[1,5,1],[4,2,1]])'],
  ['dp', 'LC72 Edit Distance', `def edit(a, b):
    dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(1, len(a) + 1):
        dp[i][0] = i
    for j in range(1, len(b) + 1):
        dp[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            if a[i-1] == b[j-1]:
                dp[i][j] = dp[i-1][j-1]
            else:
                dp[i][j] = 1 + min(dp[i-1][j-1], dp[i-1][j], dp[i][j-1])
    return dp[len(a)][len(b)]`, "edit('ab', 'ba')"],
  ['dp', 'LC118 Pascal Triangle (growing)', `def pascal(n):
    tri = []
    for r in range(n):
        row = [1] * (r + 1)
        for c in range(1, r):
            row[c] = tri[r-1][c-1] + tri[r-1][c]
        tri.append(row)
    return tri`, 'pascal(4)'],
  ['dp', 'LC70 Climbing Stairs (1D dp)', `def climb(n):
    dp = [0] * (n + 1)
    dp[0] = 1
    dp[1] = 1
    for i in range(2, n + 1):
        dp[i] = dp[i-1] + dp[i-2]
    return dp[n]`, 'climb(5)'],

  // ——— graphs (the Striver section) ———
  ['graphs', 'G-7 Number of Provinces', `def provinces(adj):
    visited = []
    def dfs(node):
        visited.append(node)
        for nb in adj[node]:
            if nb not in visited:
                dfs(nb)
    n = 0
    for node in adj:
        if node not in visited:
            n += 1
            dfs(node)
    return n
g = {'A': ['B'], 'B': ['A'], 'C': []}`, 'provinces(g)'],
  ['graphs', 'G-6 BFS Traversal', `from collections import deque
def bfs(adj, start):
    visited = [start]
    q = deque([start])
    order = []
    while q:
        u = q.popleft()
        order.append(u)
        for v in adj[u]:
            if v not in visited:
                visited.append(v)
                q.append(v)
    return order
g = {'A': ['B', 'C'], 'B': ['A', 'D'], 'C': ['A'], 'D': ['B']}`, "bfs(g, 'A')"],
  ['graphs', 'G-5 DFS Traversal (recursive)', `def dfs_all(adj, start):
    visited = []
    def dfs(node):
        visited.append(node)
        for nb in adj[node]:
            if nb not in visited:
                dfs(nb)
    dfs(start)
    return visited
g = {'A': ['B', 'C'], 'B': ['A'], 'C': ['A', 'D'], 'D': ['C']}`, "dfs_all(g, 'A')"],
  ['graphs', 'G-17 Bipartite Check (BFS)', `from collections import deque
def bipartite(adj):
    color = {}
    for start in adj:
        if start in color:
            continue
        color[start] = 0
        q = deque([start])
        while q:
            u = q.popleft()
            for v in adj[u]:
                if v not in color:
                    color[v] = 1 - color[u]
                    q.append(v)
                elif color[v] == color[u]:
                    return False
    return True
g = {'A': ['B', 'C'], 'B': ['A'], 'C': ['A']}`, 'bipartite(g)'],
  ['graphs', 'G-19 Cycle in Directed Graph (DFS)', `def has_cycle(adj):
    state = {}
    def dfs(node):
        state[node] = 1
        for nb in adj[node]:
            if state.get(nb) == 1:
                return True
            if state.get(nb) is None and dfs(nb):
                return True
        state[node] = 2
        return False
    for node in adj:
        if state.get(node) is None and dfs(node):
            return True
    return False
g = {'A': ['B'], 'B': ['C'], 'C': ['A']}`, 'has_cycle(g)'],
  ['graphs', 'G-21 Topological Sort (DFS)', `def topo(adj):
    visited = []
    order = []
    def dfs(node):
        visited.append(node)
        for nb in adj[node]:
            if nb not in visited:
                dfs(nb)
        order.append(node)
    for node in adj:
        if node not in visited:
            dfs(node)
    order.reverse()
    return order
g = {'A': ['B', 'C'], 'B': ['D'], 'C': ['D'], 'D': []}`, 'topo(g)'],
  ['graphs', 'G-24 Course Schedule (Kahn)', `from collections import deque
def can_finish(n, pres):
    adj = {i: [] for i in range(n)}
    indeg = [0] * n
    for a, b in pres:
        adj[b].append(a)
        indeg[a] += 1
    q = deque(i for i in range(n) if indeg[i] == 0)
    done = 0
    while q:
        u = q.popleft()
        done += 1
        for v in adj[u]:
            indeg[v] -= 1
            if indeg[v] == 0:
                q.append(v)
    return done == n`, 'can_finish(3, [[1, 0], [2, 1]])'],
  ['graphs', 'LC1192 Critical Connections (Tarjan)', `def critical_connections(n, connections):
    adj = {i: [] for i in range(n)}
    for u, v in connections:
        adj[u].append(v)
        adj[v].append(u)
    disc = [-1] * n
    low = [-1] * n
    bridges = []
    time = [0]
    def dfs(u, parent):
        disc[u] = low[u] = time[0]
        time[0] += 1
        for v in adj[u]:
            if disc[v] == -1:
                dfs(v, u)
                low[u] = min(low[u], low[v])
                if low[v] > disc[u]:
                    bridges.append([u, v])
            elif v != parent:
                low[u] = min(low[u], disc[v])
    dfs(0, -1)
    return bridges`, 'critical_connections(8, [[0,1],[1,2],[2,0],[2,5],[5,3],[3,4],[4,5],[5,6],[6,7],[6,5]])'],
  ['graphs', 'Prim MST (key relaxation, in_mst)', `import heapq
def prim(n, edges):
    adj = {i: [] for i in range(n)}
    for u, v, w in edges:
        adj[u].append((v, w))
        adj[v].append((u, w))
    in_mst = [0] * n
    key = [10**9] * n
    key[0] = 0
    pq = [(0, 0)]
    total = 0
    while pq:
        k, u = heapq.heappop(pq)
        if in_mst[u]:
            continue
        in_mst[u] = 1
        total += k
        for v, w in adj[u]:
            if not in_mst[v] and w < key[v]:
                key[v] = w
                heapq.heappush(pq, (w, v))
    return total`, 'prim(5, [[0,1,2],[0,3,6],[1,2,3],[1,3,8],[1,4,5],[2,4,7],[3,4,9]])'],
  ['graphs', 'LC332 Reconstruct Itinerary (Hierholzer, edge-consuming)', `def find_itinerary(tickets):
    adj = {}
    for a, b in sorted(tickets, reverse=True):
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, [])
    route = []
    stack = ['JFK']
    while stack:
        u = stack[-1]
        if adj[u]:
            stack.append(adj[u].pop())
        else:
            route.append(stack.pop())
    return route[::-1]`, "find_itinerary([['MUC','LHR'],['JFK','MUC'],['SFO','SJC'],['LHR','SFO']])"],
  ['graphs', 'G-25 Eventual Safe States (BFS)', `from collections import deque
def safe_nodes(adj):
    rev = {u: [] for u in adj}
    outdeg = {}
    for u in adj:
        outdeg[u] = len(adj[u])
        for v in adj[u]:
            rev[v].append(u)
    q = deque(u for u in adj if outdeg[u] == 0)
    safe = []
    while q:
        u = q.popleft()
        safe.append(u)
        for v in rev[u]:
            outdeg[v] -= 1
            if outdeg[v] == 0:
                q.append(v)
    return sorted(safe)
g = {'A': ['B'], 'B': ['C'], 'C': [], 'D': ['A', 'C']}`, 'safe_nodes(g)'],
  ['graphs', 'Dijkstra (weighted adjacency idiom)', `import heapq
def dijkstra(adj, start):
    dist = {u: 999 for u in adj}
    dist[start] = 0
    pq = [(0, start)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue
        for v, w in adj[u]:
            if d + w < dist[v]:
                dist[v] = d + w
                heapq.heappush(pq, (dist[v], v))
    return dist
g = {'A': [('B', 4), ('C', 8)], 'B': [('C', 3)], 'C': []}`, "dijkstra(g, 'A')"],
  ['graphs', 'BFS (list-of-lists adjacency idiom)', `from collections import deque
def bfs(adj, start):
    visited = [start]
    q = deque([start])
    order = []
    while q:
        u = q.popleft()
        order.append(u)
        for v in adj[u]:
            if v not in visited:
                visited.append(v)
                q.append(v)
    return order
g = [[1, 2], [0, 3], [0], [1]]`, 'bfs(g, 0)'],
  ['graphs', 'G-32 Dijkstra (heap + dist)', `import heapq
def dijkstra(adj, weights, start):
    dist = {u: 999 for u in adj}
    dist[start] = 0
    pq = [(0, start)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue
        for v in adj[u]:
            nd = d + weights[(u, v)]
            if nd < dist[v]:
                dist[v] = nd
                heapq.heappush(pq, (nd, v))
    return dist
g = {'A': ['B', 'C'], 'B': ['C'], 'C': []}
w = {('A', 'B'): 4, ('A', 'C'): 8, ('B', 'C'): 3}`, "dijkstra(g, w, 'A')"],
  ['graphs', 'LC323 Connected Components (union-find)', `def components(n, edges):
    parent = list(range(n))
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    count = n
    for a, b in edges:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
            count -= 1
    return count`, 'components(5, [[0, 1], [1, 2], [3, 4]])'],
  ['graphs', 'G-42 Floyd Warshall', `def floyd(dist):
    n = len(dist)
    for k in range(n):
        for i in range(n):
            for j in range(n):
                if dist[i][k] + dist[k][j] < dist[i][j]:
                    dist[i][j] = dist[i][k] + dist[k][j]
    return dist`, 'floyd([[0,4,9],[4,0,3],[9,3,0]])'],

  ['graphs', 'LC127 Word Ladder (implicit graph)', `from collections import deque
def ladder(begin, end, words):
    seen = [begin]
    q = deque([(begin, 1)])
    while q:
        word, steps = q.popleft()
        if word == end:
            return steps
        for i in range(len(word)):
            for ch in 'cdghiot':
                nxt = word[:i] + ch + word[i+1:]
                if nxt in words and nxt not in seen:
                    seen.append(nxt)
                    q.append((nxt, steps + 1))
    return 0`, "ladder('hit', 'cog', ['hot','dot','dog','cog'])"],
  ['graphs', 'LC547 Provinces (REAL matrix input)', `def provinces(isConnected):
    n = len(isConnected)
    visited = []
    def dfs(i):
        visited.append(i)
        for j in range(n):
            if isConnected[i][j] == 1 and j not in visited:
                dfs(j)
    count = 0
    for i in range(n):
        if i not in visited:
            count += 1
            dfs(i)
    return count`, 'provinces([[1,1,0],[1,1,0],[0,0,1]])'],

  // ——— heaps ———
  ['heap', 'LC215 Kth Largest (heap as the lesson)', `import heapq
def kth_largest(nums, k):
    heap = []
    for x in nums:
        heapq.heappush(heap, x)
        if len(heap) > k:
            heapq.heappop(heap)
    return heap[0]`, 'kth_largest([3, 2, 1, 5, 6, 4], 2)'],
  ['heap', 'LC1046 Last Stone Weight (max-heap idiom)', `import heapq
def last_stone(stones):
    heap = [-s for s in stones]
    heapq.heapify(heap)
    while len(heap) > 1:
        a = -heapq.heappop(heap)
        b = -heapq.heappop(heap)
        if a != b:
            heapq.heappush(heap, -(a - b))
    return -heap[0] if heap else 0`, 'last_stone([2, 7, 4, 1, 8, 1])'],

  // ——— sorting (divide & conquer) ———
  ['sorting', 'LC912 Merge Sort (exclusive-hi idiom)', `def merge_sort(arr, lo, hi):
    if hi - lo <= 1:
        return
    mid = (lo + hi) // 2
    merge_sort(arr, lo, mid)
    merge_sort(arr, mid, hi)
    tmp = []
    i, j = lo, mid
    while i < mid and j < hi:
        if arr[i] <= arr[j]:
            tmp.append(arr[i]); i += 1
        else:
            tmp.append(arr[j]); j += 1
    tmp.extend(arr[i:mid]); tmp.extend(arr[j:hi])
    arr[lo:hi] = tmp`, 'merge_sort([5, 2, 8, 1], 0, 4)'],
  ['sorting', 'Quicksort in place (inclusive-hi idiom)', `def quicksort(arr, lo, hi):
    if lo >= hi:
        return
    pivot = arr[hi]
    i = lo
    for j in range(lo, hi):
        if arr[j] < pivot:
            arr[i], arr[j] = arr[j], arr[i]
            i += 1
    arr[i], arr[hi] = arr[hi], arr[i]
    quicksort(arr, lo, i - 1)
    quicksort(arr, i + 1, hi)`, 'quicksort([4, 1, 7, 3], 0, 3)'],

  // ——— intervals ———
  ['intervals', 'LC56 Merge Intervals', `def merge(intervals):
    intervals.sort()
    merged = []
    for iv in intervals:
        if merged and iv[0] <= merged[-1][1]:
            if iv[1] > merged[-1][1]:
                merged[-1][1] = iv[1]
        else:
            merged.append(list(iv))
    return merged`, 'merge([[1, 3], [8, 10], [2, 6], [15, 18]])'],

  // ——— design / composed structures ———
  ['design', 'LC146 LRU Cache (map + recency in sync)', `def lru_ops(cap, ops):
    cache = {}
    order = []
    out = []
    for op, key in ops:
        if op == 'get':
            if key in cache:
                order.remove(key)
                order.append(key)
                out.append(cache[key])
            else:
                out.append(-1)
        else:
            if key not in cache and len(cache) == cap:
                old = order.pop(0)
                del cache[old]
            cache[key] = key * 10
            if key in order:
                order.remove(key)
            order.append(key)
    return out`, "lru_ops(2, [('put', 1), ('put', 2), ('get', 1), ('put', 3), ('get', 2)])"],
  ['design', 'LC208 Trie built inline (dict-of-dicts)', `def build_trie(words):
    root = {}
    for w in words:
        node = root
        for ch in w:
            if ch not in node:
                node[ch] = {}
            node = node[ch]
        node['$'] = True
    return root`, "build_trie(['ap', 'an'])"],

  // ——— the honest floor ———
  ['math', 'GCD (Euclid) — floor territory', `def gcd(a, b):
    while b:
        a, b = b, a % b
    return a`, 'gcd(48, 18)'],
];

// THE FRONTIER — every KNOWN-GAP shape, run and reported honestly. These rows are excluded
// from the headline elite % (they document the boundary, they don't inflate or deflate it);
// when a frontier row goes structural, its lens just landed — promote it into PROBLEMS.
const FRONTIER = [
  // Found 2026-07-20 probing bitmask coverage: the READ-INTO-TEMP idiom (nd = dp[mask][u] + w;
  // dp[nm][v] = nd) hides the same-table dependency from the write's RHS — dp-table declines
  // (correctly cautious) and grid-walk shows the mask table spatially. Correct, not elite.
  // Fix direction: dataflow through simple name assignments (temp lineage).
  // Reported by external review 2026-07-19, reproduced same day. Both run CORRECTLY —
  // the gap is lens choice, not accuracy:
  // RESOLVED 2026-07-20: class Solution was never the problem — an INDEXED Kadane inside a
  // class gets pointer-array (battery row 'LC53 class-Solution'). The floor case was SLICE
  // iteration (for x in nums[1:]) — no indices means no pointer story; floor is honest there.
  ['Kadane via slice iteration (index-free — floor is the honest view)', `def max_sub(nums):
    best = nums[0]
    cur = nums[0]
    for x in nums[1:]:
        cur = max(x, cur + x)
        best = max(best, cur)
    return best`, 'max_sub([-2, 1, -3, 4, -1, 2, 1, -5, 4])'],
];

const rows = [];
let structural = 0;
let floor = 0;
let errors = 0;
for (const [cat, name, code, entry] of PROBLEMS) {
  try {
    const { trace, lens } = await traceUniversal({ code, entry, exec });
    const gate = dryRunQualityIssue({ steps: trace.steps, directive: name, code });
    const isFloor = lens === 'line-floor';
    if (isFloor) floor += 1; else structural += 1;
    rows.push({ cat, name, lens, steps: trace.steps.length, gate: gate ? 'GATE' : 'ok' });
  } catch (err) {
    errors += 1;
    rows.push({ cat, name, lens: 'ERROR', steps: 0, gate: String(err.message).slice(0, 60) });
  }
}

let lastCat = '';
for (const r of rows) {
  if (r.cat !== lastCat) {
    console.log(`\n— ${r.cat} —`);
    lastCat = r.cat;
  }
  console.log(`  ${r.lens === 'ERROR' ? '✖' : r.lens === 'line-floor' ? '▫' : '●'} ${r.name.padEnd(40)} ${r.lens.padEnd(17)} ${String(r.steps).padStart(3)} steps  ${r.gate}`);
}
const total = PROBLEMS.length;
console.log(`\n════════════════════════════════════════════════════════`);
console.log(`BATTERY: ${total} problems, zero per-problem code`);
console.log(`  structural elite : ${structural}/${total} (${Math.round((structural / total) * 100)}%)`);
console.log(`  line-table floor : ${floor}/${total}`);
console.log(`  errors           : ${errors}/${total}`);

console.log(`\n— frontier (known gaps, tracked honestly — excluded from the headline) —`);
if (FRONTIER.length === 0) console.log('  (clear — every previously known gap has its lens; add new gap shapes here as they surface)');
for (const [name, code, entry] of FRONTIER) {
  try {
    const { trace, lens } = await traceUniversal({ code, entry, exec });
    const structuralRow = lens !== 'line-floor';
    console.log(`  ${structuralRow ? '●' : '▫'} ${name.padEnd(42)} ${lens.padEnd(17)} ${String(trace.steps.length).padStart(3)} steps${structuralRow ? '  <- lens landed, promote this row' : ''}`);
  } catch (err) {
    console.log(`  ✖ ${name.padEnd(42)} ERROR ${String(err.message).slice(0, 50)}`);
  }
}
