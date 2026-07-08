import assert from 'node:assert/strict';
import test from 'node:test';

import { isTree, layoutTree, wantsTreeLayout } from '../../../lib/board/diagrams/tree-layout.js';

const bst = {
  nodes: [{ id: '8' }, { id: '3' }, { id: '10' }, { id: '1' }, { id: '6' }],
  edges: [
    { from: '8', to: '3', side: 'left' },
    { from: '8', to: '10', side: 'right' },
    { from: '3', to: '1', side: 'left' },
    { from: '3', to: '6', side: 'right' },
  ],
};

test('isTree accepts rooted trees, rejects cycles / DAGs / forests', () => {
  assert.equal(isTree(bst), true);
  // cycle
  assert.equal(isTree({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }] }), false);
  // DAG: two parents share a child
  assert.equal(isTree({
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    edges: [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }],
  }), false);
  // forest: two roots
  assert.equal(isTree({ nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], edges: [{ from: 'a', to: 'b' }] }), false);
  assert.equal(isTree({ nodes: [], edges: [] }), false);
});

test('BST layout: left child left of parent, right child right, levels stack down', () => {
  const laid = layoutTree(bst);
  const at = Object.fromEntries(laid.nodes.map((n) => [n.id, n]));
  const cx = (n) => n.x + n.width / 2;

  assert.ok(cx(at['3']) < cx(at['8']), 'left subtree left of root');
  assert.ok(cx(at['10']) > cx(at['8']), 'right subtree right of root');
  assert.ok(cx(at['1']) < cx(at['3']) && cx(at['6']) > cx(at['3']), 'grandchildren straddle their parent');
  assert.ok(at['3'].y > at['8'].y && at['1'].y > at['3'].y, 'depth increases downward');
  assert.equal(laid.edges.length, 4);
  assert.ok(laid.width > 0 && laid.height > 0);
});

test('a LONE sided child leans its way instead of centering under the parent', () => {
  const leftOnly = layoutTree({
    nodes: [{ id: 'p' }, { id: 'c' }],
    edges: [{ from: 'p', to: 'c', side: 'left' }],
  });
  const [p, c] = ['p', 'c'].map((id) => leftOnly.nodes.find((n) => n.id === id));
  assert.ok(c.x + c.width / 2 < p.x + p.width / 2, 'left-only child must sit LEFT of its parent');

  const rightOnly = layoutTree({
    nodes: [{ id: 'p' }, { id: 'c' }],
    edges: [{ from: 'p', to: 'c', side: 'right' }],
  });
  const [p2, c2] = ['p', 'c'].map((id) => rightOnly.nodes.find((n) => n.id === id));
  assert.ok(c2.x + c2.width / 2 > p2.x + p2.width / 2, 'right-only child must sit RIGHT of its parent');
});

test('layout switch: branching trees YES, linked-list chains NO (they keep dagre + LR)', () => {
  assert.equal(wantsTreeLayout(bst), true);
  const chain = { nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }] };
  assert.equal(isTree(chain), true, 'a chain IS a tree...');
  assert.equal(wantsTreeLayout(chain), false, '...but must stay on dagre so direction LR is honored');
});

test('unsided n-ary trees keep emission order and still lay out (recursion trees)', () => {
  const laid = layoutTree({
    nodes: [{ id: 'f4' }, { id: 'f3' }, { id: 'f2' }],
    edges: [{ from: 'f4', to: 'f3' }, { from: 'f4', to: 'f2' }],
  });
  const at = Object.fromEntries(laid.nodes.map((n) => [n.id, n]));
  assert.ok(at['f3'].x < at['f2'].x, 'first-emitted child stays leftmost');
  assert.throws(() => layoutTree({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }] }), /rooted tree/);
});
