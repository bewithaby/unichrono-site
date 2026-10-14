// The hub's finder (/time/ "Find your time zone, country or city"). Every
// group is on show and every link is plain HTML; this filters them as the
// visitor types and hands the text to the converter, which knows every place.

/** Lowercase, accents folded, so "zurich" finds "Zürich" and "sao" finds "São". */
export function fold(text) {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Every word of the query starts a word of the item's text: "new y" finds New York. */
export function matches(itemText, query) {
  const words = ` ${fold(itemText)}`;
  return fold(query).split(' ').filter(Boolean).every(w => words.includes(` ${w}`));
}

/** The finder's text, put into the converter's box as if typed there. */
function handOff(text) {
  const q = document.getElementById('q');
  if (!q) return;
  q.value = text;
  document.getElementById('tool')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  q.focus({ preventScroll: true });
  q.dispatchEvent(new Event('input', { bubbles: true }));
}

export function wireDirectory(root = document.getElementById('find')) {
  if (!root) return;
  const input = root.querySelector('#dirq');
  const groups = [...root.querySelectorAll('.dgroup')];
  const empty = root.querySelector('.dempty');
  const hand = root.querySelector('.handoff');
  const all = root.querySelector('.allcities');

  function show() {
    const q = input.value.trim();
    let any = false;
    for (const g of groups) {
      let hits = 0;
      if (g.dataset.g === 'conv') {
        // A row stays whole when its "from" zone matches; otherwise it keeps only the matching targets.
        for (const row of g.querySelectorAll('.convrow')) {
          const whole = !q || matches(row.dataset.s, q) || matches(row.querySelector('.zfrom').textContent, q);
          let kept = 0;
          for (const li of row.querySelectorAll('li')) {
            const on = whole || matches(li.dataset.s, q) || matches(li.textContent, q);
            li.hidden = !on;
            kept += on;
          }
          row.hidden = !kept;
          hits += kept;
        }
      } else {
        // While searching, the short city list steps aside so a match is never shown twice.
        for (const li of g.querySelectorAll('li[data-s]')) {
          const inAll = !!li.closest('.allcities');
          const on = (!q || matches(li.dataset.s, q) || matches(li.textContent, q)) && (!q || inAll || g.dataset.g !== 'cities');
          li.hidden = !on;
          hits += on;
        }
        for (const c of g.querySelectorAll('.cont')) c.hidden = !c.querySelector('li:not([hidden])');
      }
      g.hidden = !!q && !hits;
      any ||= !g.hidden;
    }
    if (all) {
      if (q) { all.dataset.wasOpen ??= String(all.open); all.open = true; }
      else if (all.dataset.wasOpen !== undefined) { all.open = all.dataset.wasOpen === 'true'; delete all.dataset.wasOpen; }
    }
    root.classList.toggle('searching', !!q);
    hand.hidden = !q;
    hand.textContent = q ? `Search “${q}” in the converter →` : '';
    empty.hidden = any || !q;
  }

  input.addEventListener('input', show);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && input.value.trim()) handOff(input.value.trim()); });
  hand.addEventListener('click', () => handOff(input.value.trim()));
  show();

  // Live times on the zone and country chips.
  const fmt = new Map();
  function tick() {
    const now = new Date();
    for (const el of root.querySelectorAll('.znow[data-zone]')) {
      const zone = el.dataset.zone;
      try {
        if (!fmt.has(zone)) fmt.set(zone, new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }));
        el.textContent = fmt.get(zone).format(now);
      } catch { el.textContent = ''; }
    }
  }
  tick();
  setInterval(tick, 15000);
}
