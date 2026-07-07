import assert from 'node:assert/strict';
import test from 'node:test';

import { validateDiagramContent } from '../../../lib/board/diagrams/diagram-content.js';

test('accepts the structured shortcuts', () => {
  validateDiagramContent({ diagramType: 'flowchart', steps: ['A', 'B'] });
  validateDiagramContent({ diagramType: 'tree', root: { label: 'Root' } });
  validateDiagramContent({ diagramType: 'comparison', columns: ['X'], rows: [{ label: 'r', values: ['1'] }] });
});

test('accepts raw Mermaid that declares a known diagram type', () => {
  validateDiagramContent({ diagramType: 'mermaid', code: 'sequenceDiagram\n  A->>B: hi' });
  validateDiagramContent({ diagramType: 'mermaid', code: 'classDiagram\n  Animal <|-- Dog' });
  validateDiagramContent({ diagramType: 'mermaid', code: 'stateDiagram-v2\n  [*] --> Ready' });
});

test('rejects mermaid without a recognized diagram-type keyword (Mermaid-First)', () => {
  assert.throws(() => validateDiagramContent({ diagramType: 'mermaid', code: 'draw me a cat please' }), /known diagram type/);
});

test('rejects mermaid with empty code', () => {
  assert.throws(() => validateDiagramContent({ diagramType: 'mermaid', code: '   ' }), /non-empty code/);
});

test('rejects unknown diagram types and malformed shortcuts', () => {
  assert.throws(() => validateDiagramContent({ diagramType: 'hologram' }), /unknown diagramType/);
  assert.throws(() => validateDiagramContent({ diagramType: 'flowchart', steps: [] }), /needs steps/);
});

test('graph accepts an optional traversal highlightSequence of existing nodes', () => {
  validateDiagramContent({ diagramType: 'graph', nodes: [{ id: '1' }, { id: '2' }], edges: [{ from: '1', to: '2' }], highlightSequence: ['1', '2'] });
});

test('graph rejects a highlightSequence referencing a missing node', () => {
  assert.throws(
    () => validateDiagramContent({ diagramType: 'graph', nodes: [{ id: '1' }], edges: [], highlightSequence: ['1', '9'] }),
    /highlightSequence "9" references a missing node/,
  );
});

test('graph accepts a dry-run trace of existing nodes with pointers and visited', () => {
  validateDiagramContent({
    diagramType: 'graph',
    nodes: [{ id: '1', label: '8' }, { id: '2', label: '3' }, { id: '3', label: '10' }],
    edges: [{ from: '1', to: '2' }, { from: '1', to: '3' }],
    trace: [
      { note: 'start at root 8, target < 8, go left', current: '1', pointers: { curr: '1' } },
      { note: 'now at 3, found it', current: '2', visited: ['1'], pointers: { curr: '2' } },
    ],
  });
});

test('graph rejects a trace step without a note', () => {
  assert.throws(
    () => validateDiagramContent({ diagramType: 'graph', nodes: [{ id: '1' }], edges: [], trace: [{ current: '1' }] }),
    /trace step 0 needs a note/,
  );
});

test('graph rejects a trace pointer/current/visited referencing a missing node', () => {
  const base = { diagramType: 'graph', nodes: [{ id: '1' }], edges: [] };
  assert.throws(() => validateDiagramContent({ ...base, trace: [{ note: 'x', current: '9' }] }), /trace step 0 current "9" references a missing node/);
  assert.throws(() => validateDiagramContent({ ...base, trace: [{ note: 'x', visited: ['9'] }] }), /trace step 0 visited "9" references a missing node/);
  assert.throws(() => validateDiagramContent({ ...base, trace: [{ note: 'x', pointers: { mid: '9' } }] }), /trace step 0 pointer "mid":"9" references a missing node/);
});

test('graph rejects an empty trace array', () => {
  assert.throws(
    () => validateDiagramContent({ diagramType: 'graph', nodes: [{ id: '1' }], edges: [], trace: [] }),
    /trace must be a non-empty array/,
  );
});

test('comparison/trace rows must FILL the table — the empty-cells production bug is rejected', () => {
  // the exact malformed shape that rendered blank cells: value text as a stray KEY
  assert.throws(
    () => validateDiagramContent({
      diagramType: 'comparison',
      columns: ['Pair', 'Match', 'Length'],
      rows: [{ label: '(0, 0)', 'G=G then stop': ['5'] }],
    }),
    /row 0 \("\(0, 0\)"\) must have "values" as an array of exactly 3/,
  );
  // the correct shape passes: label column implicit, one value per header
  validateDiagramContent({
    diagramType: 'comparison',
    columns: ['Match', 'Length'],
    rows: [{ label: '(0, 0)', values: ['G=G then stop', '5'] }],
  });
});
