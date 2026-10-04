#!/usr/bin/env python3
"""Builds unichrono.app/time/: the world-time tool page, one page per major
city, and the data files the tool loads.

    tools/.venv/bin/python tools/build_time.py --db <cities.sqlite>

The source is the iOS app's city database (Unichrono/Resources/cities.sqlite
in the private unichrono-ios repo). Every run rewrites the generated output
from scratch; the hand-written tool code in time/js/ and time/time.css stays.
"""
import argparse
import datetime as dt
import html
import json
import math
import re
import shutil
import sqlite3
import unicodedata
from pathlib import Path
import zoneinfo
from zoneinfo import ZoneInfo

import tzdata

# Use only the pinned tzdata package (tools/requirements.txt), never the
# build machine's /usr/share/zoneinfo, so every machine writes the same facts.
zoneinfo.reset_tzpath(to=[])
TZ_VERSION = tzdata.IANA_VERSION

SITE = 'https://unichrono.app'
ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = Path(__file__).resolve().parent / 'templates' / 'time.html'
KEEP = {'js', 'time.css'}           # hand-written, never deleted
# Names people search for, where the dataset's own name differs.
SLUG_OVERRIDES = {'new-york-city': 'new-york'}
COMPARE = ['london', 'new-york', 'tokyo', 'sydney', 'dubai', 'singapore']
LLMS_LINE = '- [World Time Converter](https://unichrono.app/time/): free in-browser time zone converter, meeting planner and city time pages.'


# ---------- pure helpers (unit-tested) ----------

def slugify(name):
    s = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode()
    s = re.sub(r"['’]", '', s.lower())
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def assign_slugs(cities):
    """id → slug. Shared names get -<country code>; still shared, -<id>."""
    by_slug = {}
    for c in cities:
        base = slugify(c['ascii'] or c['name'])
        by_slug.setdefault(SLUG_OVERRIDES.get(base, base), []).append(c)
    out = {}
    for slug, group in by_slug.items():
        if len(group) == 1:
            out[group[0]['id']] = slug
            continue
        by_cc = {}
        for c in group:
            by_cc.setdefault(c['cc'].lower(), []).append(c)
        for cc, sub in by_cc.items():
            for c in sub:
                out[c['id']] = f'{slug}-{cc}' if len(sub) == 1 else f'{slug}-{cc}-{c["id"]}'
    return out


def km(a, b):
    if None in (a['lat'], a['lng'], b['lat'], b['lng']):
        return float('inf')
    la1, lo1, la2, lo2 = map(math.radians, (a['lat'], a['lng'], b['lat'], b['lng']))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def select_pages(cities, top=400, near_km=15):
    """The `top` most populous cities, plus the most populous city of every
    other country, in population order. A city within `near_km` of a bigger
    chosen one in the same country (Brooklyn next to New York City) is part
    of it, not a page of its own."""
    ranked = sorted(cities, key=lambda c: (-c['pop'], c['id']))
    chosen, absorbed = [], []
    for c in ranked:
        if len(chosen) == top:
            break
        # Absorbed districts absorb their own neighbours (the Bronx is far
        # from New York City's centre point but next to Manhattan).
        if any(p['cc'] == c['cc'] and km(p, c) < near_km for p in chosen + absorbed):
            absorbed.append(c)
        else:
            chosen.append(c)
    have = {c['cc'] for c in chosen}
    for c in ranked:
        if c['cc'] not in have:
            chosen.append(c)
            have.add(c['cc'])
    return chosen


def offset_label(minutes):
    if minutes == 0:
        return 'UTC'
    sign = '+' if minutes > 0 else '−'
    h, m = divmod(abs(minutes), 60)
    return f'UTC{sign}{h}' + (f':{m:02d}' if m else '')


def offset_minutes(zone, when):
    return int(when.astimezone(ZoneInfo(zone)).utcoffset().total_seconds() // 60)


def abbreviation(zone, when):
    name = when.astimezone(ZoneInfo(zone)).tzname() or ''
    return name if re.fullmatch(r'[A-Z]{2,5}', name) else offset_label(offset_minutes(zone, when))


def transitions(zone, start, days=400, limit=2):
    """[(instant, new offset minutes)] for the next `limit` offset changes."""
    out = []
    cur = offset_minutes(zone, start)
    t = start
    for _ in range(days):
        nxt = t + dt.timedelta(days=1)
        if offset_minutes(zone, nxt) != cur:
            lo, hi = t, nxt
            while (hi - lo) > dt.timedelta(minutes=1):
                mid = lo + (hi - lo) / 2
                if offset_minutes(zone, mid) == cur:
                    lo = mid
                else:
                    hi = mid
            cur = offset_minutes(zone, hi)
            out.append((hi, cur))
            if len(out) == limit:
                break
        t = nxt
    return out


def year_times(zone, now):
    """((std offset, std abbr), (dst offset, dst abbr) or None) for now's year."""
    marks = [dt.datetime(now.year, m, 15, 12, tzinfo=dt.timezone.utc) for m in (1, 7)]
    pairs = sorted({(offset_minutes(zone, t), abbreviation(zone, t)) for t in marks})
    return pairs[0], (pairs[-1] if len(pairs) > 1 else None)


def _named(off, abbr):
    return offset_label(off) if abbr == offset_label(off) else f'{abbr} ({offset_label(off)})'


def zone_label(zone, now):
    """Title text that stays true all year: "GMT/BST" or "JST (UTC+9)"."""
    std, dst = year_times(zone, now)
    if not dst:
        return _named(*std)
    if std[1] == offset_label(std[0]) or dst[1] == offset_label(dst[0]):
        return f'{offset_label(std[0])}/{offset_label(dst[0])}'
    return f'{std[1]}/{dst[1]}'


def zone_paragraph(c, now):
    std, dst = year_times(c['zone'], now)
    head = f'{c["name"]} uses {c["zone"].replace("_", " ")} time: '
    if not dst:
        return f'{head}{_named(*std)} all year. {c["name"]} does not change its clocks.'
    return f'{head}{_named(*std)} as standard time and {_named(*dst)} during daylight saving time.'


def continent(zone):
    head = zone.split('/')[0]
    return {'America': 'Americas', 'Australia': 'Oceania', 'Pacific': 'Oceania', 'Indian': 'Indian Ocean',
            'Atlantic': 'Atlantic', 'Arctic': 'Europe', 'Antarctica': 'Antarctica'}.get(head, head)


def flag(cc):
    return ''.join(chr(0x1F1E6 + ord(ch) - 65) for ch in cc.upper()) if re.fullmatch(r'[A-Za-z]{2}', cc) else ''


def related(c, pages, slugs, now):
    same_country = [p for p in pages if p['cc'] == c['cc'] and p['id'] != c['id']][:8]
    times = year_times(c['zone'], now)
    same_offset = [p for p in pages if p['cc'] != c['cc'] and year_times(p['zone'], now) == times][:8]
    return same_country, same_offset


# ---------- output ----------

def load(db):
    con = sqlite3.connect(db)
    cities = [dict(id=r[0], zone=r[1], name=r[2], ascii=r[3], country=r[4], cc=r[5], lat=r[6], lng=r[7],
                   pop=r[8], aliases=r[9])
              for r in con.execute('select id, zoneId, displayName, asciiName, country, countryCode, lat, lng, '
                                   'population, aliases from cities')]
    airports = con.execute('select iata, name, city_id from airports order by iata').fetchall()
    con.close()
    return cities, airports


def e(s):
    return html.escape(str(s), quote=True)


def link_list(items, slugs):
    return ''.join(f'<li><a href="/time/{slugs[p["id"]]}/">{e(p["name"])}</a></li>' for p in items)


def city_static(c, pages, slugs, now):
    slug = slugs[c['id']]
    same_country, same_offset = related(c, pages, slugs, now)
    std, dst = year_times(c['zone'], now)
    facts = [('Country', f'{flag(c["cc"])} {c["country"]}'), ('Time zone', c['zone']),
             ('UTC offset', offset_label(std[0]) + (f' / {offset_label(dst[0])}' if dst else '')),
             ('Abbreviation', std[1] + (f' / {dst[1]}' if dst else ''))]
    if c['lat'] is not None and c['lng'] is not None:
        facts.append(('Coordinates', f'{c["lat"]:.2f}, {c["lng"]:.2f}'))
    if c['pop']:
        facts.append(('Population', f'{c["pop"]:,}'))
    compares = [s for s in COMPARE if s != slug and s in slugs.values()]
    comp_html = ''.join(f'<li><a href="/time/?c={slug},{s}">{e(c["name"])} vs {e(next(p["name"] for p in pages if slugs[p["id"]] == s))}</a></li>'
                        for s in compares)
    head = (f'<section class="city-static"><p class="kicker">World time</p>'
            f'<h1>Time in <span class="grad">{e(c["name"])}</span>, {e(c["country"])}</h1>\n'
            f'<p class="live" id="live" aria-live="off"></p>\n'
            f'<p class="zone-para">{e(zone_paragraph(c, now))}</p>\n'
            f'<p class="zone-next" id="zone-next" data-zone="{e(c["zone"])}"></p>\n'
            '<dl class="facts">' + ''.join(f'<div><dt>{e(k)}</dt><dd>{e(v)}</dd></div>' for k, v in facts) + '</dl></section>')
    links = []
    if same_country:
        links.append(f'<h2>More cities in {e(c["country"])}</h2><ul class="links">{link_list(same_country, slugs)}</ul>')
    if same_offset:
        links.append(f'<h2>Same time as {e(c["name"])} all year</h2><ul class="links">{link_list(same_offset, slugs)}</ul>')
    if comp_html:
        links.append(f'<h2>Compare</h2><ul class="links">{comp_html}</ul>')
    return head, '<section class="city-links">' + '\n'.join(links) + '</section>'


def city_index(pages, slugs):
    groups = {}
    for p in sorted(pages, key=lambda p: p['name']):
        groups.setdefault(continent(p['zone']), []).append(p)
    out = ['<section class="city-index"><h2>City time pages</h2>']
    for name in sorted(groups):
        out.append(f'<h3>{e(name)}</h3><ul class="links">{link_list(groups[name], slugs)}</ul>')
    out.append('</section>')
    return '\n'.join(out)


def render(template, **slots):
    out = template
    for k, v in slots.items():
        out = out.replace('{{' + k + '}}', v)
    leftover = re.findall(r'\{\{\w+\}\}', out)
    assert not leftover, leftover
    return out


# Countries the holidays package names only in their own language (checked
# for holidays 0.83: every other unlocalised country is already English).
NOT_ENGLISH = {'IT'}


def holidays_for(cc, years):
    """[[iso date, English name]], or None when the package has no English
    names for the country (better no list than one in another language)."""
    import holidays
    langs = holidays.list_localized_countries().get(cc, [])
    english = next((l for l in ('en_US', 'en_GB') if l in langs), None) or next((l for l in langs if l.startswith('en')), None)
    try:
        hs = holidays.country_holidays(cc, years=years, **({'language': english} if english else {}))
    except NotImplementedError:
        return None
    if not english and cc in NOT_ENGLISH:
        return None
    out = []
    for d, name in hs.items():
        # Sweden lists every Sunday as a holiday ("Easter Sunday; Sunday"); that is not news.
        parts = [n for n in name.split('; ') if n not in ('Sunday', 'Söndag')]
        if parts:
            out.append([d.isoformat(), '; '.join(parts)])
    return sorted(out)


def update_sitemap(root, urls, today):
    path = root / 'sitemap.xml'
    xml = path.read_text()
    xml = re.sub(r'\s*<url>\s*<loc>https://unichrono\.app/time/[^<]*</loc>.*?</url>', '', xml, flags=re.S)
    entries = ''.join(f'\n  <url>\n    <loc>{u}</loc>\n    <lastmod>{today}</lastmod>\n'
                      f'    <changefreq>monthly</changefreq>\n    <priority>{"0.9" if u.endswith("/time/") else "0.5"}</priority>\n  </url>'
                      for u in urls)
    path.write_text(xml.replace('\n</urlset>', entries + '\n</urlset>'))


def update_llms(root):
    path = root / 'llms.txt'
    text = path.read_text()
    if '/time/' not in text:
        path.write_text(text.rstrip('\n') + '\n' + LLMS_LINE + '\n')


def build(db, root=ROOT, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    root = Path(root)
    cities, airports = load(db)
    pages = select_pages(cities)
    slugs = assign_slugs(pages)
    template = TEMPLATE.read_text()
    out = root / 'time'
    out.mkdir(exist_ok=True)
    for child in out.iterdir():
        if child.name in KEEP:
            continue
        shutil.rmtree(child) if child.is_dir() else child.unlink()

    data = out / 'data'
    (data / 'holidays').mkdir(parents=True)
    search = {'c': [[c['id'], c['name'], c['country'], c['cc'], c['zone'],
                     round(c['lat'], 3) if c['lat'] is not None else None,
                     round(c['lng'], 3) if c['lng'] is not None else None, c['pop'], c['aliases']]
                    for c in sorted(cities, key=lambda c: -c['pop'])],
              'a': [list(a) for a in airports]}
    (data / 'search.json').write_text(json.dumps(search, ensure_ascii=False, separators=(',', ':')))
    (data / 'pages.json').write_text(json.dumps(
        [[slugs[p['id']], p['id'], p['name'], p['country'], p['cc'], p['zone'], p['lat'], p['lng'], p['pop']]
         for p in pages], ensure_ascii=False, separators=(',', ':')))
    years = [now.year, now.year + 1]
    for cc in sorted({p['cc'] for p in pages}):
        hs = holidays_for(cc, years)
        if hs:
            (data / 'holidays' / f'{cc}.json').write_text(json.dumps(hs, ensure_ascii=False, separators=(',', ':')))

    (out / 'index.html').write_text(render(
        template,
        title='World Time Converter &amp; Meeting Planner | Unichrono',
        description=e('Convert times between cities, find a meeting time across time zones, and see sunrise, '
                      'clock changes and holidays. Free, in your browser, no sign-up.'),
        canonical=f'{SITE}/time/', jsonld=json.dumps({
            '@context': 'https://schema.org', '@type': 'WebApplication', 'name': 'Unichrono World Time',
            'url': f'{SITE}/time/', 'applicationCategory': 'UtilitiesApplication', 'operatingSystem': 'Any',
            'offers': {'@type': 'Offer', 'price': '0'}}, indent=1),
        static='<section class="city-static"><p class="kicker">Unichrono</p><h1>World Time <span class="grad">Converter</span></h1>'
               '<p class="zone-para">Compare cities, pick a time that works for everyone, and share it.</p>'
               '<p class="live" id="live" aria-live="off"></p></section>',
        links='', preload='', cityindex=city_index(pages, slugs)))

    for c in pages:
        slug = slugs[c['id']]
        zone_bit = zone_label(c['zone'], now)
        head, links = city_static(c, pages, slugs, now)
        page = out / slug
        page.mkdir()
        page.joinpath('index.html').write_text(render(
            template,
            title=e(f'Current time in {c["name"]}, {c["country"]} – {zone_bit} | Unichrono'),
            description=e(f'The exact time in {c["name"]}, {c["country"]} now: {zone_bit}. Time difference, '
                          f'sunrise and sunset, clock changes, holidays and a meeting planner.'),
            canonical=f'{SITE}/time/{slug}/',
            jsonld=json.dumps({'@context': 'https://schema.org', '@type': 'WebPage',
                               'name': f'Time in {c["name"]}, {c["country"]}', 'url': f'{SITE}/time/{slug}/',
                               'about': {'@type': 'Place', 'name': c['name'],
                                         'address': {'@type': 'PostalAddress', 'addressCountry': c['cc']},
                                         'geo': {'@type': 'GeoCoordinates', 'latitude': c['lat'], 'longitude': c['lng']}}},
                              indent=1, ensure_ascii=False),
            static=head, links=links, preload=slug, cityindex=''))

    update_sitemap(root, [f'{SITE}/time/'] + [f'{SITE}/time/{slugs[p["id"]]}/' for p in pages], now.date().isoformat())
    update_llms(root)
    return {'pages': len(pages), 'countries': len({c['cc'] for c in cities}),
            'page_countries': len({p['cc'] for p in pages})}


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True)
    args = ap.parse_args()
    print(build(args.db))
