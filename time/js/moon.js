// Moon phase from the mean synodic month (good to about half a day).

const SYNODIC = 29.530588853;
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // a known new moon

const NAMES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous',
               'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];

/** {fraction 0..1 through the cycle (0.5 = full), name, illumination 0..1}. */
export function moonPhase(date) {
  const days = (date.getTime() - NEW_MOON) / 86400000;
  const fraction = ((days / SYNODIC) % 1 + 1) % 1;
  const name = NAMES[Math.round(fraction * 8) % 8];
  const illumination = (1 - Math.cos(2 * Math.PI * fraction)) / 2;
  return { fraction, name, illumination };
}
