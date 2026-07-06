import assert from 'node:assert/strict';
import test from 'node:test';

import { renderMath, validateMathContent } from '../../../lib/board/math/render-math.js';

test('renders LaTeX to KaTeX HTML', () => {
  const html = renderMath('E = mc^2');
  assert.ok(html.includes('katex'));
  assert.ok(html.length > 100);
});

test('invalid LaTeX renders an error node instead of throwing', () => {
  const html = renderMath('\\frac{1}{'); // malformed
  assert.ok(typeof html === 'string' && html.length > 0);
});

test('accepts a single equation and a step derivation', () => {
  validateMathContent({ latex: 'a^2 + b^2 = c^2' });
  validateMathContent({ steps: [{ latex: 'x + 2 = 5', note: 'start' }, { latex: 'x = 3', note: 'subtract 2' }] });
});

test('rejects empty math content', () => {
  assert.throws(() => validateMathContent({}), /needs a latex string/);
  assert.throws(() => validateMathContent({ steps: [{ note: 'no latex' }] }), /step needs a latex/);
});
