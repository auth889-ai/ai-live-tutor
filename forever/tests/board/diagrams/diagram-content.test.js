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
    /highlightSequence references a missing node/,
  );
});
