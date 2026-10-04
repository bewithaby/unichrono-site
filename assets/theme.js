/* Light / dark switch shared by every page. The choice lives in this
   browser only (localStorage "uc-theme": "light" | "dark"); the site is
   dark until someone picks light. The head of each page applies it before
   paint; this file wires the header button. */
(function () {
  var root = document.documentElement, btn = document.getElementById('themeb');
  if (!btn) return;
  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  function light() { return root.dataset.theme === 'light'; }
  function paint() {
    var l = light(), label = l ? 'Switch to dark theme' : 'Switch to light theme';
    btn.innerHTML = l ? MOON : SUN;
    btn.setAttribute('aria-label', label);
    btn.title = label;
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', l ? '#F4F1E9' : '#0E1220');
  }
  btn.addEventListener('click', function () {
    var next = light() ? 'dark' : 'light';
    root.dataset.theme = next;
    try { localStorage.setItem('uc-theme', next); } catch (e) { /* storage blocked */ }
    paint();
    document.dispatchEvent(new CustomEvent('uc-theme', { detail: next }));
  });
  btn.addEventListener('uc-repaint', paint);
  paint();
})();
