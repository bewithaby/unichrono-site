// Extras for the /time/ pages that are not the converter itself: the
// visitor's own recent pages (kept in this browser only, never sent
// anywhere), live times on the hub's zone and country chips, and the
// dismissible "how it works" strip.

const RECENT = 'uc.time.recent';
const STEPS = 'uc.time.steps';
const MAX_RECENT = 8;

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: no memory, no harm */ }
}

/** [{path, label}] with this page first, no duplicates, at most MAX_RECENT. */
export function remember(list, path, label) {
  return [{ path, label }, ...list.filter(r => r && r.path !== path)].slice(0, MAX_RECENT);
}

/** Every page below /time/ notes itself; the hub lists them. */
function rememberVisit() {
  const path = location.pathname;
  if (!/^\/time\/[a-z0-9-]+\/$/.test(path)) return;
  const label = document.querySelector('.city-static h1')?.textContent.trim();
  if (label) write(RECENT, remember(read(RECENT, []), path, label));
}

function showRecent() {
  const box = document.getElementById('recent');
  if (!box) return;
  const list = read(RECENT, []).filter(r => r && typeof r.path === 'string' && /^\/time\/[a-z0-9-]+\/$/.test(r.path));
  const group = box.closest('.dgroup');
  group.hidden = !list.length;
  box.replaceChildren(...list.map(r => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'chipl';
    a.href = r.path;
    a.textContent = r.label;
    li.append(a);
    return li;
  }));
  document.getElementById('recentclear').onclick = () => { write(RECENT, []); showRecent(); };
}

function wireSteps() {
  const steps = document.getElementById('steps');
  if (!steps) return;
  if (read(STEPS, '') === 'hidden') steps.hidden = true;
  document.getElementById('stepsclose').onclick = () => { steps.hidden = true; write(STEPS, 'hidden'); };
}

function liveTimes() {
  const els = [...document.querySelectorAll('.znow[data-zone]')];
  if (!els.length) return;
  const fmt = new Map();
  const tick = () => {
    const now = new Date();
    for (const el of els) {
      try {
        if (!fmt.has(el.dataset.zone)) fmt.set(el.dataset.zone, new Intl.DateTimeFormat('en-US', { timeZone: el.dataset.zone, hour: 'numeric', minute: '2-digit' }));
        el.textContent = fmt.get(el.dataset.zone).format(now);
      } catch { el.textContent = ''; }
    }
  };
  tick();
  setInterval(tick, 15000);
}

export function wireExtras() {
  rememberVisit();
  showRecent();
  wireSteps();
  liveTimes();
}
