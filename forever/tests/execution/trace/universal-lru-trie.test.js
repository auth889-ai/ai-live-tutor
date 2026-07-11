import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { assembleUniversalProgram, parseUniversalEvents, validateUniversalRecording } from '../../../lib/execution/trace/universal/recorder.js';
import { detectTrieDict, compileTrieDict } from '../../../lib/execution/trace/universal/lenses/trie-dict.js';
import { detectLenses } from '../../../lib/execution/trace/universal/detect.js';

const py = (source) => execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15_000 });
const record = ({ code, entry }) =>
  validateUniversalRecording(parseUniversalEvents(py(assembleUniversalProgram({ code, entry }))));

test('LRU: the cache map AND its recency order move in sync — evictions are their own beats', () => {
  const lru = [
    'def lru_ops(cap, ops):',
    '    cache = {}',
    '    order = []',
    '    out = []',
    "    for op, key in ops:",
    "        if op == 'get':",
    '            if key in cache:',
    '                order.remove(key)',
    '                order.append(key)',
    '                out.append(cache[key])',
    '            else:',
    '                out.append(-1)',
    '        else:',
    '            if key not in cache and len(cache) == cap:',
    '                old = order.pop(0)',
    '                del cache[old]',
    '            cache[key] = key * 10',
    '            if key in order:',
    '                order.remove(key)',
    '            order.append(key)',
    '    return out',
  ].join('\n');
  const entry = "lru_ops(2, [('put', 1), ('put', 2), ('get', 1), ('put', 3), ('get', 2)])";
  const rec = record({ code: lru, entry });
  const plans = detectLenses(rec, { code: lru });
  assert.equal(plans[0]?.lens, 'collection-ops');
  const plan = plans[0];
  assert.ok(plan.ops.some((o) => o.op === 'remove'), 'the eviction (del cache[old]) is now a visible op');
  assert.ok(plan.ops.some((o) => Array.isArray(o.companion)), 'the recency order rides each op');

  const trace = plan.compile({ recording: rec, plan, code: lru, entry });
  const evict = trace.steps.find((s) => /remov/i.test(s.explanation));
  assert.ok(evict, 'the eviction is narrated');
  const synced = trace.steps.filter((s) => s.array2d && Array.isArray(s.queue));
  assert.ok(synced.length >= 3, 'map grid and recency panel ride the SAME steps');
  assert.deepEqual(trace.steps.at(-1).queue, ['1', '3'], 'the final recency order is the real one — 2 was evicted');
});

test('inline trie: the dict-of-dicts grows as a TREE, shared prefixes visibly reused', () => {
  const code = [
    'def build_trie(words):',
    '    root = {}',
    '    for w in words:',
    '        node = root',
    '        for ch in w:',
    '            if ch not in node:',
    '                node[ch] = {}',
    '            node = node[ch]',
    "        node['$'] = True",
    '    return root',
  ].join('\n');
  const entry = "build_trie(['ap', 'an'])";
  const rec = record({ code, entry });
  const plan = detectTrieDict(rec);
  assert.ok(plan, 'a nested growing char-keyed dict is a trie being built');
  assert.equal(plan.rootVar, 'root');

  const trace = compileTrieDict({ recording: rec, plan, code, entry });
  const labels = trace.views.graph.nodes.map((n) => n.label);
  assert.ok(labels.includes('a'), 'the shared prefix a is ONE node');
  assert.ok(labels.filter((l) => l === 'a').length === 1, 'shared prefixes are reused, not duplicated');
  assert.ok(labels.includes('p') && labels.includes('n'), 'the branches split after the shared prefix');
  assert.ok(labels.some((l) => /word ends/.test(l)), 'word-end markers are named for what they mean');
  const grow = trace.steps.find((s) => /appear|grows|new node/i.test(s.explanation));
  assert.ok(grow, 'growth is narrated as the tree builds');

  const plans = detectLenses(rec, { code });
  assert.equal(plans[0]?.lens, 'trie-dict', 'the tree outranks the flat dict-ops view');
});

test('no theft: flat dicts stay with collection-ops, memo dicts stay with recursion', () => {
  const freq = record({
    code: 'def freq(s):\n    counts = {}\n    for ch in s:\n        if ch in counts:\n            counts[ch] = counts[ch] + 1\n        else:\n            counts[ch] = 1\n    return counts',
    entry: "freq('abcab')",
  });
  assert.equal(detectTrieDict(freq), null, 'a flat counter dict never nests');
  assert.equal(detectLenses(freq, { code: '' })[0]?.lens, 'collection-ops', 'the bucket view keeps it');

  const memo = record({
    code: 'memo = {}\ndef fib(n):\n    if n in memo:\n        return memo[n]\n    if n <= 1:\n        return n\n    memo[n] = fib(n - 1) + fib(n - 2)\n    return memo[n]',
    entry: 'fib(5)',
  });
  assert.equal(detectTrieDict(memo), null, 'a memo dict has int-ish keys and never nests');
});
