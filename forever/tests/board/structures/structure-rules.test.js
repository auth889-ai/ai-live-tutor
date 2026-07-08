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
