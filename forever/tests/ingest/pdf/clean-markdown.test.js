import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanMarkdown } from '../../../lib/ingest/pdf/clean-markdown.js';

test('strips image tags but keeps prose', () => {
  const out = cleanMarkdown('# Star Schema\n\n![diagram](img/star.png)\n\nA fact table sits in the center.');
  assert.ok(out.includes('Star Schema'));
  assert.ok(out.includes('fact table sits in the center'));
  assert.ok(!out.includes('img/star.png'));
});

test('removes heading markers and emphasis, keeps the words', () => {
  const out = cleanMarkdown('## **Important** concept\n\nUse `surrogate` keys.');
  assert.ok(out.includes('Important concept'));
  assert.ok(out.includes('Use surrogate keys'));
  assert.ok(!out.includes('#') && !out.includes('*') && !out.includes('`'));
});

test('collapses excessive blank lines and spaces', () => {
  const out = cleanMarkdown('Line one.\n\n\n\nLine two.   Extra    spaces.');
  assert.ok(!out.includes('\n\n\n'));
  assert.ok(!out.includes('    '));
});
