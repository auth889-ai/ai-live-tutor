import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { assembleUniversalProgram, parseUniversalEvents, validateUniversalRecording } from '../../../lib/execution/trace/universal/recorder.js';
import { detectObjectStructure, compileObjectStructure } from '../../../lib/execution/trace/universal/lenses/object-structure.js';
import { detectLenses } from '../../../lib/execution/trace/universal/detect.js';

const py = (source) => execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15_000 });
const record = ({ code, entry }) =>
  validateUniversalRecording(parseUniversalEvents(py(assembleUniversalProgram({ code, entry }))));

const TREE_PRELUDE = [
  'class TreeNode:',
  '    def __init__(self, val):',
  '        self.val = val',
  '        self.left = None',
  '        self.right = None',
  'def build():',
  '    root = TreeNode(5)',
  '    root.left = TreeNode(3)',
  '    root.right = TreeNode(8)',
  '    root.left.left = TreeNode(1)',
  '    root.left.right = TreeNode(4)',
  '    return root',
];

test('detectObjectStructure: a branching TreeNode is recognized; chains and scalars refuse', () => {
  const code = [...TREE_PRELUDE,
    'def inorder(node, out):',
    '    if node is None:',
    '        return out',
    '    inorder(node.left, out)',
    '    out.append(node.val)',
    '    inorder(node.right, out)',
    '    return out',
    'tree = build()',
  ].join('\n');
  const rec = record({ code, entry: 'inorder(tree, [])' });
  const plan = detectObjectStructure(rec);
  assert.ok(plan, 'the tree is recognized');
  assert.equal(plan.nodeType, 'TreeNode');
  assert.equal(plan.nodeCount, 5);

  const chain = [
    'class ListNode:',
    '    def __init__(self, val):',
    '        self.val = val',
    '        self.next = None',
    'def walk(head):',
    '    n = 0',
    '    node = head',
    '    while node:',
    '        n += 1',
    '        node = node.next',
    '    return n',
    'a = ListNode(1)',
    'a.next = ListNode(2)',
  ].join('\n');
  assert.equal(detectObjectStructure(record({ code: chain, entry: 'walk(a)' })), null, 'a pure next-chain belongs to the linked-list lens');

  const fib = record({ code: 'def fib(n):\n    if n <= 1:\n        return n\n    return fib(n - 1) + fib(n - 2)', entry: 'fib(4)' });
  assert.equal(detectObjectStructure(fib), null, 'no heap objects -> null');
});

test('inorder traversal compiles through the EXISTING structure compiler: sides, cursor, visited', () => {
  const code = [...TREE_PRELUDE,
    'def inorder(node, out):',
    '    if node is None:',
    '        return out',
    '    inorder(node.left, out)',
    '    out.append(node.val)',
    '    inorder(node.right, out)',
    '    return out',
    'tree = build()',
  ].join('\n');
  const entry = 'inorder(tree, [])';
  const rec = record({ code, entry });
  const plan = detectObjectStructure(rec);
  const trace = compileObjectStructure({ recording: rec, plan, code, entry });

  assert.equal(trace.views.graph.nodes.length, 5, 'one drawn node per real TreeNode');
  const sides = trace.views.graph.edges.map((e) => e.side).filter(Boolean);
  assert.ok(sides.includes('left') && sides.includes('right'), 'left/right links render as SIDES');
  const cursorSteps = trace.steps.filter((s) => s.graph?.current);
  assert.ok(cursorSteps.length >= 3, 'the cursor visibly walks the tree');
  assert.ok(cursorSteps.some((s) => s.graph.pointers?.node), 'the cursor rides the local really named node');
  assert.match(trace.steps.at(-1).explanation, /\[1,3,4,5,8\]|1,3,4,5,8|\[1, 3, 4, 5, 8\]/, 'the REAL inorder result reaches the close');
});

test('registry: the tree outranks the recursion tree on a recursive traversal; invert returns TreeNode(5)', () => {
  const code = [...TREE_PRELUDE,
    'def invert(node):',
    '    if node is None:',
    '        return None',
    '    node.left, node.right = invert(node.right), invert(node.left)',
    '    return node',
    'tree = build()',
  ].join('\n');
  const rec = record({ code, entry: 'invert(tree)' });
  const plans = detectLenses(rec, { code });
  assert.equal(plans[0]?.lens, 'object-structure', 'the structure is the lesson, the call tree is how it happens');

  const trace = plans[0].compile({ recording: rec, plan: plans[0], code, entry: 'invert(tree)' });
  assert.match(trace.steps.at(-1).explanation, /TreeNode\(5\)/, 'a node result reads as TreeNode(5), never a memory address');
});
