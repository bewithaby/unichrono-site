import { test } from 'node:test';
import assert from 'node:assert/strict';
import { status, mark, bestOverlap } from '../../time/js/work.js';
import { sunTimes } from '../../time/js/sun.js';
import { moonPhase } from '../../time/js/moon.js';
import { wallParts } from '../../time/js/tz.js';

// London is UTC+1 (BST) on these October 2026 dates. 5 Oct = Monday, 10 Oct = Saturday.
const L = 'Europe/London';
test('work status and marks', () => {
  assert.equal(status(L, new Date('2026-10-05T09:00Z')), 'available');   // 10:00
  assert.deepEqual(mark(L, new Date('2026-10-05T16:30Z')), { status: 'shoulder', symbol: '½', word: 'winding down' }); // 17:30
  assert.deepEqual(mark(L, new Date('2026-10-05T01:00Z')), { status: 'away', symbol: '☾', word: 'asleep' }); // 02:00
  assert.deepEqual(mark(L, new Date('2026-10-10T13:00Z')), { status: 'away', symbol: '○', word: 'off' });     // Sat 14:00
  assert.deepEqual(mark(L, new Date('2026-10-05T09:00Z')), { status: 'available', symbol: '✓', word: 'free' });
  assert.equal(status(L, new Date('2026-10-05T07:00Z')), 'shoulder');   // 08:00
});

test('best overlap prefers hours that suit everyone', () => {
  const r = bestOverlap([L, 'America/New_York'], new Date('2026-10-05T00:00Z'));
  assert.ok(r);
  // 9-17 London (08-16Z) ∩ 9-17 New York (13-21Z) = 13-16Z, all available.
  assert.equal(r.start.toISOString(), '2026-10-05T13:00:00.000Z');
  assert.equal(r.end.toISOString(), '2026-10-05T16:00:00.000Z');
  assert.equal(r.score, 2);
});

test('no overlap gives null', () => {
  // Saturday everywhere: everyone away all day.
  assert.equal(bestOverlap([L, 'Asia/Tokyo'], new Date('2026-10-10T00:00Z')), null);
});

test('Tokyo sunrise on the solstice', () => {
  const s = sunTimes(35.68, 139.69, 'Asia/Tokyo', new Date('2026-06-21T03:00Z'));
  const rise = wallParts('Asia/Tokyo', s.rise);
  const mins = rise.h * 60 + rise.mi;
  assert.ok(Math.abs(mins - (4 * 60 + 25)) <= 4, `sunrise ${rise.h}:${rise.mi}`);
  assert.ok(s.dayLengthMin > 14 * 60 && s.dayLengthMin < 14 * 60 + 50);
});

test('sun times are for the city-local day east of UTC', () => {
  // 23:30Z on 20 June is already 21 June 08:30 in Tokyo: the day must be the 21st.
  const s = sunTimes(35.68, 139.69, 'Asia/Tokyo', new Date('2026-06-20T23:30Z'));
  assert.equal(wallParts('Asia/Tokyo', s.rise).d, 21);
  assert.ok(s.rise < s.set);
});

test('polar day in Tromsø', () => {
  assert.deepEqual(sunTimes(69.65, 18.96, 'Europe/Oslo', new Date('2026-06-21T12:00Z')), { polar: 'day' });
});

test('moon phase', () => {
  const full = moonPhase(new Date('2026-10-26T04:00Z'));
  assert.equal(full.name, 'Full moon');
  assert.ok(full.illumination > 0.97);
  assert.equal(moonPhase(new Date('2026-11-09T07:00Z')).name, 'New moon');
});
