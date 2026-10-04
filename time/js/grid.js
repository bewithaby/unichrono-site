// The hour grid: one row per city, one cell per hour of the home day.

import { wallParts, offsetMinutes, abbreviation, formatOffset } from './tz.js';
import { timeText, hourText, dayText, diffText } from './format.js';
import { mark } from './work.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function flag(cc) {
  return /^[A-Za-z]{2}$/.test(cc || '') ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1A5 + c.charCodeAt(0))) : '';
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

/** Two lines under the time: "JST UTC+9" and "Wed 7 Oct · 8 h ahead". */
function subLines(row, at, homeZone) {
  const off = offsetMinutes(row.zone, at);
  const abbr = abbreviation(row.zone, at);
  const day = dayText(row.zone, at);
  return [abbr === formatOffset(off) ? abbr : `${abbr} ${formatOffset(off)}`,
          row.home ? `${day} · you` : `${day} · ${diffText(off - offsetMinutes(homeZone, at))}`];
}

/**
 * m: {rows:[{key, label, cc, zone, home}], cols:[Date], at: Date (shown instant),
 *     now: Date, h24, homeZone}
 */
export function renderGrid(el, m) {
  const sel = columnOf(m.cols, m.at), nowCol = columnOf(m.cols, m.now);
  el.style.setProperty('--cols', m.cols.length);
  const html = [];
  for (const row of m.rows) {
    html.push(`<div class="row" data-key="${esc(row.key)}"><div class="rh">`
      + `<div class="nm">${row.home ? '<span class="home" title="Your time zone">🏠</span>' : ''}<span>${flag(row.cc)}</span>`
      + `<button type="button" data-open="${esc(row.key)}" title="Details for ${esc(row.label)}">${esc(row.label)}</button></div>`
      + `<div class="tm" data-tm="${esc(row.zone)}">${timeText(row.zone, m.at, m.h24)}</div>`
      + subLines(row, m.at, m.homeZone).map(t => `<div class="sub" data-sub>${esc(t)}</div>`).join('') + '</div>');
    let prevDay = null;
    m.cols.forEach((c, i) => {
      const w = wallParts(row.zone, c);
      const mk = mark(row.zone, new Date(c.getTime() + 30 * 60000));
      const day = `${w.y}-${w.mo}-${w.d}`;
      const midnight = prevDay !== null && day !== prevDay;
      prevDay = day;
      const label = hourText(row.zone, c, m.h24);
      const cls = ['c', mk.status, label.length > 5 ? 'long' : '', midnight ? 'midnight' : '', i === sel ? 'sel' : '', i === nowCol ? 'now' : ''].filter(Boolean).join(' ');
      html.push(`<div class="${cls}" data-i="${i}"${midnight ? ` data-day="${esc(dayText(row.zone, c).split(' ').slice(0, 2).join(' '))}"` : ''}`
        + ` title="${esc(`${row.label}: ${timeText(row.zone, c, m.h24)} ${dayText(row.zone, c)}, ${mk.word}`)}">`
        + `${label}<i aria-hidden="true">${mk.symbol}</i></div>`);
    });
    html.push('</div>');
  }
  el.innerHTML = html.join('');
}

/** Cheap per-second refresh of the row times while nothing is selected. */
export function updateTimes(el, m) {
  el.querySelectorAll('.row').forEach((r, i) => {
    const row = m.rows[i];
    if (!row) return;
    const tm = r.querySelector('[data-tm]');
    const t = timeText(row.zone, m.at, m.h24);
    if (tm.textContent !== t) tm.textContent = t;
    const lines = subLines(row, m.at, m.homeZone);
    r.querySelectorAll('[data-sub]').forEach((el, k) => { if (el.textContent !== lines[k]) el.textContent = lines[k]; });
  });
}
