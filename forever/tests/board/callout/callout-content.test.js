import assert from 'node:assert/strict';
import test from 'node:test';

import { validateCalloutContent, CALLOUT_VARIANTS } from '../../../lib/board/callout/callout-content.js';

test('accepts each callout variant with a body', () => {
  for (const variant of CALLOUT_VARIANTS) {
    validateCalloutContent({ variant, body: 'Some teaching point.' });
  }
});

test('accepts a list body', () => {
  validateCalloutContent({ variant: 'recap', body: ['Point one', 'Point two'] });
});

test('rejects an unknown variant', () => {
  assert.throws(() => validateCalloutContent({ variant: 'danger', body: 'x' }), /variant must be one of/);
});

test('rejects an empty body', () => {
  assert.throws(() => validateCalloutContent({ variant: 'mistake', body: '  ' }), /non-empty body/);
  assert.throws(() => validateCalloutContent({ variant: 'recap', body: [] }), /non-empty body/);
});
