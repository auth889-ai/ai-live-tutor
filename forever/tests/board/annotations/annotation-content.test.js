import assert from 'node:assert/strict';
import test from 'node:test';

import { validateAnnotations, ANNOTATION_VERBS } from '../../../lib/board/annotations/annotation-content.js';

test('the 7 teaching verbs validate with normalized bboxes; label/arrow need text', () => {
  validateAnnotations([
    { verb: 'encircle', bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
    { verb: 'arrow', bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, text: 'fact table' },
    { verb: 'label', bbox: { x: 0, y: 0, w: 0.3, h: 0.1 }, text: 'header' },
    { verb: 'cross_out', bbox: { x: 0.2, y: 0.6, w: 0.2, h: 0.1 } },
  ]);
  assert.equal(ANNOTATION_VERBS.length, 7);
  assert.equal(validateAnnotations(undefined), undefined); // optional

  assert.throws(() => validateAnnotations([{ verb: 'wiggle', bbox: { x: 0, y: 0, w: 1, h: 1 } }]), /unknown verb "wiggle"/);
  assert.throws(() => validateAnnotations([{ verb: 'arrow', bbox: { x: 0, y: 0, w: 0.1, h: 0.1 } }]), /needs text/);
  assert.throws(() => validateAnnotations([{ verb: 'encircle', bbox: { x: 0.9, y: 0, w: 0.5, h: 0.1 } }]), /stay inside/);
  assert.throws(() => validateAnnotations([{ verb: 'pointer' }]), /needs bbox/);
});
