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
await browser.close();
console.log(failures.length ? `FAIL\n${failures.join('\n')}` : 'PASS');
process.exit(failures.length ? 1 : 0);
