import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, matches } from '../../time/js/directory.js';

test('fold drops accents and punctuation', () => {
  assert.equal(fold('São Paulo'), 'sao paulo');
  assert.equal(fold('Zürich'), 'zurich');
  assert.equal(fold("St. John's"), 'st john s');
});

test('every query word must start a word of the item', () => {
  assert.ok(matches('new york city', 'new y'));
  assert.ok(matches('ist india standard time india mumbai', 'india'));
  assert.ok(matches('Zürich', 'zur'));
  assert.ok(!matches('new york city', 'york new jersey'));
  assert.ok(!matches('pacific time', 'cif'));  // inside a word does not count
  assert.ok(matches('anything', '   '));        // empty query keeps everything
});
