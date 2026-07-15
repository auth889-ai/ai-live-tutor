import assert from 'node:assert/strict';
import test from 'node:test';

import { structureViolation } from '../../../lib/board/structures/structure-rules.js';

const brief = { title: 'BST Insert Basics', directive: 'Explain inserting 5 into a binary search tree rooted at 8.' };

test('a tree concept drawn as a flowchart is a repairable violation', () => {
  const objects = [
    { id: 'o1', renderHint: 'text', content: 'title' },
    { id: 'o2', renderHint: 'diagram', content: { diagramType: 'flowchart', steps: ['compare', 'go left', 'insert'] } },
  ];
  const violation = structureViolation(objects, brief);
  assert.match(violation, /object o2/);
  assert.match(violation, /diagramType "graph"/);
  assert.match(violation, /draws a flowchart/);
});

test('a real structure satisfies the rule (graph present), and non-structural concepts are exempt', () => {
  const withGraph = [
    { id: 'o2', renderHint: 'diagram', content: { diagramType: 'graph', nodes: [{ id: '1', label: 'root: 8' }], edges: [] } },
    { id: 'o3', renderHint: 'diagram', content: { diagramType: 'flowchart', steps: ['a'] } }, // allowed alongside the structure
  ];
  assert.equal(structureViolation(withGraph, brief), null);

  const httpBrief = { title: 'HTTP request lifecycle', directive: 'Show the request flow through middleware.' };
  const flowchartOnly = [{ id: 'o2', renderHint: 'diagram', content: { diagramType: 'flowchart', steps: ['a', 'b'] } }];
  assert.equal(structureViolation(flowchartOnly, httpBrief), null); // flowchart is structure-true here

  assert.equal(structureViolation([{ id: 'o1', renderHint: 'text', content: 'x' }], brief), null); // no diagram
});

test('GRID-AS-GRAPH is rejected toward diagramType grid (live screenshot: 3x4 DP table as scattered coordinate boxes)', () => {
  const objects = [{
    id: 'robot_grid', renderHint: 'diagram',
    content: { diagramType: 'graph',
      nodes: [{ id: 'n1', label: 'S (0,0)' }, { id: 'n2', label: '(1,0)' }, { id: 'n3', label: '(0,1)' }, { id: 'n4', label: '(1,1)' }, { id: 'n5', label: 'E (2,3)' }],
      edges: [{ from: 'n1', to: 'n2' }] },
  }];
  const violation = structureViolation(objects, { title: 'Robot grid paths', directive: 'count paths' });
  assert.match(violation, /diagramType "grid"/, 'the repair message prescribes the grid device');
  // A REAL data-structure graph (value labels) stays legal.
  const tree = [{ id: 't', renderHint: 'diagram', content: { diagramType: 'graph', nodes: [{ id: '1', label: '8' }, { id: '2', label: '3' }, { id: '3', label: '10' }, { id: '4', label: '14' }], edges: [{ from: '1', to: '2' }] } }];
  assert.equal(structureViolation(tree, { title: 'BST insert', directive: 'tree walk' }), null);
});
