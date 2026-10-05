// World time tool: state, data loading and wiring. Pure logic lives in the
// other modules (tested with node --test); this file is the page glue.

import { wallParts, zonedInstant, offsetMinutes, abbreviation, nextTransition, formatOffset, isOffsetZone, supportedZone } from './tz.js';
import { parseConversion, queryInstant, resolvePlace } from './parse.js';
import { bestOverlap, mark } from './work.js';
import { sunTimes } from './sun.js';
import { moonPhase } from './moon.js';
import { encodeState, decodeState, shareRefs, MAX_CITIES } from './share.js';
import { googleURL, outlookURL, icsText, timesText } from './calendar.js';
import { makeStore } from './store.js';
import { clockOffset, clockText } from './clock.js';
import { timeText, dayText, diffText, dayColumns, homeZone, stepColumn, nextChangeText } from './format.js';
import { renderGrid, updateTimes, columnOf, flag } from './grid.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let storage = null;
try { storage = window.localStorage; } catch { /* blocked */ }
const store = makeStore(storage);
const DEFAULTS = ['london', 'new-york', 'tokyo', 'sydney'];

// ---------- data ----------
let pages = [], bySlug = new Map(), slugById = new Map();
let search = null, searchPromise = null, cityById = new Map(), airports = new Map(), repByZone = new Map();

function pageCity(r) {
  return { slug: r[0], id: r[1], name: r[2], country: r[3], cc: r[4], zone: r[5], lat: r[6], lng: r[7], pop: r[8] };
}

async function loadPages() {
  const res = await fetch('/time/data/pages.json');
  pages = (await res.json()).map(pageCity);
  for (const p of pages) { bySlug.set(p.slug, p); slugById.set(p.id, p.slug); }
}

function loadSearch() {
  if (!searchPromise) {
    searchPromise = fetch('/time/data/search.json').then(r => r.json()).then(d => {
      search = d.c.map(r => ({ id: r[0], name: r[1], country: r[2], cc: r[3], zone: r[4], lat: r[5], lng: r[6], pop: r[7],
                               lname: r[1].toLowerCase(), words: ' ' + (r[8] || '').toLowerCase() + ' ' }));
      for (const c of search) {
        cityById.set(c.id, c);
        if (!repByZone.has(c.zone)) repByZone.set(c.zone, c);
      }
      for (const [iata, name, cityId] of d.a) airports.set(iata, { name, cityId });
    });
  }
  return searchPromise;
}

const lookups = {
  cities(text) {
    const t = text.toLowerCase().trim();
    const out = [];
    if (!search || !t) return out;
    for (const c of search) {
      if (c.lname.startsWith(t) || (t.length >= 3 && c.words.includes(' ' + t))) {
        const zone = supportedZone(c.zone);
        if (!zone) continue;
        out.push({ name: c.name, zone, cityId: c.id });
        if (out.length === 8) break;
      }
    }
    return out;
  },
  airport(code) {
    const a = airports.get(code.toUpperCase());
    const c = a && cityById.get(a.cityId);
    const zone = c && supportedZone(c.zone);
    return zone ? { iata: code.toUpperCase(), name: a.name, cityName: c.name, zone, cityId: c.id } : null;
  },
  representative(zone) {
    const c = repByZone.get(zone);
    return c ? { name: c.name, cityId: c.id } : null;
  },
};

// ---------- cities ----------
// Every city object's zone is one this browser can use (or the city is
// dropped): one unknown zone must not take the whole tool down.
function zoneCity(rawZone, label) {
  const zone = supportedZone(rawZone);
  if (!zone) return null;
  const name = label || (isOffsetZone(zone) ? formatOffset(offsetMinutes(zone, new Date())) : zone.split('/').pop().replace(/_/g, ' '));
  return { ref: 'z:' + zone, label: name, name, country: '', cc: '', zone, lat: null, lng: null, pop: 0 };
}

function fromCity(c, label) {
  const zone = supportedZone(c.zone);
  if (!zone) return null;
  const slug = slugById.get(c.id);
  return { ref: slug ?? 'id:' + c.id, label: label || c.name, name: c.name, country: c.country, cc: c.cc,
           zone, lat: c.lat, lng: c.lng, pop: c.pop };
}

async function resolveRef(ref, label) {
  if (ref.startsWith('z:')) return zoneCity(ref.slice(2), label);
  if (ref.startsWith('id:')) {
    await loadSearch();
    const c = cityById.get(Number(ref.slice(3)));
    return c ? fromCity(c, label) : null;
  }
  const p = bySlug.get(ref);
  return p ? fromCity(p, label) : null;
}

// ---------- state ----------
const HOME = homeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
const state = {
  home: null,           // city object for the visitor's zone
  cities: [],           // other cities, in order
  t: null,              // selected instant; null = live now
  h24: false,
  fromLink: false,      // showing a shared link: don't overwrite saved cities until an edit
  detail: null,         // ref of the open detail panel
};

function homeCity() {
  const p = pages.find(p => supportedZone(p.zone) === HOME);
  const c = (p && fromCity(p)) || zoneCity(HOME) || zoneCity('UTC');
  return { ...c, home: true };
}

const rows = () => [state.home, ...state.cities].map(c => ({ key: c.ref, label: c.label, cc: c.cc, zone: c.zone,
                                                            home: !!c.home, transient: !!c.transient }));
const allCities = () => [state.home, ...state.cities];
const shown = () => state.t ?? new Date();

/** Saves the list; a city page's own city (not yet kept) is never saved by itself. */
function save() {
  state.fromLink = false;
  store.set('cities', state.cities.filter(c => !c.transient)
    .map(c => ({ ref: c.ref, label: c.label === c.name ? null : c.label })));
}

const customised = () => store.get('cities', null) !== null;

let toastTimer = null;
function toast(text, undo) {
  const el = $('toast');
  el.innerHTML = `<span>${esc(text)}</span>` + (undo ? '<button type="button" data-act="undo">Undo</button>' : '');
  el.hidden = false;
  const btn = el.querySelector('[data-act="undo"]');
  if (btn) btn.onclick = () => { undo(); el.hidden = true; };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
}

function removeCity(ref) {
  const i = state.cities.findIndex(c => c.ref === ref);
  if (i < 0) return;
  const [city] = state.cities.splice(i, 1);
  if (state.detail === ref) { state.detail = null; $('detail').hidden = true; }
  save();
  render();
  toast(`Removed ${city.label}`, () => { state.cities.splice(Math.min(i, state.cities.length), 0, city); save(); render(); });
}

function keepCity(ref) {
  const c = state.cities.find(c => c.ref === ref);
  if (!c) return;
  c.transient = false;
  save();
  render();
  toast(`${c.label} added to your cities`);
}

async function resetCities() {
  store.set('cities', null);
  const kept = state.cities.filter(c => c.transient);
  state.cities = [...kept];
  for (const ref of DEFAULTS) {
    const p = bySlug.get(ref);
    if (state.cities.length >= 3 + kept.length) break;
    const c = p && fromCity(p);
    if (c && c.zone !== HOME && !has(c)) state.cities.push(c);
  }
  state.detail = null;
  $('detail').hidden = true;
  render();
  toast('Back to the default cities');
}

function columns() {
  const w = wallParts(HOME, shown());
  return dayColumns(HOME, w.y, w.mo, w.d);
}

// ---------- render ----------
let lastRender = '';
function render() {
  const now = new Date(), at = shown(), cols = columns();
  const m = { rows: rows(), cols, at, now, h24: state.h24, homeZone: HOME };
  const grid = $('grid');
  renderGrid(grid, m);
  revealSelected(grid);
  lastRender = `${columnOf(cols, at)}|${columnOf(cols, now)}|${cols[0].getTime()}`;
  const w = wallParts(HOME, at);
  $('date').value = `${w.y}-${String(w.mo).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
  $('slider').value = String(Math.floor((w.h * 60 + w.mi) / 15) * 15);
  $('sel').textContent = state.t
    ? `Selected ${timeText(HOME, at, state.h24)}, ${dayText(HOME, at)} your time`
    : 'Showing the time now';
  $('now').hidden = !state.t;
  $('reset').hidden = !customised();
  $('fmt').setAttribute('aria-pressed', String(state.h24));
  renderMeeting(cols);
  renderActions();
  if (state.detail) renderDetail();
}

/** Keep the selected (or current) hour in view when the grid scrolls sideways. */
function revealSelected(grid) {
  const wrap = $('gridwrap');
  const cell = grid.querySelector('.c.sel') || grid.querySelector('.c.now');
  const head = grid.querySelector('.rh');
  if (!cell || !head) return;
  const left = cell.offsetLeft - head.offsetWidth, right = cell.offsetLeft + cell.offsetWidth;
  if (left < wrap.scrollLeft || right > wrap.scrollLeft + wrap.clientWidth) {
    // centre it in the part of the grid not covered by the sticky names
    wrap.scrollLeft = Math.max(0, cell.offsetLeft - head.offsetWidth - (wrap.clientWidth - head.offsetWidth - cell.offsetWidth) / 2);
  }
}

function tick() {
  renderLive();
  if (state.t) return;
  const now = new Date(), cols = columns();
  const key = `${columnOf(cols, now)}|${columnOf(cols, now)}|${cols[0].getTime()}`;
  if (key !== lastRender) return render();
  updateTimes($('grid'), { rows: rows(), cols, at: now, now, h24: state.h24, homeZone: HOME });
}

function renderLive() {
  const next = $('zone-next');
  if (next) {
    const zone = supportedZone(next.dataset.zone);
    const text = zone ? nextChangeText(zone, new Date()) : '';
    if (next.textContent !== text) next.textContent = text;
  }
  const el = $('live');
  const slug = document.body.dataset.preload;
  const c = slug && allCities().find(c => c.ref === slug);
  if (!c) { el.textContent = ''; return; }
  const now = new Date();
  const s = String(now.getUTCSeconds()).padStart(2, '0');
  const t = timeText(c.zone, now, state.h24).replace(/^(\d+:\d+)/, `$1:${s}`);
  el.innerHTML = `${esc(t)}<small>${esc(dayText(c.zone, now))} · ${esc(abbreviation(c.zone, now))}</small>`;
}

function renderMeeting(cols) {
  const el = $('meet');
  const cities = allCities();
  if (cities.length < 2) { el.innerHTML = '<p>Add a city to find a time that suits everyone.</p>'; return; }
  const best = bestOverlap(cities.map(c => c.zone), cols[0], cols.length);
  if (!best) {
    el.innerHTML = `<b>No time works for everyone on ${esc(dayText(HOME, cols[0]))}.</b><p>Someone is outside 8 am – 6 pm or it is their weekend. Try another date or fewer cities.</p>`;
    return;
  }
  const all = best.score === cities.length;
  const items = cities.map(c => `<li>${flag(c.cc)} ${esc(c.label)} <b>${esc(timeText(c.zone, best.start, state.h24))}–${esc(timeText(c.zone, best.end, state.h24))}</b></li>`).join('');
  el.innerHTML = `<b>${all ? 'Best meeting time — everyone in work hours' : 'Best meeting time — some at the edge of their day'}</b>`
    + `<ul>${items}</ul><p><button type="button" class="chip" id="pickbest">Select this time</button></p>`;
  $('pickbest').onclick = () => { state.t = best.start; render(); };
}

function event() {
  let start = state.t;
  if (!start) { start = new Date(); start.setUTCMinutes(0, 0, 0); start = new Date(start.getTime() + 3600000); }
  const end = new Date(start.getTime() + 3600000);
  const lines = allCities().map(c => ({ label: c.label, time: timeText(c.zone, start, state.h24), day: dayText(c.zone, start) }));
  return { title: 'Meeting', start, end, details: timesText(lines, 'Times') + '\n\nPlanned with https://unichrono.app/time/' , lines };
}

function renderActions() {
  const ev = event();
  $('gcal').href = googleURL(ev);
  $('ocal').href = outlookURL(ev);
}

function flash(btn, text) {
  const old = btn.dataset.label ?? btn.textContent;
  btn.dataset.label = old;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 1600);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// ---------- detail panel ----------
async function renderDetail() {
  const c = allCities().find(c => c.ref === state.detail);
  const el = $('detail');
  if (!c) { el.hidden = true; state.detail = null; return; }
  const at = shown();
  const off = offsetMinutes(c.zone, at), homeOff = offsetMinutes(HOME, at);
  const tr = nextTransition(c.zone, at);
  const facts = [
    ['Time', `${timeText(c.zone, at, state.h24)}, ${dayText(c.zone, at)}`],
    ['Difference', c.home ? 'Your time zone' : diffText(off - homeOff) + ' of you'],
    ['UTC offset', formatOffset(off)],
    ['Abbreviation', abbreviation(c.zone, at)],
    ['Time zone', c.zone],
    ['Clock changes', tr ? `${dayText(c.zone, tr.at)} ${wallParts(c.zone, tr.at).y} → ${formatOffset(tr.after)}` : 'No change in the next year'],
    ['Right now', mark(c.zone, at).word],
  ];
  if (c.lat != null && c.lng != null) {
    const sun = sunTimes(c.lat, c.lng, c.zone, at);
    if (sun.polar) facts.push(['Sun', sun.polar === 'day' ? 'Up all day (midnight sun)' : 'Down all day (polar night)']);
    else {
      facts.push(['Sunrise', timeText(c.zone, sun.rise, state.h24)], ['Sunset', timeText(c.zone, sun.set, state.h24)],
                 ['Daylight', `${Math.floor(sun.dayLengthMin / 60)} h ${sun.dayLengthMin % 60} min`]);
    }
    facts.push(['Coordinates', `${c.lat.toFixed(2)}, ${c.lng.toFixed(2)}`]);
  }
  const moon = moonPhase(at);
  facts.push(['Moon', `${moon.name}, ${Math.round(moon.illumination * 100)}% lit`]);
  if (c.country) facts.push(['Country', `${flag(c.cc)} ${c.country}`]);
  if (c.pop) facts.push(['Population', c.pop.toLocaleString('en')]);

  const i = state.cities.indexOf(c);
  const tools = c.home ? '' : `<div class="rowtools">
      <input id="rename" value="${esc(c.label)}" aria-label="Name for this city" maxlength="40">
      <button class="chip" id="dsave" type="button">Rename</button>
      <button class="chip" id="dup" type="button" ${i === 0 ? 'disabled' : ''}>Move up</button>
      <button class="chip" id="ddown" type="button" ${i === state.cities.length - 1 ? 'disabled' : ''}>Move down</button>
      <button class="chip" id="dremove" type="button">Remove</button></div>`;
  const page = bySlug.has(c.ref) && document.body.dataset.preload !== c.ref ? ` <a class="chip" href="/time/${c.ref}/">City page</a>` : '';
  el.innerHTML = `<h2>${flag(c.cc)} ${esc(c.label)}${c.label !== c.name ? ` <small>(${esc(c.name)})</small>` : ''}${page}
      <button class="chip close" id="dclose" type="button">Close</button></h2>
    <dl>${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <h3>Public holidays</h3><ul id="hol"><li>${c.cc ? 'Loading…' : 'Not available for a UTC offset.'}</li></ul>${tools}`;
  el.hidden = false;
  $('dclose').onclick = () => { state.detail = null; el.hidden = true; };
  if (!c.home) {
    $('dsave').onclick = () => { const v = $('rename').value.trim(); c.label = v || c.name; save(); render(); };
    $('dup').onclick = () => move(i, -1);
    $('ddown').onclick = () => move(i, 1);
    $('dremove').onclick = () => removeCity(c.ref);
  }
  if (c.cc) renderHolidays(c, at);
}

const holidayCache = new Map();
async function renderHolidays(c, at) {
  let list = holidayCache.get(c.cc);
  if (list === undefined) {
    try {
      const r = await fetch(`/time/data/holidays/${c.cc}.json`);
      list = r.ok ? await r.json() : null;
    } catch { list = null; }
    holidayCache.set(c.cc, list);
  }
  const el = $('hol');
  if (!el || state.detail !== c.ref) return;
  if (!list) { el.innerHTML = '<li>No holiday data for this country.</li>'; return; }
  const w = wallParts(c.zone, at);
  const today = `${w.y}-${String(w.mo).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
  const next = list.filter(([d]) => d >= today).slice(0, 5);
  el.innerHTML = next.length
    ? next.map(([d, n]) => {
        const dt = new Date(d + 'T12:00:00Z');
        return `<li><b>${esc(dayText('UTC', dt))} ${dt.getUTCFullYear()}</b> — ${esc(n)}</li>`;
      }).join('')
    : '<li>None listed in the coming months.</li>';
}

function move(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= state.cities.length) return;
  [state.cities[i], state.cities[j]] = [state.cities[j], state.cities[i]];
  save();
  render();
}

// ---------- adding ----------
async function placeCity(p) {
  if (p.kind === 'saved') return null;
  if (p.kind === 'offset') return zoneCity(p.zone, p.label);
  if (p.cityId != null) {
    await loadSearch();
    const c = cityById.get(p.cityId);
    const city = c && fromCity(c);
    if (city) return city;
  }
  return zoneCity(p.zone);
}

function has(city) {
  return allCities().some(c => c.ref === city.ref);
}

async function addPlace(p) {
  const c = await placeCity(p);
  if (!c || has(c)) return;
  if (state.cities.length >= MAX_CITIES - 1) { $('preview').textContent = `Up to ${MAX_CITIES} cities. Remove one first.`; return; }
  state.cities.push(c);
  save();
  $('q').value = '';
  clearSmart();
  render();
}

// ---------- smart box ----------
let suggestions = [], active = -1, pendingJump = null;

function clearSmart() {
  $('preview').innerHTML = '';
  $('sugg').innerHTML = '';
  suggestions = []; active = -1; pendingJump = null;
}

const savedForResolve = () => allCities().map(c => ({ id: c.ref, label: c.label, name: c.name, zone: c.zone }));

function placeFor(text) {
  if (!text || text === 'here') return { kind: 'saved', zone: HOME, label: state.home.label, cityId: null };
  return resolvePlace(text, lookups, savedForResolve())[0] ?? null;
}

async function onInput() {
  const text = $('q').value.trim();
  if (!text) return clearSmart();
  if (!search) { $('preview').textContent = 'Loading cities…'; await loadSearch(); }
  if ($('q').value.trim() !== text) return;
  const conv = parseConversion(text);
  if (conv) {
    $('sugg').innerHTML = ''; suggestions = [];
    const src = placeFor(conv.query.place);
    if (!src) { $('preview').textContent = `No place called “${conv.query.place}”.`; pendingJump = null; return; }
    const dst = conv.target ? placeFor(conv.target) : null;
    if (conv.target && !dst) { $('preview').textContent = `No place called “${conv.target}”.`; pendingJump = null; return; }
    const at = queryInstant(conv.query, src.zone, new Date(), state.h24);
    const other = dst ?? { zone: HOME, label: state.home.label };
    pendingJump = { at, adds: [src, dst].filter(p => p && p.kind !== 'saved') };
    const addBtns = await Promise.all(pendingJump.adds.map(async (p, k) => {
      const c = await placeCity(p);
      return c && !has(c) ? `<button class="chip" type="button" data-add="${k}">Add ${esc(c.label)}</button>` : '';
    }));
    $('preview').innerHTML = `<span><b>${esc(timeText(src.zone, at, state.h24))} ${esc(dayText(src.zone, at))}</b> ${esc(src.label)}`
      + ` = <b>${esc(timeText(other.zone, at, state.h24))} ${esc(dayText(other.zone, at))}</b> ${esc(other.label)}</span>`
      + `<button class="chip accent" type="button" id="jump">Show on grid ↵</button>${addBtns.join('')}`;
    $('jump').onclick = jump;
    $('preview').querySelectorAll('[data-add]').forEach(b => { b.onclick = () => addPlace(pendingJump.adds[Number(b.dataset.add)]); });
    return;
  }
  pendingJump = null;
  suggestions = resolvePlace(text, lookups, savedForResolve()).filter(p => p.kind !== 'saved').slice(0, 8);
  active = suggestions.length ? 0 : -1;
  $('preview').textContent = suggestions.length ? '' : `Nothing found for “${text}”. Try a city, airport code (LHR), abbreviation (PST) or UTC+5:30.`;
  renderSuggestions();
}

function renderSuggestions() {
  const now = new Date();
  $('sugg').innerHTML = suggestions.map((p, i) => {
    const c = p.cityId != null ? cityById.get(p.cityId) : null;
    const where = c && p.kind !== 'abbreviation' ? `${c.country}` : p.zone;
    return `<li role="option" id="s${i}" aria-selected="${i === active}" data-i="${i}">
      <span>${c ? flag(c.cc) + ' ' : ''}${esc(p.label)} <small>${esc(where)} · ${esc(timeText(p.zone, now, state.h24))}</small></span>
      <span class="chip">Add</span></li>`;
  }).join('');
  $('q').setAttribute('aria-activedescendant', active >= 0 ? `s${active}` : '');
}

function jump() {
  if (!pendingJump) return;
  state.t = pendingJump.at;
  render();
  $('sel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---------- wiring ----------
function select(at) { state.t = at; render(); }

function wire() {
  const grid = $('grid');
  let dragging = false;
  const cellAt = (x, y) => document.elementFromPoint(x, y)?.closest('.c');
  // Mouse: press and drag across hours. Touch: a tap selects and a swipe
  // scrolls the grid sideways, so it never drag-selects.
  grid.addEventListener('pointerdown', e => {
    const cell = e.target.closest('.c');
    if (!cell || e.pointerType !== 'mouse') return;
    dragging = true;
    select(columns()[Number(cell.dataset.i)]);
  });
  grid.addEventListener('pointermove', e => {
    if (!dragging) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (cell && grid.contains(cell)) {
      const at = columns()[Number(cell.dataset.i)];
      if (!state.t || at.getTime() !== state.t.getTime()) select(at);
    }
  });
  window.addEventListener('pointerup', () => { dragging = false; });
  grid.addEventListener('click', e => {
    const act = e.target.closest('[data-act]');
    if (act) {
      const ref = act.dataset.key, i = state.cities.findIndex(c => c.ref === ref);
      if (act.dataset.act === 'remove') removeCity(ref);
      else if (act.dataset.act === 'keep') keepCity(ref);
      else if (act.dataset.act === 'up') move(i, -1);
      else if (act.dataset.act === 'down') move(i, 1);
      return;
    }
    const cell = e.target.closest('.c');
    if (cell && e.pointerType !== 'mouse') return select(columns()[Number(cell.dataset.i)]);
    const b = e.target.closest('[data-open]');
    if (b) { state.detail = b.dataset.open; renderDetail(); $('detail').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  });
  grid.addEventListener('keydown', e => {
    const cols = columns();
    if (e.key === 'ArrowRight') select(stepColumn(HOME, shown(), 1));
    else if (e.key === 'ArrowLeft') select(stepColumn(HOME, shown(), -1));
    else if (e.key === 'Home') select(cols[0]);
    else if (e.key === 'End') select(cols[cols.length - 1]);
    else if (e.key === 'Escape') { state.t = null; render(); }
    else return;
    e.preventDefault();
  });
  $('slider').addEventListener('input', e => {
    const w = wallParts(HOME, shown()), v = Number(e.target.value);
    select(zonedInstant(HOME, w.y, w.mo, w.d, Math.floor(v / 60), v % 60));
  });
  $('date').addEventListener('change', e => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.target.value);
    if (!m) return;
    const w = wallParts(HOME, shown());
    select(zonedInstant(HOME, Number(m[1]), Number(m[2]), Number(m[3]), w.h, w.mi));
  });
  $('now').onclick = () => { state.t = null; render(); };
  $('addcity').onclick = () => {
    $('q').focus();
    if (!$('q').value) $('preview').textContent = 'Type a city, an airport code (LHR), an abbreviation (PST) or UTC+5:30.';
  };
  $('reset').onclick = resetCities;
  $('fmt').onclick = () => { state.h24 = !state.h24; store.set('h24', state.h24); render(); };
  $('theme').onclick = () => {
    const next = currentTheme() === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('uc-theme', next); } catch { /* storage blocked */ }
    themeButton();
    document.getElementById('themeb')?.dispatchEvent(new Event('uc-repaint'));
  };
  themeButton();
  document.addEventListener('uc-theme', themeButton);
  $('ics').onclick = () => {
    const blob = new Blob([icsText(event())], { type: 'text/calendar' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'meeting.ics';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('copy').onclick = async () => {
    const ev = event();
    flash($('copy'), await copy(timesText(ev.lines, `Times for ${dayText(HOME, ev.start)}`)) ? 'Copied' : 'Copy failed');
  };
  $('share').onclick = async () => {
    const url = location.origin + '/time/' + encodeState({ cities: shareRefs(state.home.ref, state.cities.map(c => c.ref)), t: state.t, h24: state.h24 });
    if (navigator.share) {
      try { await navigator.share({ title: 'World time', url }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    flash($('share'), await copy(url) ? 'Link copied' : url);
  };

  const q = $('q');
  let timer = null;
  q.addEventListener('focus', () => { loadSearch(); }, { once: true });
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(onInput, 120); });
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' && suggestions.length) { active = (active + 1) % suggestions.length; renderSuggestions(); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && suggestions.length) { active = (active - 1 + suggestions.length) % suggestions.length; renderSuggestions(); e.preventDefault(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(timer);
      onInput().then(() => { if (pendingJump) jump(); else if (active >= 0) addPlace(suggestions[active]); });
    } else if (e.key === 'Escape') { q.value = ''; clearSmart(); }
  });
  $('sugg').addEventListener('click', e => {
    const li = e.target.closest('li');
    if (li) addPlace(suggestions[Number(li.dataset.i)]);
  });

  const mb = $('menub'), nv = $('nav');
  mb.addEventListener('click', () => { const o = nv.classList.toggle('open'); mb.setAttribute('aria-expanded', String(o)); });
}

const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

function currentTheme() {
  // Dark until the visitor picks light, the same rule as every other page.
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/** The switch names the theme it switches TO, with its icon. */
function themeButton() {
  const toLight = currentTheme() !== 'light';
  $('theme').innerHTML = `${toLight ? SUN : MOON}<span>${toLight ? 'Light' : 'Dark'}</span>`;
  $('theme').setAttribute('aria-label', toLight ? 'Switch to light theme' : 'Switch to dark theme');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', toLight ? '#0E1220' : '#F4F1E9');
}

async function checkClock() {
  try {
    const sent = Date.now();
    const r = await fetch('/time/', { method: 'HEAD', cache: 'no-store' });
    const recv = Date.now();
    const off = clockOffset(r.headers.get('Date') ?? '', sent, recv);
    if (off !== null) $('clock').textContent = clockText(off);
  } catch { /* offline: say nothing */ }
}

async function start() {
  wire();
  await loadPages();
  state.home = homeCity();
  state.h24 = store.get('h24', false) === true;
  const link = decodeState(location.search);
  if (link.h24 !== null) state.h24 = link.h24;
  if (link.t) state.t = link.t;
  let refs;
  if (link.cities.length) { refs = link.cities.map(ref => ({ ref })); state.fromLink = true; }
  else {
    const saved = store.get('cities', null);
    refs = Array.isArray(saved) ? saved.filter(s => s && typeof s.ref === 'string')
         : DEFAULTS.map(ref => ({ ref })).filter(r => bySlug.get(r.ref)?.zone !== HOME).slice(0, 3);
  }
  const preload = document.body.dataset.preload;
  if (preload && !refs.some(r => r.ref === preload) && bySlug.has(preload)) refs.unshift({ ref: preload, transient: true });
  for (const r of refs) {
    const c = await resolveRef(r.ref, r.label);
    if (c && !has(c) && state.cities.length < MAX_CITIES - 1) {
      if (r.transient) c.transient = true;
      state.cities.push(c);
    }
  }
  render();
  renderLive();
  setInterval(tick, 1000);
  checkClock();
}

start();
