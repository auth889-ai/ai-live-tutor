import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTrace } from '../../lib/execution/trace/parse-trace.js';

test('parses real TRACE lines into a step-by-step trace table', () => {
  const stdout = [
    'Starting binary search',
    'TRACE {"low":0,"mid":3,"high":7}',
    'TRACE {"low":4,"mid":5,"high":7}',
    'Found at index 5',
  ].join('\n');
  const table = parseTrace(stdout);
  assert.equal(table.diagramType, 'trace');
  assert.deepEqual(table.columns, ['low', 'mid', 'high']);
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0].label, 'Step 1');
  assert.deepEqual(table.rows[1].values, ['4', '5', '7']);
});

test('columns are the union across steps, in first-seen order', () => {
  const table = parseTrace('TRACE {"i":1,"sum":1}\nTRACE {"i":2,"sum":3,"carry":0}');
  assert.deepEqual(table.columns, ['i', 'sum', 'carry']);
  assert.deepEqual(table.rows[0].values, ['1', '1', '']); // carry not present in step 1
});

test('formats arrays readably', () => {
  const table = parseTrace('TRACE {"arr":[2,5,8],"target":5}');
  assert.equal(table.rows[0].values[0], '[2, 5, 8]');
});

test('no trace lines -> null (honest: no fake table)', () => {
  assert.equal(parseTrace('just some output\nno trace here'), null);
});

test('malformed trace lines are skipped, not fatal', () => {
  const table = parseTrace('TRACE {bad json}\nTRACE {"i":1}');
  assert.equal(table.rows.length, 1);
});
