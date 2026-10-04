// Saved cities and preferences in this browser only. Storage can be blocked
// (private windows, cleared site data), so nothing here ever throws.

const PREFIX = 'uc.time.';

export function makeStore(storage) {
  return {
    get(key, fallback) {
      try {
        const v = storage?.getItem(PREFIX + key);
        return v == null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try { storage?.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage blocked */ }
    },
  };
}
