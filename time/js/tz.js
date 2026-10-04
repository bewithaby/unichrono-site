// Zone maths on the browser's own time-zone data (Intl). Fixed offsets are
// "UTC+05:30" pseudo-zones handled here, because not every engine accepts
// offset strings as an Intl timeZone.

const OFFSET_RE = /^UTC(?:([+-])(\d{2}):(\d{2}))?$/;

export function isOffsetZone(zone) {
  return OFFSET_RE.test(zone);
}

function fixedOffset(zone) {
  const m = OFFSET_RE.exec(zone);
  if (!m || !m[1]) return 0;
  const v = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -v : v;
}

const fmtCache = new Map();
function partsFormatter(zone) {
  let f = fmtCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short',
    });
    fmtCache.set(zone, f);
  }
  return f;
}

const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** {y, mo, d, h, mi, wd(0 = Sunday)} as a wall clock in `zone` reads at `date`. */
export function wallParts(zone, date) {
  if (isOffsetZone(zone)) {
    const s = new Date(date.getTime() + fixedOffset(zone) * 60000);
    return { y: s.getUTCFullYear(), mo: s.getUTCMonth() + 1, d: s.getUTCDate(),
             h: s.getUTCHours(), mi: s.getUTCMinutes(), wd: s.getUTCDay() };
  }
  const p = {};
  for (const { type, value } of partsFormatter(zone).formatToParts(date)) p[type] = value;
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day),
           h: Number(p.hour) % 24, mi: Number(p.minute), wd: WD[p.weekday] };
}

/** Local minus UTC, in minutes. */
export function offsetMinutes(zone, date) {
  if (isOffsetZone(zone)) return fixedOffset(zone);
  const t = Math.floor(date.getTime() / 60000) * 60000;
  const w = wallParts(zone, new Date(t));
  return Math.round((Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - t) / 60000);
}

/**
 * The instant a wall time names in `zone`. A time inside a spring-forward gap
 * rolls to the same minutes after the gap; a fall-back time takes the earlier
 * instant (the iOS TimeQuery rules).
 */
export function zonedInstant(zone, y, mo, d, h, mi) {
  const asUTC = Date.UTC(y, mo - 1, d, h, mi);
  const candidates = new Set([offsetMinutes(zone, new Date(asUTC - 86400000)),
                              offsetMinutes(zone, new Date(asUTC)),
                              offsetMinutes(zone, new Date(asUTC + 86400000))]);
  const hits = [];
  for (const off of candidates) {
    const t = asUTC - off * 60000;
    if (offsetMinutes(zone, new Date(t)) === off) hits.push(t);
  }
  if (hits.length) return new Date(Math.min(...hits));
  // Gap: read the wall time with the offset from before the gap.
  const before = offsetMinutes(zone, new Date(asUTC - 86400000));
  return new Date(asUTC - before * 60000);
}

/** The next instant the zone's offset changes, within `horizonDays`. */
export function nextTransition(zone, from, horizonDays = 400) {
  if (isOffsetZone(zone)) return null;
  const step = 86400000;
  let a = from.getTime();
  const start = offsetMinutes(zone, from);
  for (let i = 0; i < horizonDays; i++) {
    const b = a + step;
    if (offsetMinutes(zone, new Date(b)) !== start) {
      let lo = a, hi = b;
      while (hi - lo > 60000) {
        const mid = Math.floor((lo + hi) / 2 / 60000) * 60000;
        if (offsetMinutes(zone, new Date(mid)) === start) lo = mid; else hi = mid;
      }
      return { at: new Date(hi), before: start, after: offsetMinutes(zone, new Date(hi)) };
    }
    a = b;
  }
  return null;
}

export function formatOffset(minutes) {
  if (minutes === 0) return 'UTC';
  const sign = minutes > 0 ? '+' : '−';
  const a = Math.abs(minutes);
  const h = Math.floor(a / 60), m = a % 60;
  return `UTC${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`;
}

// Abbreviations people actually use, [standard, daylight]. Intl's en-US names
// cover North America; elsewhere it mostly says "GMT+9", so these come first.
const ABBR = {
  'Asia/Tokyo': ['JST'], 'Asia/Seoul': ['KST'], 'Asia/Kolkata': ['IST'], 'Asia/Calcutta': ['IST'],
  'Asia/Shanghai': ['CST'], 'Asia/Hong_Kong': ['HKT'], 'Asia/Singapore': ['SGT'], 'Asia/Manila': ['PHT'],
  'Asia/Bangkok': ['ICT'], 'Asia/Ho_Chi_Minh': ['ICT'], 'Asia/Jakarta': ['WIB'], 'Asia/Karachi': ['PKT'],
  'Asia/Kathmandu': ['NPT'], 'Asia/Dubai': ['GST'], 'Asia/Jerusalem': ['IST', 'IDT'],
  'Europe/London': ['GMT', 'BST'], 'Europe/Dublin': ['GMT', 'IST'], 'Europe/Lisbon': ['WET', 'WEST'],
  'Europe/Moscow': ['MSK'], 'Australia/Perth': ['AWST'], 'Australia/Adelaide': ['ACST', 'ACDT'],
  'Australia/Darwin': ['ACST'], 'Australia/Brisbane': ['AEST'], 'Australia/Sydney': ['AEST', 'AEDT'],
  'Australia/Melbourne': ['AEST', 'AEDT'], 'Pacific/Auckland': ['NZST', 'NZDT'],
  'Africa/Johannesburg': ['SAST'], 'Africa/Lagos': ['WAT'], 'Africa/Nairobi': ['EAT'],
  'Africa/Maputo': ['CAT'], 'America/Sao_Paulo': ['BRT'], 'America/Argentina/Buenos_Aires': ['ART'],
};

const nameCache = new Map();
function intlShortName(zone, date, locale) {
  const key = zone + locale;
  let f = nameCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' });
    nameCache.set(key, f);
  }
  return f.formatToParts(date).find(p => p.type === 'timeZoneName')?.value ?? '';
}

function isDaylight(zone, date) {
  const y = wallParts(zone, date).y;
  const jan = offsetMinutes(zone, new Date(Date.UTC(y, 0, 1)));
  const jul = offsetMinutes(zone, new Date(Date.UTC(y, 6, 1)));
  return jan !== jul && offsetMinutes(zone, date) === Math.max(jan, jul);
}

export function abbreviation(zone, date) {
  if (isOffsetZone(zone)) return formatOffset(fixedOffset(zone));
  const known = ABBR[zone];
  if (known) return (isDaylight(zone, date) && known[1]) || known[0];
  for (const locale of ['en-US', 'en-GB']) {
    const n = intlShortName(zone, date, locale);
    if (n && !/^(GMT|UTC)/.test(n)) return n;
  }
  return formatOffset(offsetMinutes(zone, date));
}

// New IANA names older browsers do not know yet, and what they called them.
const LEGACY = { 'Europe/Kyiv': 'Europe/Kiev', 'Pacific/Kanton': 'Pacific/Enderbury',
                 'America/Ciudad_Juarez': 'America/Denver', 'America/Coyhaique': 'America/Punta_Arenas',
                 'America/Nuuk': 'America/Godthab', 'Asia/Yangon': 'Asia/Rangoon' };

function intlKnows(zone) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; }
}

/** `zone` if this browser can use it, else its older name, else null (drop the city). */
export function supportedZone(zone, isValid = intlKnows) {
  if (isOffsetZone(zone)) return zone;
  if (isValid(zone)) return zone;
  const old = LEGACY[zone];
  return old && isValid(old) ? old : null;
}
