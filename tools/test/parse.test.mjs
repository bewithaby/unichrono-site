import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, queryInstant, offsetZone, resolvePlace, parseConversion } from '../../time/js/parse.js';

test('parses time, day and place', () => {
  assert.deepEqual(parseQuery('8am Tokyo'),
    { hour: 8, minute: 0, meridiem: 'am', day: { kind: 'today' }, place: 'tokyo' });
  assert.deepEqual(parseQuery('3 pm lhr tomorrow'),
    { hour: 3, minute: 0, meridiem: 'pm', day: { kind: 'tomorrow' }, place: 'lhr' });
  assert.deepEqual(parseQuery('fri 9:30 here'),
    { hour: 9, minute: 30, meridiem: null, day: { kind: 'weekday', wd: 5 }, place: 'here' });
  assert.equal(parseQuery('noon tomorrow').meridiem, 'pm');
  assert.equal(parseQuery('8 tonight').meridiem, 'pm');
  assert.equal(parseQuery('now').hour, null);
});

test('rejects non-times', () => {
  assert.equal(parseQuery('2030'), null);
  assert.equal(parseQuery('Tokyo'), null);
  assert.equal(parseQuery('13pm'), null);
  assert.equal(parseQuery('9:75'), null);
  assert.equal(parseQuery('8am 9am'), null);
});

const now = new Date('2026-10-07T00:00:00Z'); // Wed 09:00 Tokyo

test('instant: am/pm, tomorrow, weekday', () => {
  assert.equal(queryInstant(parseQuery('8pm'), 'Asia/Tokyo', now, false).toISOString(), '2026-10-07T11:00:00.000Z');
  assert.equal(queryInstant(parseQuery('8am tomorrow'), 'Asia/Tokyo', now, false).toISOString(), '2026-10-07T23:00:00.000Z');
  assert.equal(queryInstant(parseQuery('fri 9:30'), 'Asia/Tokyo', now, true).toISOString(), '2026-10-09T00:30:00.000Z');
  assert.equal(queryInstant(parseQuery('noon tomorrow'), 'Asia/Tokyo', now, false).toISOString(), '2026-10-08T03:00:00.000Z');
  assert.equal(queryInstant(parseQuery('now'), 'Asia/Tokyo', now, false), now);
});

test('12-hour bare hour picks the next one', () => {
  // 09:00 Tokyo now: bare "8" → 8 pm today; bare "10" → 10 am today.
  assert.equal(queryInstant(parseQuery('8'), 'Asia/Tokyo', now, false).toISOString(), '2026-10-07T11:00:00.000Z');
  assert.equal(queryInstant(parseQuery('10'), 'Asia/Tokyo', now, false).toISOString(), '2026-10-07T01:00:00.000Z');
  // 24-hour: "8" is 08:00.
  assert.equal(queryInstant(parseQuery('8'), 'Asia/Tokyo', now, true).toISOString(), '2026-10-06T23:00:00.000Z');
});

test('gapRollsForward', () => {
  const ny = new Date('2027-03-14T05:00:00Z'); // midnight NY on spring-forward day
  assert.equal(queryInstant(parseQuery('2:30am'), 'America/New_York', ny, false).toISOString(), '2027-03-14T07:30:00.000Z');
});

test('offset zones', () => {
  assert.deepEqual(offsetZone('UTC+5:30'), { zone: 'UTC+05:30', label: 'UTC+5:30' });
  assert.deepEqual(offsetZone('gmt-3'), { zone: 'UTC-03:00', label: 'UTC-3' });
  assert.deepEqual(offsetZone('Z'), { zone: 'UTC', label: 'UTC' });
  assert.equal(offsetZone('UTC+14:30'), null);
  assert.equal(offsetZone('UTC+5:20'), null);
});

const lookups = {
  airport: c => ({ IST: { iata: 'IST', name: 'Istanbul Airport', cityName: 'Istanbul', zone: 'Europe/Istanbul', cityId: 1 },
                   OSH: { iata: 'OSH', name: 'Oshkosh', cityName: 'Oshkosh', zone: 'America/Chicago', cityId: 2 },
                   LHR: { iata: 'LHR', name: 'Heathrow', cityName: 'London', zone: 'Europe/London', cityId: 3 } })[c.toUpperCase()] ?? null,
  cities: t => t.toLowerCase() === 'osh' ? [{ name: 'Osh', zone: 'Asia/Bishkek', cityId: 9 }]
             : t.toLowerCase().startsWith('lon') ? [{ name: 'London', zone: 'Europe/London', cityId: 3 }] : [],
  representative: z => ({ 'Asia/Kolkata': { name: 'Mumbai', cityId: 7 } })[z] ?? null,
};

test('IST means India first, airport after', () => {
  const r = resolvePlace('ist', lookups);
  assert.deepEqual(r.map(p => p.zone), ['Asia/Kolkata', 'Europe/Dublin', 'Asia/Jerusalem', 'Europe/Istanbul']);
  assert.equal(r[0].label, 'India Time (IST)');
  assert.equal(r[0].cityId, 7);
});

test('exact city beats airport code', () => {
  assert.deepEqual(resolvePlace('osh', lookups).map(p => p.kind), ['city', 'airport']);
});

test('airport, offset, saved', () => {
  assert.equal(resolvePlace('LHR', lookups)[0].label, 'London — LHR Heathrow');
  assert.equal(resolvePlace('UTC+5:30', lookups)[0].kind, 'offset');
  const saved = [{ id: 'a', label: 'Mom', zone: 'Asia/Tokyo' }];
  assert.deepEqual(resolvePlace('mom', lookups, saved)[0], { kind: 'saved', zone: 'Asia/Tokyo', label: 'Mom', cityId: null, savedId: 'a' });
  assert.deepEqual(resolvePlace('  ', lookups), []);
  const renamed = [{ id: 'b', label: 'Office', name: 'London', zone: 'Europe/London' }];
  assert.equal(resolvePlace('london', lookups, renamed)[0].kind, 'saved');
});

test('conversion target split', () => {
  const c = parseConversion('8am Tokyo in London');
  assert.equal(c.query.place, 'tokyo');
  assert.equal(c.target, 'london');
  assert.equal(parseConversion('8am in Tokyo').target, null);
  assert.equal(parseConversion('8am in Tokyo').query.place, 'tokyo');
  assert.equal(parseConversion('3pm PST to IST').target, 'ist');
  assert.equal(parseConversion('Tokyo'), null);
});
