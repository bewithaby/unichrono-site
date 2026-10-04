// The smart box: "8am Tokyo", "3pm lhr tomorrow", "8am Tokyo in London",
// "UTC+5:30". A port of the iOS app's TimeQuery / ZoneAbbreviations /
// OffsetZone / PlaceResolver, so the web and the app read text the same way.

import { wallParts, zonedInstant } from './tz.js';

const WEEKDAYS = [
  [['sun', 'sunday'], 0], [['mon', 'monday'], 1], [['tue', 'tues', 'tuesday'], 2],
  [['wed', 'wednesday'], 3], [['thu', 'thur', 'thurs', 'thursday'], 4],
  [['fri', 'friday'], 5], [['sat', 'saturday'], 6],
];

const TIME_RE = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/;
const NUMBERISH_RE = /^\d+([:.]\d+)?(am|pm)?$/;

/** Parsed query, or null when the text names no time. */
export function parseQuery(text) {
  const raw = String(text).toLowerCase().split(/\s+/).filter(Boolean);
  const tokens = [];
  for (const t of raw) {
    // "8 am" → "8am"
    if ((t === 'am' || t === 'pm') && tokens.length && /^\d{1,2}(?:[:.]\d{2})?$/.test(tokens[tokens.length - 1])) {
      tokens[tokens.length - 1] += t;
    } else {
      tokens.push(t);
    }
  }
  let time = null, day = null, tonight = false;
  const place = [];
  for (const t of tokens) {
    const m = TIME_RE.exec(t);
    if (m) {
      if (time) return null;
      const h = Number(m[1]), minute = m[2] ? Number(m[2]) : 0, meridiem = m[3] ?? null;
      if (minute >= 60) return null;
      if (meridiem ? h < 1 || h > 12 : h >= 24) return null;
      time = { hour: h, minute, meridiem };
    } else if (NUMBERISH_RE.test(t)) {
      return null; // "2030", "123:45": a year or garbage, never a time
    } else if (t === 'noon' || t === 'midnight' || t === 'now') {
      if (time) return null;
      // noon is pm by definition, or "noon tomorrow" reads as 12 am
      time = t === 'now' ? { hour: null, minute: 0, meridiem: null }
           : t === 'noon' ? { hour: 12, minute: 0, meridiem: 'pm' } : { hour: 0, minute: 0, meridiem: null };
    } else if (t === 'today' || t === 'tonight') {
      if (day) return null;
      day = { kind: 'today' }; tonight = t === 'tonight';
    } else if (t === 'tomorrow' || t === 'tmrw' || t === 'tmr') {
      if (day) return null;
      day = { kind: 'tomorrow' };
    } else if (t === 'yesterday') {
      if (day) return null;
      day = { kind: 'yesterday' };
    } else if (WEEKDAYS.some(([p]) => p.includes(t))) {
      if (day) return null;
      day = { kind: 'weekday', wd: WEEKDAYS.find(([p]) => p.includes(t))[1] };
    } else if (t === 'in' || t === 'at') {
      continue;
    } else {
      place.push(t);
    }
  }
  if (!time) return null;
  if (tonight && time.meridiem === null && time.hour >= 1 && time.hour <= 11) time.meridiem = 'pm';
  return { hour: time.hour, minute: time.minute, meridiem: time.meridiem,
           day: day ?? { kind: 'today' }, place: place.length ? place.join(' ') : null };
}

/**
 * The instant a query names, reading the wall time and day in `zone`.
 * 12-hour bare "8" means the next 8 o'clock (on another day: its am).
 */
export function queryInstant(q, zone, now, use24h) {
  if (q.hour === null) return now;
  const w = wallParts(zone, now);
  const offset = q.day.kind === 'tomorrow' ? 1 : q.day.kind === 'yesterday' ? -1
               : q.day.kind === 'weekday' ? (q.day.wd - w.wd + 7) % 7 : 0;
  const base = new Date(Date.UTC(w.y, w.mo - 1, w.d + offset));
  const at = (h, dayShift = 0) => zonedInstant(zone, base.getUTCFullYear(), base.getUTCMonth() + 1,
                                              base.getUTCDate() + dayShift, h, q.minute);
  const h = q.hour;
  if (q.meridiem === 'am') return at(h === 12 ? 0 : h);
  if (q.meridiem === 'pm') return at(h === 12 ? 12 : h + 12);
  if (use24h || h === 0 || h > 12) return at(h);
  const am = at(h === 12 ? 0 : h), pm = at(h === 12 ? 12 : h + 12);
  if (offset !== 0) return am;
  if (am >= now) return am;
  if (pm >= now) return pm;
  return at(h === 12 ? 0 : h, 1);
}

/** Abbreviations meaning their region's LOCAL time; ambiguous ones most likely first. */
export const ABBREVIATIONS = (() => {
  const t = {};
  const add = (keys, entries) => keys.forEach(k => { t[k] = entries; });
  add(['ET', 'EST', 'EDT'], [['America/New_York', 'Eastern']]);
  add(['CT', 'CDT'], [['America/Chicago', 'Central']]);
  add(['CST'], [['America/Chicago', 'Central'], ['Asia/Shanghai', 'China']]);
  add(['MT', 'MDT'], [['America/Denver', 'Mountain']]);
  add(['MST'], [['America/Denver', 'Mountain'], ['America/Phoenix', 'Arizona']]);
  add(['PT', 'PST', 'PDT'], [['America/Los_Angeles', 'Pacific']]);
  add(['AKST', 'AKDT'], [['America/Anchorage', 'Alaska']]);
  add(['HST'], [['Pacific/Honolulu', 'Hawaii']]);
  add(['AST'], [['America/Halifax', 'Atlantic']]);
  add(['NST'], [['America/St_Johns', 'Newfoundland']]);
  add(['BST'], [['Europe/London', 'British']]);
  add(['WET', 'WEST'], [['Europe/Lisbon', 'Western European']]);
  add(['CET', 'CEST'], [['Europe/Paris', 'Central European']]);
  add(['EET', 'EEST'], [['Europe/Athens', 'Eastern European']]);
  add(['MSK'], [['Europe/Moscow', 'Moscow']]);
  add(['GST'], [['Asia/Dubai', 'Gulf']]);
  add(['PKT'], [['Asia/Karachi', 'Pakistan']]);
  add(['IST'], [['Asia/Kolkata', 'India'], ['Europe/Dublin', 'Irish'], ['Asia/Jerusalem', 'Israel']]);
  add(['NPT'], [['Asia/Kathmandu', 'Nepal']]);
  add(['ICT'], [['Asia/Bangkok', 'Indochina']]);
  add(['WIB'], [['Asia/Jakarta', 'Western Indonesia']]);
  add(['SGT'], [['Asia/Singapore', 'Singapore']]);
  add(['HKT'], [['Asia/Hong_Kong', 'Hong Kong']]);
  add(['PHT'], [['Asia/Manila', 'Philippine']]);
  add(['JST'], [['Asia/Tokyo', 'Japan']]);
  add(['KST'], [['Asia/Seoul', 'Korea']]);
  add(['AWST'], [['Australia/Perth', 'Western Australia']]);
  add(['ACST', 'ACDT'], [['Australia/Adelaide', 'Central Australia']]);
  add(['AEST', 'AEDT'], [['Australia/Sydney', 'Eastern Australia']]);
  add(['NZST', 'NZDT'], [['Pacific/Auckland', 'New Zealand']]);
  add(['SAST'], [['Africa/Johannesburg', 'South Africa']]);
  add(['WAT'], [['Africa/Lagos', 'West Africa']]);
  add(['CAT'], [['Africa/Maputo', 'Central Africa']]);
  add(['EAT'], [['Africa/Nairobi', 'East Africa']]);
  add(['BRT'], [['America/Sao_Paulo', 'Brasília']]);
  add(['ART'], [['America/Argentina/Buenos_Aires', 'Argentina']]);
  return t;
})();

/** "UTC+5:30", "GMT-3", "UTC", "Z" → a fixed-offset pseudo-zone. */
export function offsetZone(text) {
  const t = String(text).toUpperCase().replace(/\s+/g, '');
  if (t === 'UTC' || t === 'GMT' || t === 'Z') return { zone: 'UTC', label: 'UTC' };
  const m = /^(?:UTC|GMT)([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(t);
  if (!m) return null;
  const h = Number(m[2]), mins = m[3] ? Number(m[3]) : 0;
  if (h > 14 || ![0, 15, 30, 45].includes(mins) || (h === 14 && mins > 0)) return null;
  if (h === 0 && mins === 0) return { zone: 'UTC', label: 'UTC' };
  return { zone: `UTC${m[1]}${String(h).padStart(2, '0')}:${String(mins).padStart(2, '0')}`,
           label: `UTC${m[1]}${h}${mins ? ':' + String(mins).padStart(2, '0') : ''}` };
}

/**
 * Every place `text` can mean, most specific first: saved cities, a zone
 * abbreviation (IST is India more often than Istanbul airport), a city named
 * exactly so (Osh beats the OSH airport), an airport code, a UTC offset, then
 * city search. `saved`: [{id, label, name?, zone}].
 */
export function resolvePlace(text, lookups, saved = []) {
  const t = String(text).trim();
  if (!t) return [];
  const out = [], seen = new Set();
  const add = p => { const k = p.zone + '|' + p.label; if (!seen.has(k)) { seen.add(k); out.push(p); } };
  const lower = t.toLowerCase();
  for (const s of saved) {
    if (s.label.toLowerCase() === lower || s.name?.toLowerCase() === lower) add({ kind: 'saved', zone: s.zone, label: s.label, cityId: null, savedId: s.id });
  }
  for (const [zone, region] of ABBREVIATIONS[t.toUpperCase()] ?? []) {
    add({ kind: 'abbreviation', zone, label: `${region} Time (${t.toUpperCase()})`,
          cityId: lookups.representative(zone)?.cityId ?? null });
  }
  const hits = lookups.cities(t);
  for (const c of hits) {
    if (c.name.toLowerCase() === lower) add({ kind: 'city', zone: c.zone, label: c.name, cityId: c.cityId });
  }
  if (/^[A-Za-z]{3}$/.test(t)) {
    const a = lookups.airport(t);
    if (a) add({ kind: 'airport', zone: a.zone, label: `${a.cityName} — ${a.iata} ${a.name}`, cityId: a.cityId });
  }
  const off = offsetZone(t);
  if (off) add({ kind: 'offset', zone: off.zone, label: off.label, cityId: null });
  for (const c of hits) add({ kind: 'city', zone: c.zone, label: c.name, cityId: c.cityId });
  return out;
}

/** "8am Tokyo in London" → {query, target: "london"}; plain queries get target null. */
export function parseConversion(text) {
  const tokens = String(text).trim().split(/\s+/).filter(Boolean);
  for (let i = tokens.length - 2; i > 0; i--) {
    const w = tokens[i].toLowerCase();
    if (w !== 'in' && w !== 'to') continue;
    const query = parseQuery(tokens.slice(0, i).join(' '));
    if (query && query.place) return { query, target: tokens.slice(i + 1).join(' ').toLowerCase() };
  }
  const query = parseQuery(text);
  return query ? { query, target: null } : null;
}
