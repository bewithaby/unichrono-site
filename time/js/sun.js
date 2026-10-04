// Sunrise and sunset (SunCalc maths, as on the home page). Two traps from
// the home page apply: the set transit uses (w + lw), and the day is the
// CITY's local day, anchored at its local noon, not the UTC day.

import { wallParts, zonedInstant } from './tz.js';

const RAD = Math.PI / 180, DAY_MS = 86400000, J1970 = 2440588, J2000 = 2451545;
const toJ = d => d.getTime() / DAY_MS - 0.5 + J1970, toD = d => toJ(d) - J2000;
const fromJ = j => new Date((j + 0.5 - J1970) * DAY_MS);
const solarM = d => RAD * (357.5291 + 0.98560028 * d);
const eclipL = M => M + RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + RAD * 102.9372 + Math.PI;
const decl = l => Math.asin(Math.sin(RAD * 23.4397) * Math.sin(l));

function altitude(date, lat, lng) {
  const lw = RAD * -lng, phi = RAD * lat, d = toD(date);
  const L = eclipL(solarM(d)), dec = decl(L);
  const ra = Math.atan2(Math.sin(L) * Math.cos(RAD * 23.4397), Math.cos(L));
  const H = RAD * (280.16 + 360.9856235 * d) - lw - ra;
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
}

/** {rise, set, dayLengthMin} for the city-local day containing `date`, or {polar}. */
export function sunTimes(lat, lng, zone, date) {
  const w = wallParts(zone, date);
  const noon = zonedInstant(zone, w.y, w.mo, w.d, 12, 0);
  const lw = RAD * -lng, phi = RAD * lat, d = toD(noon);
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const M = solarM(d), L = eclipL(M), dec = decl(L);
  const Jnoon = J2000 + (0.0009 + lw / (2 * Math.PI) + n) + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const cosH = (Math.sin(-0.833 * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosH > 1 || cosH < -1) return { polar: altitude(noon, lat, lng) > -0.833 * RAD ? 'day' : 'night' };
  const h = Math.acos(cosH);
  const Jset = J2000 + (0.0009 + (h + lw) / (2 * Math.PI) + n) + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const rise = fromJ(2 * Jnoon - Jset), set = fromJ(Jset);
  return { rise, set, dayLengthMin: Math.round((set - rise) / 60000) };
}
