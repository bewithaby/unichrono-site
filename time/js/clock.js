// How far this device's clock is from unichrono.app's server clock, from the
// response's Date header (1 s resolution) corrected for half the round trip.

/** Server minus device, in ms; null when the header is unreadable. */
export function clockOffset(dateHeader, sentMs, receivedMs) {
  const server = Date.parse(dateHeader);
  if (Number.isNaN(server)) return null;
  return Math.round(server - (sentMs + receivedMs) / 2);
}

export function clockText(offsetMs) {
  const a = Math.abs(offsetMs);
  if (a < 500) return 'Your clock is about right';
  const dir = offsetMs > 0 ? 'slow' : 'fast';
  if (a < 60000) return `Your clock is ${(a / 1000).toFixed(1)} s ${dir}`;
  const m = Math.floor(a / 60000), s = Math.round((a % 60000) / 1000);
  return `Your clock is ${m} min${s ? ` ${s} s` : ''} ${dir}`;
}
