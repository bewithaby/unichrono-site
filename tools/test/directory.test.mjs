import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remember } from '../../time/js/directory.js';

test('recent pages: newest first, no duplicates, at most eight', () => {
  let list = [];
  for (let i = 0; i < 10; i++) list = remember(list, `/time/p${i}/`, `P${i}`);
  assert.equal(list.length, 8);
  assert.equal(list[0].path, '/time/p9/');
  list = remember(list, '/time/p5/', 'P5');
  assert.deepEqual(list.slice(0, 2).map(r => r.path), ['/time/p5/', '/time/p9/']);
  assert.equal(list.filter(r => r.path === '/time/p5/').length, 1);
});
