import assert from 'node:assert/strict';
import test from 'node:test';

import { validateRunRequest, MAX_SOURCE_CHARS } from '../../lib/execution/run-request.js';

test('validateRunRequest accepts bounded python/javascript and normalizes language', () => {
  assert.deepEqual(validateRunRequest({ language: 'Python', source: 'print(1)' }), { language: 'python', source: 'print(1)' });
  assert.deepEqual(validateRunRequest({ language: 'javascript', source: 'console.log(1)' }), { language: 'javascript', source: 'console.log(1)' });
});

test('validateRunRequest refuses junk: bad language, empty source, oversized source', () => {
  assert.throws(() => validateRunRequest({ language: 'bash', source: 'rm -rf /' }), /language must be one of/);
  assert.throws(() => validateRunRequest({ language: 'python', source: '   ' }), /source is empty/);
  assert.throws(() => validateRunRequest({ language: 'python', source: 'x'.repeat(MAX_SOURCE_CHARS + 1) }), /source too large/);
  assert.throws(() => validateRunRequest(null), /Body must be JSON/);
});
