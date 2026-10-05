// Render checks for /time/ in headless Chromium.
//   python3 -m http.server 8765   (site root)
//   NODE_PATH=<dir with playwright> CHROMIUM=<headless shell> OUT=<dir> node tools/check_time.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.BASE ?? 'http://localhost:8765';
const OUT = process.env.OUT ?? '/tmp/time-shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const failures = [];
const fail = (where, what) => { failures.push(`${where}: ${what}`); };

for (const path of ['/time/', '/time/tokyo/', '/time/kolkata/']) {
  for (const [w, h] of [[390, 844], [1280, 900]]) {
    for (const scheme of ['dark', 'light']) {
      const where = `${path} ${w}px ${scheme}`;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme,
                                              timezoneId: 'Australia/Sydney', locale: 'en-AU' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(BASE + path, { waitUntil: 'networkidle' });
      await page.waitForSelector('.row');
      const rows = await page.locator('.row').count();
      if (rows < 3) fail(where, `only ${rows} rows`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (overflow > 0) fail(where, `page scrolls sideways by ${overflow}px`);
      if (path !== '/time/') {
        const a = await page.textContent('#live');
        await page.waitForTimeout(1600);
        const b = await page.textContent('#live');
        if (a === b) fail(where, 'live clock did not tick');
      }
      await page.screenshot({ path: `${OUT}/${path.replace(/\//g, '_')}${w}-${scheme}.png`, fullPage: true });
      if (w === 1280 && scheme === 'dark' && path === '/time/') {
        await page.fill('#q', '8am Tokyo in London');
        await page.waitForFunction(() => document.querySelector('#preview').textContent.includes('='), null, { timeout: 8000 })
          .catch(() => fail(where, 'no conversion preview'));
        await page.screenshot({ path: `${OUT}/convert.png` });
        await page.fill('#q', 'LHR');
        await page.waitForFunction(() => document.querySelectorAll('#sugg li').length > 0, null, { timeout: 8000 })
          .catch(() => fail(where, 'no suggestions for LHR'));
        await page.click('.row:nth-child(2) [data-open]');
        await page.waitForFunction(() => !document.querySelector('#detail').hidden);
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${OUT}/detail.png`, fullPage: true });
        await page.locator('.row:nth-child(1) .c').nth(14).click();
        if (!(await page.textContent('#sel')).startsWith('Selected')) fail(where, 'clicking an hour did not select it');
      }
      if (errors.length) fail(where, errors.join(' | '));
      await ctx.close();
    }
  }
}
// A weekday through a shared link: colours, meeting line, selected column.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light',
                                          timezoneId: 'Australia/Sydney', locale: 'en-AU' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/time/?c=london,new-york,kolkata&t=2026-10-07T13:00Z', { waitUntil: 'networkidle' });
  await page.waitForSelector('.row');
  if ((await page.locator('.row').count()) !== 4) fail('shared link', 'expected home + 3 rows');
  if (!(await page.textContent('#sel')).startsWith('Selected')) fail('shared link', 'time not selected');
  await page.screenshot({ path: `${OUT}/weekday.png` });
  await ctx.close();
}
// A saved unknown zone must not take the tool down; arrows step whole columns in a :30 home zone.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Kolkata', locale: 'en-IN' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('uc.time.cities', JSON.stringify([{ ref: 'z:Not/AZone' }, { ref: 'tokyo' }])));
  await page.goto(BASE + '/time/?t=2026-10-07T04:30Z', { waitUntil: 'networkidle' });
  await page.waitForSelector('.row');
  if ((await page.locator('.row').count()) !== 2) fail('bad zone', 'expected home + Tokyo');
  await page.focus('#grid');
  await page.keyboard.press('ArrowRight');
  const s1 = await page.textContent('#sel');
  await page.keyboard.press('ArrowRight');
  const s2 = await page.textContent('#sel');
  if (!s1.includes('11:00') || !s2.includes('12:00')) fail('kolkata arrows', `${s1} / ${s2}`);
  if (errors.length) fail('bad zone', errors.join(' | '));
  await ctx.close();
}
// Visible controls: remove every default with ×, undo once, add a city, reload: only home + choices remain.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Australia/Sydney', locale: 'en-AU' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/time/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.row');
  const before = await page.locator('.row').count();
  await page.mouse.move(5, 5);  // nowhere near the grid: × must still show
  const op = await page.locator('.row:nth-child(2) [data-act="remove"]').evaluate(el => {
    let o = 1;
    for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  });
  if (op < 1) fail('controls', `× is hidden until hover (opacity ${op})`);
  await page.locator('.row:nth-child(2) [data-act="remove"]').click();
  if ((await page.locator('.row').count()) !== before - 1) fail('controls', '× did not remove');
  await page.click('#toast [data-act="undo"]');
  if ((await page.locator('.row').count()) !== before) fail('controls', 'undo did not restore');
  while ((await page.locator('[data-act="remove"]').count()) > 0) await page.locator('[data-act="remove"]').first().click();
  if ((await page.locator('.row').count()) !== 1) fail('controls', 'could not remove every default');
  if (await page.locator('#reset').isHidden()) fail('controls', 'reset link missing after edits');
  await page.click('#addcity');
  if (!(await page.evaluate(() => document.activeElement?.id === 'q'))) fail('controls', '+ Add city did not focus search');
  await page.fill('#q', 'Lisbon');
  await page.waitForSelector('#sugg li');
  await page.locator('#sugg li').first().click();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.row');
  const names = await page.locator('.row [data-open]').allTextContents();
  if (names.length !== 2 || names[1] !== 'Lisbon') fail('controls', `after reload: ${names.join(', ')}`);
  await page.locator('.row:nth-child(2) [data-act="up"]').count().then(n => n || fail('controls', 'no move arrows'));
  await page.click('#reset');
  if ((await page.locator('.row').count()) < 3) fail('controls', 'reset did not bring defaults back');
  if (errors.length) fail('controls', errors.join(' | '));
  await ctx.close();
}
// A city page shows its city with Keep and does not save it on its own.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Australia/Sydney', locale: 'en-AU' });
  const page = await ctx.newPage();
  await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('uc.time.cities', JSON.stringify([{ ref: 'london' }])); } });
  await page.goto(BASE + '/time/kolkata/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.row');
  if (!(await page.locator('[data-act="keep"]').count())) fail('city page', 'no Keep button');
  await page.locator('[data-act="remove"]').last().click();   // edit something else
  await page.goto(BASE + '/time/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.row');
  const names = await page.locator('.row [data-open]').allTextContents();
  if (names.includes('Kolkata')) fail('city page', `Kolkata saved without Keep: ${names.join(', ')}`);
  await ctx.close();
}
// A labelled Light/Dark switch that flips the page and is remembered.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/time/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.row');
  // A direct visit starts light (even with a dark OS); the switch offers Dark.
  const label = (await page.textContent('#theme')).trim();
  if (label !== 'Dark') fail('theme', `light page button reads "${label}", want "Dark"`);
  const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  if (light !== 'rgb(244, 241, 233)') fail('theme', `light background is ${light}, want the site's paper #F4F1E9`);
  await page.click('#theme');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  if (bg !== 'rgb(14, 18, 32)') fail('theme', `dark background is ${bg}, want #0E1220`);
  if ((await page.textContent('#theme')).trim() !== 'Light') fail('theme', 'button did not switch to "Light"');
  await page.reload({ waitUntil: 'networkidle' });
  if (await page.evaluate(() => document.documentElement.dataset.theme) !== 'dark') fail('theme', 'dark not remembered');
  await ctx.close();
}
// The home page: a header "Convert time" button visible at every width, a
// hero text link, the footer link, no fourth store tile, no classic-site link.
for (const [w, h] of [[1440, 900], [1280, 800], [1100, 800], [390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const where = `home ${w}px`;
  const btn = page.locator('header a.hconv');
  if (!(await btn.count()) || !(await btn.isVisible())) fail(where, 'no visible Convert time button in the header');
  else {
    if ((await btn.textContent()).trim() !== 'Convert time') fail(where, `header button reads "${(await btn.textContent()).trim()}"`);
    const bb = await btn.boundingBox();
    if (bb.x + bb.width > w || bb.height > 40) fail(where, `header button off-screen or wrapped (${Math.round(bb.x + bb.width)}px, ${Math.round(bb.height)}px tall)`);
  }
  for (const b of await page.locator('header .btn').all()) {
    if (await b.isVisible() && (await b.boundingBox()).height > 40) fail(where, `"${(await b.textContent()).trim()}" wraps`);
  }
  const hl = page.locator('.hero a.hlink[href="time/"]');
  if (!(await hl.isVisible())) fail(where, 'no hero converter link');
  else if (!(await hl.evaluate(el => el.classList.contains('btn') && el.classList.contains('ghost')))) fail(where, 'hero link is not an outlined button');
  else {
    const m = await page.evaluate(() => {
      const l = document.querySelector('.hero a.hlink'), row = document.querySelector('.hero .hero-cta');
      const stores = [...row.querySelectorAll('.store')].map(e => e.getBoundingClientRect());
      // One row of badges: match their span. Wrapped badges: match the badge area.
      const oneRow = new Set(stores.map(r => Math.round(r.top))).size === 1;
      const box = row.getBoundingClientRect();
      const left = oneRow ? Math.min(...stores.map(r => r.left)) : box.left;
      const right = oneRow ? Math.max(...stores.map(r => r.right)) : box.right;
      const r = l.getBoundingClientRect();
      return { l: r.left, r: r.right, h: r.height, left, right, text: l.textContent.trim(),
               bg: getComputedStyle(l).backgroundImage, vw: innerWidth };
    });
    if (!/world time converter/i.test(m.text)) fail(where, `hero button text "${m.text}"`);
    if (Math.abs(m.l - m.left) > 2 || Math.abs(m.r - m.right) > 2) fail(where, `hero button ${Math.round(m.l)}–${Math.round(m.r)} not under the badges ${Math.round(m.left)}–${Math.round(m.right)}`);
    if (m.right - m.left >= 520 && m.h > 44) fail(where, 'hero button wraps although the badge row is wide');
    if (m.h > 70) fail(where, 'hero button more than two lines');
    if (m.bg !== 'none') fail(where, 'hero button still has a gradient border');
  }
  const order = await page.evaluate(() => {
    const b = document.querySelector('#travel a.ttlink'), w = document.querySelector('#travel .watch');
    return b && w ? !!(b.compareDocumentPosition(w) & Node.DOCUMENT_POSITION_FOLLOWING) : null;
  });
  if (order !== true) fail(where, 'time-travel button is not above the "An hour or a century" line');
  const tt = page.locator('#travel a.ttlink[href="time/"]');
  if ((await tt.count()) !== 1 || (await tt.textContent()).trim() !== 'Try time travel in your browser →') fail(where, 'no time-travel button in section 03');
  else {
    await tt.scrollIntoViewIfNeeded();
    const tb = await tt.boundingBox();
    if (tb.height > 44) fail(where, 'time-travel button wraps');
  }
  if (await page.locator('.store.web').count()) fail(where, 'fourth store tile still there');
  if (await page.locator('footer a[href="classic.html"]').count()) fail(where, 'classic site link still in footer');
  if ((await page.locator('footer a[href="time/"]').textContent()).trim() !== 'Convert time') fail(where, 'footer link not "Convert time"');
  if (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) > 0) fail(where, 'page scrolls sideways');
  if (await btn.count()) { await btn.click(); await page.waitForSelector('.row'); }
  await ctx.close();
}
// Site-wide light theme: a header switch on every page, one remembered choice.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const pages = ['/', '/about.html', '/help.html', '/privacy-policy.html', '/time/'];
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  if (await bg() !== 'rgb(14, 18, 32)') fail('site theme', `home starts ${await bg()}, want dark`);
  const sw = page.locator('header #themeb');
  if (!(await sw.count()) || !(await sw.isVisible())) fail('site theme', 'no theme switch in the home header');
  else {
    await sw.click();
    if (await bg() !== 'rgb(244, 241, 233)') fail('site theme', `home after switch ${await bg()}`);
    for (const p of pages) {
      await page.goto(BASE + p, { waitUntil: 'networkidle' });
      if (await bg() !== 'rgb(244, 241, 233)') fail('site theme', `${p} not light after choosing light (${await bg()})`);
      if (!(await page.locator('header #themeb').isVisible())) fail('site theme', `${p} has no header switch`);
    }
    await page.locator('header #themeb').click();          // back to dark from the converter
    await page.goto(BASE + '/about.html', { waitUntil: 'networkidle' });
    if (await bg() !== 'rgb(14, 18, 32)') fail('site theme', `about not dark after switching back (${await bg()})`);
  }
  if (errors.length) fail('site theme', errors.join(' | '));
  await ctx.close();
}
for (const [w, h] of [[1440, 900], [1366, 800], [1280, 800], [1261, 800], [1201, 800], [1100, 800], [900, 800], [390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  for (const p of ['/', '/about.html', '/time/']) {
    await page.goto(BASE + p, { waitUntil: 'networkidle' });
    const sw = page.locator('header #themeb');
    if (!(await sw.isVisible())) { fail(`header ${p} ${w}px`, 'theme switch hidden'); continue; }
    const b = await sw.boundingBox();
    if (b.x + b.width > w) fail(`header ${p} ${w}px`, 'theme switch off-screen');
    for (const btn of await page.locator('header .btn, header #themeb, header .menub').all()) {
      if (!(await btn.isVisible())) continue;
      const bb = await btn.boundingBox();
      if (bb.height > 40) fail(`header ${p} ${w}px`, `"${(await btn.textContent()).trim()}" wraps`);
      if (bb.x + bb.width > w - 8) fail(`header ${p} ${w}px`, `"${(await btn.textContent()).trim() || 'icon'}" runs off the right edge`);
    }
    if (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) > 0) fail(`header ${p} ${w}px`, 'page scrolls sideways');
  }
  await ctx.close();
}
// Theme defaults and sync. No saved choice: landing on the home page is dark,
// landing straight on the converter is light, and moving between pages keeps
// what the visitor is already looking at. A choice then wins everywhere,
// including pages restored by Back and pages open in other tabs.
{
  const DARK = 'rgb(14, 18, 32)', LIGHT = 'rgb(244, 241, 233)';
  const bg = p => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  for (const scheme of ['light', 'dark']) {
    const fresh = async path => {
      const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
      const pg = await c.newPage();
      await pg.goto(BASE + path, { waitUntil: 'networkidle' });
      const got = await bg(pg); await c.close(); return got;
    };
    if (await fresh('/') !== DARK) fail('theme default', `${scheme} OS: home not dark on a direct visit`);
    if (await fresh('/time/') !== LIGHT) fail('theme default', `${scheme} OS: converter not light on a direct visit`);
    if (await fresh('/time/tokyo/') !== LIGHT) fail('theme default', `${scheme} OS: city page not light on a direct visit`);
    if (await fresh('/about.html') !== DARK) fail('theme default', `${scheme} OS: about not dark on a direct visit`);
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click('.hero .hlink');                            // home → converter, no choice made
  await page.waitForLoadState('networkidle');
  if (await bg(page) !== DARK) fail('theme sync', `home → converter changed theme to ${await bg(page)}`);
  await page.click('#theme');                                  // choose light on the converter
  await page.goBack({ waitUntil: 'networkidle' });
  if (await bg(page) !== LIGHT) fail('theme sync', `Back to home after choosing light shows ${await bg(page)}`);
  if (await page.evaluate(() => document.getElementById('themeb').getAttribute('aria-label')) !== 'Switch to dark theme')
    fail('theme sync', 'home switch icon not updated after Back');
  await page.goto(BASE + '/about.html', { waitUntil: 'networkidle' });
  if (await bg(page) !== LIGHT) fail('theme sync', 'about not light after choosing light');
  const other = await ctx.newPage();
  await other.goto(BASE + '/time/', { waitUntil: 'networkidle' });
  await page.click('header #themeb');                          // about → dark
  await other.waitForTimeout(300);
  if (await bg(other) !== DARK) fail('theme sync', `open converter tab did not follow (${await bg(other)})`);
  if ((await other.textContent('#theme')).trim() !== 'Light') fail('theme sync', 'converter button label not updated in other tab');
  await ctx.close();
  // A saved dark choice beats the converter's light default on a direct visit.
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await c2.addInitScript(() => { if (!sessionStorage.getItem('x')) { localStorage.setItem('uc-theme', 'dark'); sessionStorage.setItem('x', '1'); } });
  const p2 = await c2.newPage();
  await p2.goto(BASE + '/time/', { waitUntil: 'networkidle' });
  if (await bg(p2) !== DARK) fail('theme sync', 'saved dark ignored on a direct converter visit');
  await c2.close();
}
await browser.close();
console.log(failures.length ? `FAIL\n${failures.join('\n')}` : 'PASS');
process.exit(failures.length ? 1 : 0);
