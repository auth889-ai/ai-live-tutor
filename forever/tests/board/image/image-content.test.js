import assert from 'node:assert/strict';
import test from 'node:test';

import { validateImageContent } from '../../../lib/board/image/image-content.js';

test('accepts an image with url and alt', () => {
  validateImageContent({ url: '/img/star.png', alt: 'Star schema diagram' });
});

test('accepts an image with a normalized highlight bbox', () => {
  validateImageContent({ url: '/img/page.png', alt: 'page 45', bbox: { x: 0.2, y: 0.1, w: 0.3, h: 0.2 } });
});

test('rejects an image with no url or no alt', () => {
  assert.throws(() => validateImageContent({ alt: 'x' }), /needs a url/);
  assert.throws(() => validateImageContent({ url: '/x.png' }), /needs alt text/);
});

test('rejects a bbox outside the image', () => {
  assert.throws(() => validateImageContent({ url: '/x.png', alt: 'x', bbox: { x: 0.9, y: 0.1, w: 0.3, h: 0.1 } }), /inside the image/);
});
