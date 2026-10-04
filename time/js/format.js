// Text for times, days and differences, read in any zone (incl. "UTC+05:30").

import { wallParts, zonedInstant, nextTransition, formatOffset } from './tz.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = n => String(n).padStart(2, '0');

export function timeText(zone, date, h24) {
  const w = wallParts(zone, date);
  if (h24) return `${p2(w.h)}:${p2(w.mi)}`;
  return `${w.h % 12 || 12}:${p2(w.mi)} ${w.h < 12 ? 'am' : 'pm'}`;
}

/** Hour-cell label: "9am" / "09", with minutes only for off-the-hour zones. */
export function hourText(zone, date, h24) {
  const w = wallParts(zone, date);
  const mins = w.mi ? `:${p2(w.mi)}` : '';
  if (h24) return `${p2(w.h)}${mins}`;
  return `${w.h % 12 || 12}${mins}${w.h < 12 ? 'am' : 'pm'}`;
}

export function dayText(zone, date) {
  const w = wallParts(zone, date);
  return `${DAYS[w.wd]} ${w.d} ${MONTHS[w.mo - 1]}`;
}

export function diffText(minutes) {
  if (minutes === 0) return 'same time';
  const a = Math.abs(minutes), h = Math.floor(a / 60), m = a % 60;
  const amount = [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
  return `${amount} ${minutes > 0 ? 'ahead' : 'behind'}`;
}

/** Each hour of the home zone's calendar day (23 or 25 on clock-change days). */
export function dayColumns(zone, y, mo, d) {
  const start = zonedInstant(zone, y, mo, d, 0, 0).getTime();
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  const end = zonedInstant(zone, next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0).getTime();
  const out = [];
  for (let t = start; t < end; t += 3600000) out.push(new Date(t));
  return out;
}

const ALIASES = { 'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Saigon': 'Asia/Ho_Chi_Minh', 'Asia/Katmandu': 'Asia/Kathmandu',
                  'Asia/Rangoon': 'Asia/Yangon', 'Europe/Kiev': 'Europe/Kyiv', 'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
                  'Etc/UTC': 'UTC', 'Etc/GMT': 'UTC', 'GMT': 'UTC' };

/** The browser's zone, with the old names some browsers still report. */
export function homeZone(raw) {
  if (!raw) return 'UTC';
  return ALIASES[raw] ?? raw;
}

/** Index of the column holding `date`, or -1. */
export function columnOf(cols, date) {
  const t = date.getTime();
  for (let i = 0; i < cols.length; i++) {
    const end = i + 1 < cols.length ? cols[i + 1].getTime() : cols[i].getTime() + 3600000;
    if (t >= cols[i].getTime() && t < end) return i;
  }
  return -1;
}

function columnsAround(zone, at, dayShift) {
  const w = wallParts(zone, at);
  const d = new Date(Date.UTC(w.y, w.mo - 1, w.d + dayShift));
  return dayColumns(zone, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** The column `delta` steps from the one holding `at`, rolling into the next/previous home day. */
export function stepColumn(zone, at, delta) {
  const cols = columnsAround(zone, at, 0);
  const j = columnOf(cols, at) + delta;
  if (j >= 0 && j < cols.length) return cols[j];
  if (j < 0) { const prev = columnsAround(zone, at, -1); return prev[prev.length + j]; }
  return columnsAround(zone, at, 1)[j - cols.length];
}

/** "Next clock change: Sun 25 Oct 2026, clocks go back 1 h (to UTC)." or "". */
export function nextChangeText(zone, now) {
  const tr = nextTransition(zone, now);
  if (!tr) return '';
  const diff = tr.after - tr.before, a = Math.abs(diff);
  const amount = [Math.floor(a / 60) ? `${Math.floor(a / 60)} h` : '', a % 60 ? `${a % 60} min` : ''].filter(Boolean).join(' ');
  return `Next clock change: ${dayText(zone, tr.at)} ${wallParts(zone, tr.at).y}, clocks ${diff > 0 ? 'go forward' : 'go back'} ${amount} (to ${formatOffset(tr.after)}).`;
}
