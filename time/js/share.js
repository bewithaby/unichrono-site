// Page state ⇄ URL, so a shared link opens the same cities and time.
// "?c=tokyo,z:UTC%2B05:30,id:123&t=2026-10-07T09:00Z&h=24"

import { isOffsetZone } from './tz.js';

export const MAX_CITIES = 12;

function validZone(z) {
  if (isOffsetZone(z)) return true;
  try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true; } catch { return false; }
}

function validRef(r) {
  if (/^[a-z0-9-]{1,60}$/.test(r)) return true;      // city page slug
  if (/^id:\d{1,9}$/.test(r)) return true;            // dataset city id
  return r.startsWith('z:') && validZone(r.slice(2)); // zone or offset
}

const stamp = d => d.toISOString().slice(0, 16) + 'Z';

export function encodeState({ cities = [], t = null, h24 = null }) {
  const parts = [];
  if (cities.length) parts.push('c=' + cities.map(c => encodeURIComponent(c).replace(/%3A/g, ':')).join(','));
  if (t) parts.push('t=' + stamp(t));
  if (h24 !== null) parts.push('h=' + (h24 ? '24' : '12'));
  return parts.length ? '?' + parts.join('&') : '';
}

/** Never throws; anything unreadable is dropped, so a bad link still opens a working tool. */
export function decodeState(search) {
  let params;
  try { params = new URLSearchParams(search); } catch { params = new URLSearchParams(); }
  const cities = [];
  for (const raw of (params.get('c') ?? '').split(',')) {
    const r = raw.trim(); // URLSearchParams has already decoded it
    if (r && validRef(r) && !cities.includes(r)) cities.push(r);
    if (cities.length === MAX_CITIES) break;
  }
  const ts = params.get('t') ?? '';
  let t = null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(ts)) {
    const d = new Date(ts.slice(0, -1) + ':00Z');
    if (!Number.isNaN(d.getTime())) t = d;
  }
  const h = params.get('h');
  return { cities, t, h24: h === '24' ? true : h === '12' ? false : null };
}
