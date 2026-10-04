import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOffsetZone, offsetMinutes, wallParts, zonedInstant, abbreviation, nextTransition, formatOffset }
  from '../../time/js/tz.js';

const at = s => new Date(s);

test('whole-hour zone offset', () => {
  assert.equal(offsetMinutes('Asia/Tokyo', at('2026-10-07T00:00Z')), 540);
});

test('quarterHourZones', () => {
  assert.equal(offsetMinutes('Asia/Kolkata', at('2026-10-07T00:00Z')), 330);
  assert.equal(offsetMinutes('Asia/Kathmandu', at('2026-10-07T00:00Z')), 345);
  assert.equal(offsetMinutes('Australia/Adelaide', at('2026-07-01T00:00Z')), 570);
  assert.equal(offsetMinutes('Australia/Adelaide', at('2026-12-01T00:00Z')), 630);
});

test('offset pseudo-zones', () => {
  assert.ok(isOffsetZone('UTC+05:30'));
  assert.ok(isOffsetZone('UTC'));
  assert.ok(!isOffsetZone('Asia/Tokyo'));
  assert.equal(offsetMinutes('UTC+05:30', at('2026-10-07T00:00Z')), 330);
  assert.equal(offsetMinutes('UTC-03:00', at('2026-10-07T00:00Z')), -180);
  assert.equal(offsetMinutes('UTC', at('2026-10-07T00:00Z')), 0);
  assert.deepEqual(wallParts('UTC+05:30', at('2026-10-07T20:00Z')), { y: 2026, mo: 10, d: 8, h: 1, mi: 30, wd: 4 });
});

test('wall parts', () => {
  assert.deepEqual(wallParts('Asia/Tokyo', at('2026-10-07T15:30Z')), { y: 2026, mo: 10, d: 8, h: 0, mi: 30, wd: 4 });
});

test('next transition', () => {
  const t = nextTransition('America/New_York', at('2027-01-01T00:00Z'));
  assert.equal(t.at.toISOString(), '2027-03-14T07:00:00.000Z');
  assert.equal(t.before, -300);
  assert.equal(t.after, -240);
  assert.equal(nextTransition('Asia/Tokyo', at('2027-01-01T00:00Z')), null);
  assert.equal(nextTransition('UTC+05:30', at('2027-01-01T00:00Z')), null);
});

test('zoned instant: plain, gap rolls forward, overlap takes earlier', () => {
  assert.equal(zonedInstant('Asia/Tokyo', 2026, 10, 8, 9, 0).toISOString(), '2026-10-08T00:00:00.000Z');
  assert.equal(zonedInstant('America/New_York', 2027, 3, 14, 2, 30).toISOString(), '2027-03-14T07:30:00.000Z');
  assert.equal(zonedInstant('America/New_York', 2026, 11, 1, 1, 30).toISOString(), '2026-11-01T05:30:00.000Z');
  assert.equal(zonedInstant('UTC+05:30', 2026, 10, 8, 9, 0).toISOString(), '2026-10-08T03:30:00.000Z');
});

test('abbreviation and offset format', () => {
  assert.equal(abbreviation('Asia/Tokyo', at('2026-10-07T00:00Z')), 'JST');
  assert.equal(abbreviation('Europe/London', at('2026-07-01T00:00Z')), 'BST');
  assert.equal(abbreviation('Asia/Kolkata', at('2026-07-01T00:00Z')), 'IST');
  assert.equal(abbreviation('UTC+05:30', at('2026-07-01T00:00Z')), 'UTC+5:30');
  assert.equal(formatOffset(540), 'UTC+9');
  assert.equal(formatOffset(330), 'UTC+5:30');
  assert.equal(formatOffset(-180), 'UTC−3');
  assert.equal(formatOffset(0), 'UTC');
});

import { supportedZone } from '../../time/js/tz.js';
test('zones the browser does not know are mapped to old names or dropped', () => {
  assert.equal(supportedZone('Europe/Kyiv'), 'Europe/Kyiv');
  assert.equal(supportedZone('Not/AZone'), null);
  assert.equal(supportedZone('UTC+05:30'), 'UTC+05:30');
  const oldBrowser = z => !['Europe/Kyiv', 'Pacific/Kanton', 'America/Ciudad_Juarez', 'America/Coyhaique'].includes(z);
  assert.equal(supportedZone('Europe/Kyiv', oldBrowser), 'Europe/Kiev');
  assert.equal(supportedZone('Pacific/Kanton', oldBrowser), 'Pacific/Enderbury');
  assert.equal(supportedZone('America/Ciudad_Juarez', oldBrowser), 'America/Denver');
  assert.equal(supportedZone('America/Coyhaique', oldBrowser), 'America/Punta_Arenas');
  assert.equal(supportedZone('Mars/Base', () => false), null);
});
