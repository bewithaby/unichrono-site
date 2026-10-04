import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeText, hourText, dayText, diffText, dayColumns, homeZone } from '../../time/js/format.js';

const t = new Date('2026-10-07T00:05:00Z');

test('time text 12/24h', () => {
  assert.equal(timeText('Asia/Tokyo', t, false), '9:05 am');
  assert.equal(timeText('Asia/Tokyo', t, true), '09:05');
  assert.equal(timeText('Europe/London', new Date('2026-10-07T11:00Z'), false), '12:00 pm');
  assert.equal(timeText('Europe/London', new Date('2026-10-06T23:00Z'), false), '12:00 am');
  assert.equal(timeText('UTC+05:30', t, true), '05:35');
});

test('hour cells show minutes only off the hour', () => {
  const h = new Date('2026-10-07T00:00Z');
  assert.equal(hourText('Asia/Tokyo', h, false), '9am');
  assert.equal(hourText('Asia/Tokyo', h, true), '09');
  assert.equal(hourText('Asia/Kolkata', h, false), '5:30am');
  assert.equal(hourText('Asia/Kathmandu', h, true), '05:45');
  assert.equal(hourText('Europe/London', new Date('2026-10-07T11:00Z'), false), '12pm');
});

test('day text', () => {
  assert.equal(dayText('Asia/Tokyo', t), 'Wed 7 Oct');
  assert.equal(dayText('America/Los_Angeles', t), 'Tue 6 Oct');
});

test('diff text', () => {
  assert.equal(diffText(0), 'same time');
  assert.equal(diffText(480), '8 h ahead');
  assert.equal(diffText(-210), '3 h 30 min behind');
  assert.equal(diffText(45), '45 min ahead');
});

test('day columns start at home midnight, one per hour', () => {
  const cols = dayColumns('Asia/Tokyo', 2026, 10, 7);
  assert.equal(cols.length, 24);
  assert.equal(cols[0].toISOString(), '2026-10-06T15:00:00.000Z');
  assert.equal(cols[23].toISOString(), '2026-10-07T14:00:00.000Z');
  // spring-forward day in New York has 23 hours
  assert.equal(dayColumns('America/New_York', 2027, 3, 14).length, 23);
  assert.equal(dayColumns('America/New_York', 2026, 11, 1).length, 25);
});

test('home zone alias', () => {
  assert.equal(homeZone('Asia/Calcutta'), 'Asia/Kolkata');
  assert.equal(homeZone('Asia/Saigon'), 'Asia/Ho_Chi_Minh');
  assert.equal(homeZone('Europe/Paris'), 'Europe/Paris');
  assert.equal(homeZone(undefined), 'UTC');
});

import { stepColumn, nextChangeText } from '../../time/js/format.js';
test('arrow steps move one grid column, also in half-hour home zones', () => {
  const ten = new Date('2026-10-07T04:30:00Z');            // 10:00 Kolkata
  assert.equal(stepColumn('Asia/Kolkata', ten, 1).toISOString(), '2026-10-07T05:30:00.000Z');   // 11:00
  assert.equal(stepColumn('Asia/Kolkata', ten, -1).toISOString(), '2026-10-07T03:30:00.000Z');  // 09:00
  const mid = new Date('2026-10-07T04:50:00Z');            // 10:20 Kolkata → next column 11:00
  assert.equal(stepColumn('Asia/Kolkata', mid, 1).toISOString(), '2026-10-07T05:30:00.000Z');
  // across midnight into the next and previous day
  const late = new Date('2026-10-07T18:00:00Z');           // 23:30 Kolkata, column 23:00
  assert.equal(stepColumn('Asia/Kolkata', late, 1).toISOString(), '2026-10-07T18:30:00.000Z');   // 00:00 next day
  const early = new Date('2026-10-06T18:30:00Z');          // 00:00 Kolkata
  assert.equal(stepColumn('Asia/Kolkata', early, -1).toISOString(), '2026-10-06T17:30:00.000Z');  // 23:00 day before
});

test('next clock change text', () => {
  assert.equal(nextChangeText('Europe/London', new Date('2026-10-04T00:00Z')),
    'Next clock change: Sun 25 Oct 2026, clocks go back 1 h (to UTC).');
  assert.equal(nextChangeText('Australia/Sydney', new Date('2026-10-05T00:00Z')),
    'Next clock change: Sun 4 Apr 2027, clocks go back 1 h (to UTC+10).');
  assert.equal(nextChangeText('Asia/Tokyo', new Date('2026-10-04T00:00Z')), '');
});
