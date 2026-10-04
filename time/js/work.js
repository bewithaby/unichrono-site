// Work hours: Mon–Fri 09:00–17:00, an hour of shoulder either side, as the
// apps' Availability widget and the watch's "OK to Call?" read them.

import { wallParts } from './tz.js';

const START = 9 * 60, END = 17 * 60, SHOULDER = 60;

export function status(zone, date) {
  const w = wallParts(zone, date);
  if (w.wd === 0 || w.wd === 6) return 'away';
  const m = w.h * 60 + w.mi;
  if (m >= START && m < END) return 'available';
  if ((m >= START - SHOULDER && m < START) || (m >= END && m < END + SHOULDER)) return 'shoulder';
  return 'away';
}

/** Status plus a shape and a word, so colour is never the only signal. */
export function mark(zone, date) {
  const s = status(zone, date);
  if (s === 'available') return { status: s, symbol: '✓', word: 'free' };
  if (s === 'shoulder') return { status: s, symbol: '½', word: 'winding down' };
  const h = wallParts(zone, date).h;
  return h >= 22 || h < 7 ? { status: s, symbol: '☾', word: 'asleep' } : { status: s, symbol: '○', word: 'off' };
}

/**
 * The best run of whole hours from `dayStart` where nobody is away, scored by
 * how many cities are fully available. Earliest run wins a tie; null when
 * every hour has someone away.
 */
export function bestOverlap(zones, dayStart, hours = 24) {
  let best = null, run = null;
  for (let i = 0; i <= hours; i++) {
    const t = new Date(dayStart.getTime() + i * 3600000);
    let score = -1;
    if (i < hours) {
      const ss = zones.map(z => status(z, t));
      if (!ss.includes('away')) score = ss.filter(s => s === 'available').length;
    }
    if (run && score === run.score) continue;
    if (run) {
      run.end = t;
      if (!best || run.score > best.score) best = run;
      run = null;
    }
    if (score >= 0) run = { start: t, end: null, score };
  }
  return best;
}
