import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { assembleUniversalProgram, parseUniversalEvents, validateUniversalRecording } from '../../../lib/execution/trace/universal/recorder.js';
import { detectLinkedList, compileLinkedListLens } from '../../../lib/execution/trace/universal/lenses/linked-list.js';
import { detectLenses } from '../../../lib/execution/trace/universal/detect.js';

const py = (source) => execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15_000 });
const record = ({ code, entry }) =>
  validateUniversalRecording(parseUniversalEvents(py(assembleUniversalProgram({ code, entry }))));

const REVERSE = [
  'class ListNode:',
  '    def __init__(self, val):',
  '        self.val = val',
  '        self.next = None',
  'def build(vals):',
  '    head = ListNode(vals[0])',
  '    node = head',
  '    for v in vals[1:]:',
  '        node.next = ListNode(v)',
  '        node = node.next',
  '    return head',
  'def reverseList(head):',
  '    prev = None',
  '    curr = head',
  '    while curr:',
  '        nxt = curr.next',
  '        curr.next = prev',
  '        prev = curr',
  '        curr = nxt',
  '    return prev',
  'lst = build([1, 2, 3])',
].join('\n');

test('detectLinkedList: a chain of ListNodes recognized from heap identity, trees refused', () => {
  const rec = record({ code: REVERSE, entry: 'reverseList(lst)' });
  const plan = detectLinkedList(rec);
  assert.ok(plan, 'the chain is recognized');
  assert.equal(plan.nodeType, 'ListNode');
  assert.equal(plan.nodeCount, 3);

  const tree = [
    'class TreeNode:',
    '    def __init__(self, val):',
    '        self.val = val',
    '        self.left = None',
    '        self.right = None',
    'def insert(root, val):',
    '    if root is None:',
    '        return TreeNode(val)',
    '    if val < root.val:',
    '        root.left = insert(root.left, val)',
    '    else:',
    '        root.right = insert(root.right, val)',
    '    return root',
    'root = TreeNode(5)',
  ].join('\n');
  assert.equal(detectLinkedList(record({ code: tree, entry: 'insert(root, 3)' })), null, 'left/right objects are a tree, not a chain');

  const fib = record({ code: 'def fib(n):\n    if n <= 1:\n        return n\n    return fib(n - 1) + fib(n - 2)', entry: 'fib(4)' });
  assert.equal(detectLinkedList(fib), null, 'no heap objects -> null');
});

test('reversal compiles through the EXISTING chain compiler: fingers walk, arrows flip, chain reads back reversed', () => {
  const rec = record({ code: REVERSE, entry: 'reverseList(lst)' });
  const plan = detectLinkedList(rec);
  const trace = compileLinkedListLens({ recording: rec, plan, code: REVERSE, entry: 'reverseList(lst)' });

  assert.equal(trace.views.list.nodes.length, 3, 'box per real node, positions fixed forever');
  const rewire = trace.steps.find((s) => s.list?.nodes?.some((n) => n.rewired));
  assert.ok(rewire, 'an arrow flip is its own visible step');
  const fingers = trace.steps.flatMap((s) => Object.keys(s.list?.pointers ?? {}));
  for (const name of ['prev', 'curr', 'nxt']) assert.ok(fingers.includes(name), `${name} walks the chain`);
  assert.match(trace.steps.at(-1).explanation, /3 → 2 → 1/, 'the final chain reads back REVERSED off the real arrows');
  assert.match(trace.steps.at(-1).explanation, /ListNode\(3\)/, 'a node result reads as ListNode(3), never a memory address');
});

test('registry: the chain outranks the recursion tree on a RECURSIVE reversal (the arrows are the lesson)', () => {
  const recursive = [
    'class ListNode:',
    '    def __init__(self, val):',
    '        self.val = val',
    '        self.next = None',
    'def build(vals):',
    '    head = ListNode(vals[0])',
    '    node = head',
    '    for v in vals[1:]:',
    '        node.next = ListNode(v)',
    '        node = node.next',
    '    return head',
    'def reverse(node, prev=None):',
    '    if node is None:',
    '        return prev',
    '    nxt = node.next',
    '    node.next = prev',
    '    return reverse(nxt, node)',
    'lst = build([1, 2, 3])',
  ].join('\n');
  const plans = detectLenses(record({ code: recursive, entry: 'reverse(lst)' }), { code: recursive });
  assert.ok(plans.length >= 2, 'both families fire');
  assert.equal(plans[0].lens, 'linked-list', 'registry order breaks the confidence tie toward the chain');
});
