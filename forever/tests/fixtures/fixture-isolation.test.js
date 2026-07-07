import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// THE GUARANTEE: fixture content can never become product content. Fixtures may only
// be imported by tests/ and the dev-only player page — never by the product domain
// layer (lib/, which includes the queue worker). If a generation or playback module
// ever references fixtures/, this test fails the build. (Guards against the old
// System 1 "fake templated lesson" mistake.)

const FORBIDDEN_ROOTS = ['lib'];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

test('no product code imports fixture content', () => {
  const offenders = [];
  for (const root of FORBIDDEN_ROOTS) {
    let files = [];
    try {
      files = walk(root);
    } catch {
      continue; // root not created yet
    }
    for (const file of files) {
      if (readFileSync(file, 'utf8').includes('fixtures/')) offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], `Product code must never import fixtures: ${offenders.join(', ')}`);
});
