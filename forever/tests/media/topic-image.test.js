import assert from 'node:assert/strict';
import test from 'node:test';

import { findTopicImage } from '../../lib/media/topic-image.js';

const env = { PEXELS_API_KEY: 'px_key', PIXABAY_API_KEY: 'pb_key' };

test('Pexels hit wins: queried with the title lead, returns url + credit', async () => {
  const calls = [];
  const img = await findTopicImage('Longest Common Substring: From Brute Force to DP', {
    env,
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, json: async () => ({ photos: [{ src: { landscape: 'https://img.pexels/1.jpg' }, photographer: 'Ada' }] }) };
    },
  });
  assert.equal(img.provider, 'pexels');
  assert.equal(img.url, 'https://img.pexels/1.jpg');
  assert.match(img.credit, /Ada/);
  assert.match(decodeURIComponent(calls[0]), /Longest Common Substring/);
});

test('falls back Pexels -> Pixabay -> broader query -> honest null', async () => {
  const calls = [];
  const img = await findTopicImage('Zorbified Quantum Frobnication', {
    env,
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes('pexels')) return { ok: false, status: 401 };
      return { ok: true, json: async () => ({ hits: [] }) };
    },
  });
  assert.equal(img, null); // no fake covers
  assert.ok(calls.some((u) => u.includes('pixabay')));
  assert.ok(calls.some((u) => decodeURIComponent(u).includes('programming code computer'))); // broadened retry
});

test('no keys -> null without any network call', async () => {
  const img = await findTopicImage('anything', { env: {}, fetchImpl: async () => { throw new Error('must not fetch'); } });
  assert.equal(img, null);
});
