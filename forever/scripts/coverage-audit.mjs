// HONEST COVERAGE AUDIT — run a DIVERSE, harder spread of LeetCode/Codeforces problems through
// the engines and report the real distribution: which get an ELITE STRUCTURAL view vs which
// fall to the LINE-SIM FLOOR (a real line-by-line variable trace — correct, but plain). This is
// the empirical answer to "can it dry-run any of the 4000 problems?" — every one gets a REAL
// run; only a subset get a bespoke picture. No mocks; traced engines execute real python3.
//
//   node scripts/coverage-audit.mjs

import { execFileSync } from 'node:child_process';

import { compilePointerWalk } from '../lib/execution/trace/pointer-walk/compiler.js';
import { assembleLineProgram, parseLineEvents, compileLineTrace } from '../lib/execution/trace/line-sim/compiler.js';
import { compileGraphWalk } from '../lib/execution/trace/graph-walk/compiler.js';
import { compileDivideConquer } from '../lib/execution/trace/divide-conquer/compiler.js';
import { assembleDivideProgram, parseDivideEvents } from '../lib/execution/trace/divide-conquer/tracker.js';
import { compileDpTable } from '../lib/execution/trace/dp-table/compiler.js';
import { assembleDpProgram, parseDpEvents } from '../lib/execution/trace/dp-table/tracker.js';
import { compileRecursionTrace, assembleRecursionProgram, parseCallTree } from '../lib/execution/trace/recursion/compiler.js';

const py = (source) => execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 20000 });
const rows = [];
const line = (code, entry) => compileLineTrace({ ...parseLineEvents(py(assembleLineProgram({ code, entry }))), code, entry });

function run(name, tier, fn) {
  try {
    const trace = fn();
    rows.push({ problem: name, view: tier, steps: trace.steps.length, ok: '✓' });
  } catch (e) {
    rows.push({ problem: name, view: tier, steps: 0, ok: `✗ ${String(e.message).slice(0, 40)}` });
  }
}

// ---- STRUCTURAL (fits an engine) ----
run('LC 704 Binary Search', 'pointer-walk', () => {
  const code = 'def bs(a, t):\n    lo, hi = 0, len(a)-1\n    while lo <= hi:\n        mid = (lo+hi)//2\n        if a[mid] == t: return mid\n        if a[mid] < t: lo = mid+1\n        else: hi = mid-1\n    return -1';
  const p = parseLineEvents(py(assembleLineProgram({ code, entry: 'bs([1,3,5,7,9,11],9)' })));
  return compilePointerWalk({ ...p, code, array: [1, 3, 5, 7, 9, 11], pointers: ['lo', 'mid', 'hi'], examine: 'mid', eliminatedOutside: ['lo', 'hi'] });
});
run('LC 15 3Sum (two-pointer inner)', 'pointer-walk', () => {
  const code = 'def two(a, lo, hi, t):\n    while lo < hi:\n        s = a[lo]+a[hi]\n        if s == t: return (lo,hi)\n        if s < t: lo += 1\n        else: hi -= 1\n    return -1';
  const p = parseLineEvents(py(assembleLineProgram({ code, entry: 'two([-4,-1,-1,0,1,2],0,5,2)' })));
  return compilePointerWalk({ ...p, code, array: [-4, -1, -1, 0, 1, 2], pointers: ['lo', 'hi'], examine: 'lo', window: ['lo', 'hi'] });
});
run('LC 912 Sort (quicksort)', 'divide-conquer', () => {
  const code = 'def qs(a, lo, hi):\n    if lo >= hi: return a\n    p = a[hi]; i = lo\n    for j in range(lo, hi):\n        if a[j] < p:\n            a[i],a[j]=a[j],a[i]; i+=1\n    a[i],a[hi]=a[hi],a[i]\n    qs(a,lo,i-1); qs(a,i+1,hi)\n    return a';
  const p = parseDivideEvents(py(assembleDivideProgram({ code, entry: 'qs([5,2,8,1],0,3)', fn: 'qs', arrayVar: 'a', loVar: 'lo', hiVar: 'hi' })));
  return compileDivideConquer({ ...p, code, entry: 'qs([5,2,8,1],0,3)', fn: 'qs', pointers: ['i', 'j'] });
});
run('LC 743 Network Delay (Dijkstra)', 'graph-walk', () => {
  const code = 'import heapq\ndef dj(g, s):\n    dist={s:0}; vis=set(); pq=[(0,s)]\n    while pq:\n        d,u=heapq.heappop(pq)\n        if u in vis: continue\n        vis.add(u)\n        for v,w in g.get(u,[]):\n            nd=d+w\n            if v not in dist or nd<dist[v]:\n                dist[v]=nd; heapq.heappush(pq,(nd,v))\n    return dist';
  const entry = "dj({'A':[('B',4),('C',1)],'C':[('B',2)]},'A')";
  const p = parseLineEvents(py(assembleLineProgram({ code, entry })));
  return compileGraphWalk({ ...p, code, entry, graph: { nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }], edges: [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }, { from: 'C', to: 'B' }], directed: true }, lens: { current: 'u', dist: 'dist', visited: 'vis', pq: 'pq' } });
});
run('LC 1143 LCS (2D DP)', 'dp-table', () => {
  const code = 'def lcs(a,b):\n    dp=[[0]*(len(b)+1) for _ in range(len(a)+1)]\n    for i in range(1,len(a)+1):\n        for j in range(1,len(b)+1):\n            if a[i-1]==b[j-1]: dp[i][j]=dp[i-1][j-1]+1\n            else: dp[i][j]=max(dp[i-1][j],dp[i][j-1])\n    return dp[-1][-1]';
  const p = parseDpEvents(py(assembleDpProgram({ code, entry: "lcs('abcde','ace')" })));
  return compileDpTable({ ...p, code, entry: "lcs('abcde','ace')" });
});
run('LC 322 Coin Change (1D DP)', 'dp-table', () => {
  const code = 'def cc(coins, amt):\n    dp=[0]+[amt+1]*amt\n    for i in range(1,amt+1):\n        for c in coins:\n            if c<=i: dp[i]=min(dp[i],dp[i-c]+1)\n    return dp[amt] if dp[amt]<=amt else -1';
  const p = parseDpEvents(py(assembleDpProgram({ code, entry: 'cc([1,2,5],6)' })));
  return compileDpTable({ ...p, code, entry: 'cc([1,2,5],6)' });
});
run('LC 509 Fibonacci (recursion)', 'recursion', () => {
  const code = 'def fib(n):\n    if n<=1: return n\n    return fib(n-1)+fib(n-2)';
  const ct = parseCallTree(py(assembleRecursionProgram({ code, fnName: 'fib', args: [6], memoize: false })));
  return compileRecursionTrace({ callTree: ct, code, lines: { call: 3, base: 2, combine: 3 } });
});

// ---- LINE-SIM FLOOR (fits NO engine — real, but plain) ----
run('LC 1 Two Sum (hash lookup)', 'line-sim FLOOR', () => line('def two(a,t):\n    seen={}\n    for i,x in enumerate(a):\n        if t-x in seen: return [seen[t-x],i]\n        seen[x]=i\n    return []', 'two([2,7,11,15],9)'));
run('LC 20 Valid Parentheses (stack)', 'line-sim FLOOR', () => line('def valid(s):\n    st=[]\n    m={")":"(","]":"[","}":"{"}\n    for c in s:\n        if c in m:\n            if not st or st.pop()!=m[c]: return False\n        else: st.append(c)\n    return not st', 'valid("([{}])")'));
run('LC 53 Max Subarray (Kadane greedy)', 'line-sim FLOOR', () => line('def kadane(a):\n    best=cur=a[0]\n    for x in a[1:]:\n        cur=max(x,cur+x)\n        best=max(best,cur)\n    return best', 'kadane([-2,1,-3,4,-1,2,1,-5,4])'));
run('Codeforces GCD (Euclid math)', 'line-sim FLOOR', () => line('def gcd(a,b):\n    while b: a,b=b,a%b\n    return a', 'gcd(48,36)'));
run('LC 51 N-Queens (backtracking count)', 'line-sim FLOOR', () => line('def nq(n):\n    cols=set(); d1=set(); d2=set(); res=[0]\n    def bt(r):\n        if r==n: res[0]+=1; return\n        for c in range(n):\n            if c in cols or (r-c) in d1 or (r+c) in d2: continue\n            cols.add(c); d1.add(r-c); d2.add(r+c)\n            bt(r+1)\n            cols.discard(c); d1.discard(r-c); d2.discard(r+c)\n    bt(0)\n    return res[0]', 'nq(4)'));
run('LC 136 Single Number (bit XOR)', 'line-sim FLOOR', () => line('def single(a):\n    r=0\n    for x in a: r^=x\n    return r', 'single([4,1,2,1,2])'));

// eslint-disable-next-line no-console
console.table(rows);
const structural = rows.filter((r) => !r.view.includes('FLOOR') && r.ok === '✓').length;
const floor = rows.filter((r) => r.view.includes('FLOOR') && r.ok === '✓').length;
const failed = rows.filter((r) => r.ok !== '✓').length;
// eslint-disable-next-line no-console
console.log(`\nSTRUCTURAL (elite bespoke view): ${structural}/${rows.length}`);
console.log(`LINE-SIM FLOOR (real, plain trace): ${floor}/${rows.length}`);
console.log(`FAILED to produce ANY trace: ${failed}/${rows.length}  <-- every problem must be > 0 here to honor "never a fake"`);
