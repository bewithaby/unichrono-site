import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeState, decodeState } from '../../time/js/share.js';
import { googleURL, outlookURL, icsText, timesText } from '../../time/js/calendar.js';
import { makeStore } from '../../time/js/store.js';
import { clockOffset, clockText } from '../../time/js/clock.js';

test('state round trip', () => {
  const s = { cities: ['tokyo', 'z:UTC+05:30', 'id:123'], t: new Date('2026-10-07T09:00:00Z'), h24: true };
  const q = encodeState(s);
  assert.equal(q, '?c=tokyo,z:UTC%2B05:30,id:123&t=2026-10-07T09:00Z&h=24');
  assert.deepEqual(decodeState(q), s);
  assert.equal(encodeState({ cities: [], t: null, h24: null }), '');
  assert.deepEqual(decodeState('?h=12'), { cities: [], t: null, h24: false });
});

test('decodeIgnoresGarbage', () => {
  assert.deepEqual(decodeState('?c=,,%%,zz/../x,id:abc,z:Nope,ok-1&t=nope&h=7'), { cities: ['ok-1'], t: null, h24: null });
  assert.deepEqual(decodeState(''), { cities: [], t: null, h24: null });
  const many = Array.from({ length: 20 }, (_, i) => 'c' + i).join(',');
  assert.equal(decodeState('?c=' + many).cities.length, 12);
  assert.deepEqual(decodeState('?c=tokyo,tokyo').cities, ['tokyo']);
});

const ev = { title: 'Meeting', start: new Date('2026-10-07T09:00Z'), end: new Date('2026-10-07T10:00Z'), details: 'Tokyo 6:00 pm\nLondon 10:00 am' };

test('calendar links', () => {
  const g = new URL(googleURL(ev));
  assert.equal(g.host, 'calendar.google.com');
  assert.equal(g.searchParams.get('dates'), '20261007T090000Z/20261007T100000Z');
  assert.equal(g.searchParams.get('text'), 'Meeting');
  const o = new URL(outlookURL(ev));
  assert.equal(o.searchParams.get('startdt'), '2026-10-07T09:00:00Z');
  assert.equal(o.searchParams.get('subject'), 'Meeting');
});

test('ics', () => {
  const ics = icsText(ev, new Date('2026-10-01T00:00Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.includes('\r\nDTSTART:20261007T090000Z\r\n'));
  assert.ok(ics.includes('\r\nDTEND:20261007T100000Z\r\n'));
  assert.ok(ics.includes('DESCRIPTION:Tokyo 6:00 pm\\nLondon 10:00 am'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});

test('times text', () => {
  assert.equal(timesText([{ label: 'Tokyo', time: '6:00 pm', day: 'Wed 7 Oct' }, { label: 'London', time: '10:00 am', day: 'Wed 7 Oct' }], 'Meeting'),
    'Meeting\nTokyo — 6:00 pm, Wed 7 Oct\nLondon — 10:00 am, Wed 7 Oct');
});

test('storeSurvivesThrowingStorage', () => {
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const s = makeStore(bad);
  assert.deepEqual(s.get('cities', []), []);
  s.set('cities', ['x']);
  assert.deepEqual(makeStore(null).get('a', 1), 1);
  const mem = new Map();
  const ok = makeStore({ getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) });
  ok.set('h24', true);
  assert.equal(ok.get('h24', false), true);
  mem.set('uc.time.broken', '{nope');
  assert.equal(ok.get('broken', 5), 5);
});

test('clock offset and text', () => {
  // Server says 12:00:01; sent 12:00:00.000, received 12:00:00.400 device time.
  const sent = Date.UTC(2026, 9, 7, 12, 0, 0, 0), recv = sent + 400;
  assert.equal(clockOffset('Wed, 07 Oct 2026 12:00:01 GMT', sent, recv), 800);
  assert.equal(clockOffset('garbage', sent, recv), null);
  assert.equal(clockText(800), 'Your clock is 0.8 s slow');
  assert.equal(clockText(-2500), 'Your clock is 2.5 s fast');
  assert.equal(clockText(300), 'Your clock is about right');
  assert.equal(clockText(-90_000), 'Your clock is 1 min 30 s fast');
});
