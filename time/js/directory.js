// The hub's finder (/time/ "Find your time zone, country or city"). The page
// ships every link as plain HTML; this only filters them and shows one group
// at a time. Without JavaScript all five groups are simply listed.

/** Lowercase, accents folded, so "zurich" finds "Zürich" and "sao" finds "São". */
export function fold(text) {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Every word of the query starts a word of the item's text: "new y" finds New York. */
export function matches(itemText, query) {
  const words = ` ${fold(itemText)}`;
  return fold(query).split(' ').filter(Boolean).every(w => words.includes(` ${w}`));
}

export function wireDirectory(root = document.getElementById('find')) {
  if (!root) return;
  const input = root.querySelector('#dirq');
  const tabs = [...root.querySelectorAll('.dtab')];
  const groups = [...root.querySelectorAll('.dgroup')];
  const empty = root.querySelector('.dempty');
  let current = groups[0]?.dataset.g;
  root.querySelector('.dtabs').hidden = false;
  root.classList.add('js');

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
        for (const li of g.querySelectorAll('li[data-s]')) {
          const on = !q || matches(li.dataset.s, q) || matches(li.textContent, q);
          li.hidden = !on;
          hits += on;
        }
        for (const c of g.querySelectorAll('.cont')) c.hidden = !c.querySelector('li:not([hidden])');
      }
      // Typing searches every group at once; an empty box shows the chosen tab.
      g.hidden = q ? !hits : g.dataset.g !== current;
      any ||= !g.hidden;
    }
    root.classList.toggle('searching', !!q);
    empty.hidden = any;
  }

  for (const t of tabs) {
    t.addEventListener('click', () => {
      current = t.dataset.g;
      for (const x of tabs) x.setAttribute('aria-pressed', String(x === t));
      input.value = '';
      show();
    });
  }
  input.addEventListener('input', show);
  show();

  // Live times on the zone and country cards.
  const fmt = new Map();
  function tick() {
    const now = new Date();
    for (const el of root.querySelectorAll('.znow[data-zone]')) {
      const zone = el.dataset.zone;
      if (!zone) continue;
      try {
        if (!fmt.has(zone)) fmt.set(zone, new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', weekday: 'short' }));
        el.textContent = fmt.get(zone).format(now);
      } catch { el.textContent = ''; }
    }
  }
  tick();
  setInterval(tick, 15000);
}
