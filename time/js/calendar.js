// "Add to calendar" links and an .ics file, plus a plain-text times block.

const compact = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const isoNoMs = d => d.toISOString().replace(/\.\d{3}/, '');

export function googleURL({ title, start, end, details }) {
  const u = new URL('https://calendar.google.com/calendar/render');
  u.searchParams.set('action', 'TEMPLATE');
  u.searchParams.set('text', title);
  u.searchParams.set('dates', `${compact(start)}/${compact(end)}`);
  u.searchParams.set('details', details);
  return u.toString();
}

export function outlookURL({ title, start, end, details }) {
  const u = new URL('https://outlook.live.com/calendar/0/deeplink/compose');
  u.searchParams.set('path', '/calendar/action/compose');
  u.searchParams.set('rru', 'addevent');
  u.searchParams.set('subject', title);
  u.searchParams.set('startdt', isoNoMs(start));
  u.searchParams.set('enddt', isoNoMs(end));
  u.searchParams.set('body', details);
  return u.toString();
}

const esc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

export function icsText({ title, start, end, details }, now = new Date()) {
  const uid = `${compact(start)}-${Math.abs(hash(title + details))}@unichrono.app`;
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Unichrono//World Time//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${compact(now)}`, `DTSTART:${compact(start)}`, `DTEND:${compact(end)}`,
    `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(details)}`, 'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** rows: [{label, time, day}] */
export function timesText(rows, title) {
  return [title, ...rows.map(r => `${r.label} — ${r.time}, ${r.day}`)].join('\n');
}
