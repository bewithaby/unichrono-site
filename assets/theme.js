/* Light / dark switch shared by every page. The choice lives in this
   browser only (localStorage "uc-theme": "light" | "dark"). Before any
   choice, a direct visit starts dark on the site and light on the
   converter, and the tab keeps whatever it is showing (sessionStorage
   "uc-theme-now") as the visitor moves between pages. The head of each page applies it before
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
    // What this tab is showing, so the next page opened in it (home → converter)
    // keeps it even before the visitor has made a choice. Direct visits start
    // from the page's own default: dark site, light converter.
    try { sessionStorage.setItem('uc-theme-now', l ? 'light' : 'dark'); } catch (e) { /* storage blocked */ }
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
  // Keep every page on the one saved choice: a page restored by Back/Forward
  // (the back-forward cache skips the head script) and pages open in other
  // tabs re-read it instead of showing the theme they were loaded with.
  function sync() {
    var t = null;
    try { t = localStorage.getItem('uc-theme'); } catch (e) { return; }
    if (t === 'paper') t = 'light';
    if (t !== 'light' && t !== 'dark') return;
    if (root.dataset.theme === t || (t === 'dark' && !light())) return;
    root.dataset.theme = t;
    paint();
    document.dispatchEvent(new CustomEvent('uc-theme', { detail: t }));
  }
  window.addEventListener('pageshow', function (e) { if (e.persisted) sync(); });
  window.addEventListener('storage', function (e) { if (e.key === 'uc-theme') sync(); });
  paint();
})();
