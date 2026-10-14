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
SLUG_OVERRIDES = {'new-york-city': 'new-york', 'ulan-bator': 'ulaanbaatar', 'frankfurt-am-main': 'frankfurt'}
COMPARE = ['london', 'new-york', 'tokyo', 'sydney', 'dubai', 'singapore']
# Old page addresses that now live elsewhere. Each keeps a redirect page so
# shared links and anything Google already found still land.
REDIRECTS = Path(__file__).resolve().parent / 'slug_redirects.json'

# The cities people actually look up the time in, as (dataset name, country
# code). Only these pages are indexed and listed in the sitemap; every other
# city page stays usable from the converter but carries noindex. A short list
# of good pages beats hundreds of thin ones (Google's view of programmatic
# pages), so add a city here only when people search for it by name.
FEATURED = [tuple(x.rsplit(' ', 1)) for x in '''
New York City US|Los Angeles US|Chicago US|Houston US|Phoenix US|Dallas US|San Francisco US|Seattle US|
Denver US|Miami US|Atlanta US|Boston US|Washington US|Philadelphia US|Las Vegas US|Honolulu US|Anchorage US|
Toronto CA|Vancouver CA|Montréal CA|Calgary CA|Halifax CA|St. John's CA|Mexico City MX|Cancún MX|
São Paulo BR|Rio de Janeiro BR|Buenos Aires AR|Santiago CL|Lima PE|Bogotá CO|Caracas VE|Havana CU|
Panama City PA|San Juan PR|Kingston JM|Quito EC|Montevideo UY|Santo Domingo DO|San José CR|
London GB|Manchester GB|Edinburgh GB|Dublin IE|Lisbon PT|Paris FR|Berlin DE|Munich DE|Frankfurt am Main DE|
Madrid ES|Barcelona ES|Rome IT|Milan IT|Amsterdam NL|Brussels BE|Zürich CH|Geneva CH|Vienna AT|Prague CZ|
Warsaw PL|Budapest HU|Stockholm SE|Oslo NO|Copenhagen DK|Helsinki FI|Athens GR|Istanbul TR|Moscow RU|Kyiv UA|
Bucharest RO|Sofia BG|Belgrade RS|Reykjavík IS|Riga LV|Tallinn EE|Vilnius LT|Zagreb HR|
Cairo EG|Lagos NG|Abuja NG|Nairobi KE|Johannesburg ZA|Cape Town ZA|Casablanca MA|Accra GH|Addis Ababa ET|
Kinshasa CD|Dar es Salaam TZ|Algiers DZ|Tunis TN|Dakar SN|Kampala UG|Luanda AO|Kigali RW|Harare ZW|
Dubai AE|Abu Dhabi AE|Doha QA|Riyadh SA|Jeddah SA|Kuwait City KW|Muscat OM|Manama BH|Tehran IR|Tel Aviv IL|
Jerusalem IL|Amman JO|Beirut LB|Baghdad IQ|Karachi PK|Lahore PK|Islamabad PK|Delhi IN|Mumbai IN|Bengaluru IN|
Chennai IN|Kolkata IN|Hyderabad IN|Pune IN|Kathmandu NP|Dhaka BD|Colombo LK|Kabul AF|Tashkent UZ|Almaty KZ|
Bangkok TH|Singapore SG|Kuala Lumpur MY|Jakarta ID|Denpasar ID|Manila PH|Ho Chi Minh City VN|Hanoi VN|
Yangon MM|Phnom Penh KH|Hong Kong HK|Shanghai CN|Beijing CN|Shenzhen CN|Guangzhou CN|Taipei TW|Seoul KR|
Busan KR|Tokyo JP|Osaka JP|Ulan Bator MN|Male MV|
Sydney AU|Melbourne AU|Brisbane AU|Perth AU|Adelaide AU|Darwin AU|Hobart AU|Auckland NZ|Wellington NZ|Suva FJ
'''.replace('\n', '').split('|')]

# Time-difference pages for the pairs people search most. Slugs of featured
# cities; the page lives at /time/<a>-<b>/.
PAIRS = [('london', 'new-york'), ('new-york', 'los-angeles'), ('london', 'los-angeles'), ('london', 'dubai'),
         ('london', 'sydney'), ('london', 'tokyo'), ('london', 'singapore'), ('london', 'hong-kong'),
         ('london', 'mumbai'), ('london', 'paris'), ('london', 'toronto'), ('london', 'chicago'),
         ('london', 'auckland'), ('new-york', 'tokyo'), ('new-york', 'sydney'), ('new-york', 'mumbai'),
         ('new-york', 'dubai'), ('new-york', 'singapore'), ('new-york', 'manila'), ('new-york', 'berlin'),
         ('los-angeles', 'tokyo'), ('los-angeles', 'sydney'), ('los-angeles', 'mumbai'), ('dubai', 'mumbai'),
         ('sydney', 'singapore')]
# Cities every page measures its working day against.
OVERLAP_WITH = ['london', 'new-york', 'sydney', 'tokyo']
LLMS_LINE = '- [World Time Converter](https://unichrono.app/time/): free in-browser time zone converter, meeting planner and city time pages.'


# Time-zone abbreviations people type into search ("est to ist"): key →
# (abbreviation, name, zone, what the abbreviation means in practice). One
# zone per key; the notes say what the other meanings are.
ZONES = {
    'est': ('EST', 'Eastern Time', 'America/New_York', 'US Eastern Time (New York). In summer it is EDT; '
            'people often say EST all year, and this page follows the clock, not the label.'),
    'cst': ('CST', 'Central Time', 'America/Chicago', 'US Central Time (Chicago), CDT in summer. '
            'China Standard Time is also written CST; that is a different zone, UTC+8.'),
    'mst': ('MST', 'Mountain Time', 'America/Denver', 'US Mountain Time (Denver), MDT in summer. '
            'Arizona stays on MST all year.'),
    'pst': ('PST', 'Pacific Time', 'America/Los_Angeles', 'US Pacific Time (Los Angeles). In summer it is PDT; '
            'people often say PST all year, and this page follows the clock, not the label.'),
    'gmt': ('GMT', 'UK time', 'Europe/London', 'UK time (London). Strictly GMT is UTC+0 all year; '
            'the UK moves to BST, UTC+1, in summer, and this page follows the UK clock.'),
    'cet': ('CET', 'Central European Time', 'Europe/Paris', 'Central European Time (Paris, Berlin, Rome), '
            'CEST in summer.'),
    'utc': ('UTC', 'Coordinated Universal Time', 'UTC', 'Coordinated Universal Time, the reference every '
            'other offset counts from. It never changes.'),
    'ist': ('IST', 'India Standard Time', 'Asia/Kolkata', 'India Standard Time, UTC+5:30 all year. '
            'Ireland and Israel also use the letters IST for their own zones.'),
    'jst': ('JST', 'Japan Standard Time', 'Asia/Tokyo', 'Japan Standard Time, UTC+9 all year.'),
    'aest': ('AEST', 'Australian Eastern Time', 'Australia/Sydney', 'Australian Eastern Time (Sydney, Melbourne), '
             'AEDT in the southern summer. Brisbane stays on AEST all year.'),
    'sgt': ('SGT', 'Singapore Time', 'Asia/Singapore', 'Singapore Time, UTC+8 all year.'),
    'pht': ('PHT', 'Philippine Time', 'Asia/Manila', 'Philippine Time (Manila), UTC+8 all year.'),
    'gst': ('GST', 'Gulf Standard Time', 'Asia/Dubai', 'Gulf Standard Time (Dubai, Abu Dhabi), UTC+4 all year.'),
}
ZONE_PAIRS = [('est', 'ist'), ('pst', 'ist'), ('cst', 'ist'), ('mst', 'ist'), ('gmt', 'ist'), ('cet', 'ist'),
              ('utc', 'ist'), ('aest', 'ist'), ('sgt', 'ist'), ('jst', 'ist'), ('gst', 'ist'),
              ('est', 'pst'), ('est', 'cst'), ('cst', 'pst'), ('est', 'mst'), ('mst', 'pst'),
              ('est', 'gmt'), ('pst', 'gmt'), ('cst', 'gmt'), ('gmt', 'cet'), ('cet', 'est'), ('cet', 'pst'),
              ('utc', 'est'), ('utc', 'pst'), ('utc', 'cst'), ('utc', 'cet'), ('utc', 'jst'),
              ('aest', 'est'), ('aest', 'pst'), ('aest', 'gmt'), ('jst', 'est'), ('jst', 'pst'),
              ('sgt', 'est'), ('pht', 'est'), ('pht', 'pst'),
              ('ist', 'est'), ('ist', 'pst'), ('ist', 'cst'), ('ist', 'gmt')]

# "Time in India" pages, for countries that keep one clock: slug → (country
# code, how a sentence names it, optional note). Bing's 24-month counts put
# "time in india" at 809K and "time in japan" at 138K, far above any city.
COUNTRIES = {
    'india': ('IN', 'India', ''), 'japan': ('JP', 'Japan', ''), 'uk': ('GB', 'the UK', ''),
    'china': ('CN', 'China', 'That is Beijing time, used across the whole country, '
              'although in Xinjiang many people also keep a local time two hours behind it.'),
    'philippines': ('PH', 'the Philippines', ''), 'uae': ('AE', 'the UAE', ''), 'pakistan': ('PK', 'Pakistan', ''),
    'germany': ('DE', 'Germany', ''), 'france': ('FR', 'France', 'Mainland France; its overseas regions keep their own time.'),
    'italy': ('IT', 'Italy', ''), 'south-korea': ('KR', 'South Korea', ''), 'saudi-arabia': ('SA', 'Saudi Arabia', ''),
    'nigeria': ('NG', 'Nigeria', ''), 'egypt': ('EG', 'Egypt', ''), 'turkey': ('TR', 'Turkey', ''),
    'vietnam': ('VN', 'Vietnam', ''), 'thailand': ('TH', 'Thailand', ''),
    'netherlands': ('NL', 'the Netherlands', 'European Netherlands; the Caribbean islands keep their own time.'),
    'ireland': ('IE', 'Ireland', ''), 'israel': ('IL', 'Israel', ''), 'south-africa': ('ZA', 'South Africa', ''),
    'bangladesh': ('BD', 'Bangladesh', ''),
}


# ---------- pure helpers (unit-tested) ----------

# Letters NFKD cannot split into a base letter plus an accent.
_LATIN = str.maketrans({'ı': 'i', 'ħ': 'h', 'Ħ': 'H', 'ł': 'l', 'Ł': 'L', 'ø': 'o', 'Ø': 'O', 'đ': 'd', 'Đ': 'D',
                        'æ': 'ae', 'Æ': 'Ae', 'œ': 'oe', 'ß': 'ss', 'þ': 'th', 'ð': 'd'})


def slugify(name):
    s = unicodedata.normalize('NFKD', name.translate(_LATIN)).encode('ascii', 'ignore').decode()
    s = re.sub(r"['’]", '', s.lower())
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def assign_slugs(cities, featured=()):
    """id → slug. Shared names get -<country code>; still shared, -<id>.
    A featured city keeps the bare name (hyderabad is the Indian one)."""
    by_slug = {}
    for c in cities:
        # The display name, not GeoNames' ASCII form: Zürich is zurich, not zuerich.
        base = slugify(c['name']) or slugify(c['ascii'] or '')
        by_slug.setdefault(SLUG_OVERRIDES.get(base, base), []).append(c)
    out = {}
    for slug, group in by_slug.items():
        if len(group) == 1:
            out[group[0]['id']] = slug
            continue
        top = [c for c in group if c['id'] in featured]
        if len(top) == 1:
            out[top[0]['id']] = slug
            group = [c for c in group if c is not top[0]]
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


def select_pages(cities, top=400, near_km=15, featured=frozenset()):
    """The `top` most populous cities, plus the most populous city of every
    other country, in population order, plus any `featured` city not already
    in. A city within `near_km` of a bigger chosen one in the same country
    (Brooklyn next to New York City) is part of it, not a page of its own."""
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
    ids = {c['id'] for c in chosen}
    chosen += [c for c in ranked if c['id'] in featured and c['id'] not in ids]
    return chosen


def featured_ids(cities, names=None):
    """Ids of the FEATURED cities; the most populous one when a name repeats
    inside a country. Fails loudly on a name the dataset does not have."""
    names = FEATURED if names is None else names
    best = {}
    for c in cities:
        key = (c['name'], c['cc'])
        if key in names and (key not in best or c['pop'] > best[key]['pop']):
            best[key] = c
    missing = [n for n in names if n not in best]
    assert not missing, f'FEATURED cities not in the dataset: {missing}'
    return {c['id'] for c in best.values()}


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


def clock(t):
    """'6:05 am' — the converter's default 12-hour style."""
    # A no-break space: "5:53 pm" never splits across lines in a narrow table.
    return f'{t.hour % 12 or 12}:{t.minute:02d}\u00a0{"am" if t.hour < 12 else "pm"}'


def day(d):
    return f'{d:%a} {d.day} {d:%b %Y}'


def hours(minutes):
    h, m = divmod(abs(minutes), 60)
    parts = ([f'{h} hour' + ('s' if h != 1 else '')] if h else []) + ([f'{m} min'] if m else [])
    return ' '.join(parts) or '0 hours'


# Sunrise and sunset: the SunCalc maths of time/js/sun.js, line for line, so
# the static table and the live tool agree. Its two traps apply here too: the
# set transit uses (h + lw), and the day is the city's own, anchored at its
# local noon.
_RAD, _J1970, _J2000 = math.pi / 180, 2440588, 2451545


def _to_days(t):
    return t.timestamp() / 86400 - 0.5 + _J1970 - _J2000


def _from_julian(j):
    return dt.datetime.fromtimestamp((j + 0.5 - _J1970) * 86400, dt.timezone.utc)


def sun_times(lat, lng, zone, date):
    """(rise, set) as local datetimes for the city's `date`, or 'day'/'night'
    when the sun stays up or down all day."""
    noon = dt.datetime(date.year, date.month, date.day, 12, tzinfo=ZoneInfo(zone))
    lw, phi, d = _RAD * -lng, _RAD * lat, _to_days(noon)
    n = round(d - 0.0009 - lw / (2 * math.pi))
    M = _RAD * (357.5291 + 0.98560028 * d)
    L = M + _RAD * (1.9148 * math.sin(M) + 0.02 * math.sin(2 * M) + 0.0003 * math.sin(3 * M)) + _RAD * 102.9372 + math.pi
    dec = math.asin(math.sin(_RAD * 23.4397) * math.sin(L))
    j_noon = _J2000 + (0.0009 + lw / (2 * math.pi) + n) + 0.0053 * math.sin(M) - 0.0069 * math.sin(2 * L)
    cos_h = (math.sin(-0.833 * _RAD) - math.sin(phi) * math.sin(dec)) / (math.cos(phi) * math.cos(dec))
    if cos_h > 1:
        return 'night'
    if cos_h < -1:
        return 'day'
    h = math.acos(cos_h)
    j_set = _J2000 + (0.0009 + (h + lw) / (2 * math.pi) + n) + 0.0053 * math.sin(M) - 0.0069 * math.sin(2 * L)
    tz = ZoneInfo(zone)
    return _from_julian(2 * j_noon - j_set).astimezone(tz), _from_julian(j_set).astimezone(tz)


SEASONS = [('March equinox', 3, 20), ('June solstice', 6, 21), ('September equinox', 9, 22),
           ('December solstice', 12, 21)]


def sun_rows(c, now):
    """[(label, sunrise, sunset, day length)] for the solstices and equinoxes."""
    rows = []
    for label, m, d in SEASONS:
        when = dt.date(now.year, m, d)
        s = sun_times(c['lat'], c['lng'], c['zone'], when)
        if isinstance(s, str):
            rows.append((f'{label}, {d} {when:%b}', '—', '—', 'Sun up all day' if s == 'day' else 'Sun down all day'))
        else:
            mins = round((s[1] - s[0]).total_seconds() / 60)
            rows.append((f'{label}, {d} {when:%b}', clock(s[0]), clock(s[1]), f'{mins // 60}\u00a0h {mins % 60:02d}\u00a0min'))
    return rows


def clock_changes(zone, now):
    """[(local date, sentence)] for every change in now's year and the next."""
    start = dt.datetime(now.year, 1, 1, tzinfo=dt.timezone.utc)
    out = []
    for when, new in transitions(zone, start, days=731, limit=8):
        if when.year > now.year + 1:
            break
        old = offset_minutes(zone, when - dt.timedelta(minutes=1))
        # The wall clock just before the change, as people read it ("at 1:00 am").
        before = (when - dt.timedelta(minutes=1)).astimezone(ZoneInfo(zone)) + dt.timedelta(minutes=1)
        way = 'forward' if new > old else 'back'
        out.append((before.date(), f'{day(before)}: clocks go {way} {hours(new - old)} at {clock(before)}, '
                                    f'to {_named(new, abbreviation(zone, when))}'))
    return out


def _work_day(zone, date, start=9, end=17):
    tz = ZoneInfo(zone)
    return (dt.datetime(date.year, date.month, date.day, start, tzinfo=tz),
            dt.datetime(date.year, date.month, date.day, end, tzinfo=tz))


def overlap(zone, other, date):
    """(start, end) in `zone`'s local time where 9–5 there meets 9–5 in
    `other`, or None. `other`'s neighbouring days count: Tokyo's Wednesday
    morning is Los Angeles' Tuesday afternoon. Pick a mid-week date."""
    a0, a1 = _work_day(zone, date)
    best = None
    for shift in (-1, 0, 1):
        b0, b1 = _work_day(other, date + dt.timedelta(days=shift))
        lo, hi = max(a0, b0), min(a1, b1)
        if lo < hi and (best is None or hi - lo > best[1] - best[0]):
            best = (lo, hi)
    if not best:
        return None
    tz = ZoneInfo(zone)
    return best[0].astimezone(tz), best[1].astimezone(tz)


def _midweek(year, month):
    d = dt.date(year, month, 15)
    return d + dt.timedelta(days=(2 - d.weekday()) % 7)   # the next Wednesday


def overlap_text(zone, other, date):
    o = overlap(zone, other, date)
    if not o:
        return 'No overlap'
    return f'{clock(o[0])} – {clock(o[1])} ({hours(round((o[1] - o[0]).total_seconds() / 60))})'


def gap_sentence(a, b, minutes):
    """How b's clock stands against a's: 'New York is 5 hours behind London'."""
    if minutes == 0:
        return f'{b} and {a} show the same time'
    return f'{b} is {hours(minutes)} {"ahead of" if minutes > 0 else "behind"} {a}'


def pair_segments(za, zb, now):
    """[(first local day, last local day or None, b minus a in minutes)] over
    now's year and the next: the gap only moves when one side changes clocks."""
    start = dt.datetime(now.year, 1, 1, tzinfo=dt.timezone.utc)
    end = dt.datetime(now.year + 2, 1, 1, tzinfo=dt.timezone.utc)
    changes = sorted(
        [(t, z) for z in {za, zb} for t, _ in transitions(z, start, days=731, limit=8) if t < end])
    gap = lambda t: offset_minutes(zb, t) - offset_minutes(za, t)  # noqa: E731
    segs, first = [], start.date()
    cur = gap(start)
    for t, z in changes:
        g = gap(t)
        if g == cur:
            continue
        local = t.astimezone(ZoneInfo(z)).date()
        segs.append((first, local - dt.timedelta(days=1), cur))
        first, cur = local, g
    segs.append((first, None, cur))
    return segs


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


def pair_slug(a, b):
    return f'{a}-{b}'


def compare_href(slug, other):
    """The pair page when one exists (either order), else the converter."""
    for x, y in ((slug, other), (other, slug)):
        if (x, y) in PAIRS:
            return f'/time/{pair_slug(x, y)}/'
    return f'/time/?c={slug},{other}'


def table(head, rows):
    return ('<div class="tablewrap"><table class="ttable"><thead><tr>' + ''.join(f'<th>{e(h)}</th>' for h in head)
            + '</tr></thead><tbody>' + ''.join('<tr>' + ''.join(f'<td>{e(v)}</td>' for v in r) + '</tr>' for r in rows)
            + '</tbody></table></div>')


def overlap_section(c, by_slug, slug, now):
    others = [s for s in OVERLAP_WITH if s != slug and s in by_slug][:3]
    months = [(_midweek(now.year, 1), 'January'), (_midweek(now.year, 7), 'July')]
    rows = [(SHORT.get(by_slug[o]["name"], by_slug[o]["name"]), *(overlap_text(c['zone'], by_slug[o]['zone'], d) for d, _ in months)) for o in others]
    return (f'<h2>Working hours overlap</h2><p class="tnote">When a 9 am – 5 pm working day in {e(c["name"])} '
            f'meets one in each city, shown in {e(c["name"])} time.</p>'
            + table(['With', *(m for _, m in months)], rows))


def city_static(c, pages, slugs, now, indexed=None):
    """(head html, body html) for a city page. Links go only to indexed pages."""
    indexed = indexed if indexed is not None else {p['id'] for p in pages}
    slug = slugs[c['id']]
    linkable = [p for p in pages if p['id'] in indexed]
    by_slug = {slugs[p['id']]: p for p in linkable}
    same_country, same_offset = related(c, linkable, slugs, now)
    std, dst = year_times(c['zone'], now)
    facts = [('Country', f'{flag(c["cc"])} {c["country"]}'), ('Time zone', c['zone']),
             ('UTC offset', offset_label(std[0]) + (f' / {offset_label(dst[0])}' if dst else '')),
             ('Abbreviation', std[1] + (f' / {dst[1]}' if dst else ''))]
    if c['lat'] is not None and c['lng'] is not None:
        facts.append(('Coordinates', f'{c["lat"]:.2f}, {c["lng"]:.2f}'))
    if c['pop']:
        facts.append(('Population', f'{c["pop"]:,}'))
    compares = [s for s in COMPARE if s != slug and s in by_slug]
    short = lambda n: SHORT.get(n, n)  # noqa: E731
    comp_html = ''.join(f'<li><a href="{compare_href(slug, s)}">{e(short(c["name"]))} vs {e(short(by_slug[s]["name"]))}</a></li>'
                        for s in compares)
    head = (f'<section class="city-static"><p class="kicker">World time</p>'
            f'<h1>Time in <span class="grad">{e(c["name"])}</span>, {e(c["country"])}</h1>\n'
            f'<p class="live" id="live" aria-live="off"></p>\n'
            f'<p class="zone-para">{e(zone_paragraph(c, now))}</p>\n'
            f'<p class="zone-next" id="zone-next" data-zone="{e(c["zone"])}"></p>\n'
            '<dl class="facts">' + ''.join(f'<div><dt>{e(k)}</dt><dd>{e(v)}</dd></div>' for k, v in facts) + '</dl></section>')

    body = []
    changes = clock_changes(c['zone'], now)
    if changes:
        body.append(f'<h2>Clock changes in {now.year} and {now.year + 1}</h2><ul class="changes">'
                    + ''.join(f'<li>{e(t)}</li>' for _, t in changes) + '</ul>')
    body.append(overlap_section(c, by_slug, slug, now))
    if c['lat'] is not None and c['lng'] is not None:
        body.append(f'<h2>Sunrise and sunset in {e(c["name"])}</h2>'
                    f'<p class="tnote">Local time, {now.year}. The converter above shows today\'s.</p>'
                    + table(['Day', 'Sunrise', 'Sunset', 'Daylight'], sun_rows(c, now)))
    links = []
    if same_country:
        links.append(f'<h2>More cities in {e(c["country"])}</h2><ul class="links">{link_list(same_country, slugs)}</ul>')
    if same_offset:
        links.append(f'<h2>Same time as {e(c["name"])} all year</h2><ul class="links">{link_list(same_offset, slugs)}</ul>')
    if comp_html:
        links.append(f'<h2>Compare</h2><ul class="links">{comp_html}</ul>')
    return head, ('<section class="city-facts">' + '\n'.join(body) + '</section>\n'
                  '<section class="city-links">' + '\n'.join(links) + '</section>')


def city_description(c, zone_bit, now, slug):
    """Promises only what the page's own HTML holds."""
    parts = []
    if clock_changes(c['zone'], now):
        parts.append(f'every clock change in {now.year} and {now.year + 1}')
    if c['lat'] is not None:
        parts.append('sunrise and sunset through the year')
    others = [SHORT_SLUG[o] for o in OVERLAP_WITH if o != slug][:3]
    parts.append(f'the working hours it shares with {others[0]}, {others[1]} and {others[2]}')
    body = ', '.join(parts[:-1]) + (' and ' if len(parts) > 1 else '') + parts[-1]
    return f'Current time in {c["name"]}, {c["country"]}: {zone_bit}. {body[0].upper()}{body[1:]}.'


SHORT_SLUG = {'london': 'London', 'new-york': 'New York', 'sydney': 'Sydney', 'tokyo': 'Tokyo'}


# Shorter names for page text where the dataset's formal one reads oddly.
SHORT = {'New York City': 'New York'}


def pair_static(a, b, now):
    """(title, description, head html, body html) for a time-difference page."""
    a, b = dict(a, name=SHORT.get(a['name'], a['name'])), dict(b, name=SHORT.get(b['name'], b['name']))
    segs = pair_segments(a['zone'], b['zone'], now)
    gaps = sorted({g for *_, g in segs})
    usual = max(gaps, key=lambda g: sum(((l or dt.date(now.year + 1, 12, 31)) - f).days for f, l, x in segs if x == g))
    title = f'{a["name"]} to {b["name"]} time difference'
    lead = gap_sentence(a['name'], b['name'], usual)
    movers = [x['name'] for x in (a, b) if clock_changes(x['zone'], now)]
    if len(gaps) > 1:
        why = ('the two change their clocks on different dates' if len(movers) == 2
               else f'{movers[0]} changes its clocks and {({a["name"], b["name"]} - set(movers)).pop()} does not')
        lead += (f' for most of the year. Because {why}, the gap is '
                 + ' or '.join(hours(abs(g)) for g in gaps) + ' depending on the date.')
    else:
        lead += ' all year: the gap never changes.'
    head = (f'<section class="city-static"><p class="kicker">Time difference</p>'
            f'<h1>{e(a["name"])} and <span class="grad">{e(b["name"])}</span> time</h1>\n'
            f'<p class="live" id="live" aria-live="off"></p>\n'
            f'<p class="zone-para">{e(lead)}</p></section>')
    rows = [(day(f), day(l) if l else 'and after', gap_sentence(a['name'], b['name'], g)) for f, l, g in segs]
    months = [(_midweek(now.year, 1), 'January'), (_midweek(now.year, 7), 'July')]
    body = [f'<h2>The gap through {now.year} and {now.year + 1}</h2>' + table(['From', 'To', 'Difference'], rows),
            f'<h2>Working hours overlap</h2><p class="tnote">When 9 am – 5 pm in both cities meet, '
            f'in each city\'s own time.</p>'
            + table(['', *(m for _, m in months)],
                    [(f'{x["name"]} time', *(overlap_text(x['zone'], y['zone'], d) for d, _ in months))
                     for x, y in ((a, b), (b, a))])]
    nine = dt.datetime(now.year, 1, 15, 9, tzinfo=ZoneInfo(a['zone']))
    desc = (f'{lead.split(". ")[0]}. When it is 9 am in {a["name"]} it is {clock(nine.astimezone(ZoneInfo(b["zone"])))} '
            f'in {b["name"]} in January. Every date the gap changes, and the working hours both cities share.')
    return title, desc, head, '<section class="city-facts">' + '\n'.join(body) + '</section>'


def zone_slug(a, b):
    return f'{a}-to-{b}'


def zone_short(key, when):
    """What the zone's clock is called at `when`: 'EDT (UTC−4)'."""
    zone = ZONES[key][2]
    return _named(offset_minutes(zone, when), abbreviation(zone, when))


def hour_table(za, zb, date):
    """[(a wall time, b wall time)] for each whole hour of `date` in za."""
    out = []
    for h in range(24):
        t = dt.datetime(date.year, date.month, date.day, h, tzinfo=ZoneInfo(za))
        u = t.astimezone(ZoneInfo(zb))
        shift = (u.date() - t.date()).days
        out.append((clock(t), clock(u) + ({1: ' (next day)', -1: ' (day before)'}.get(shift, ''))))
    return out


def zone_pair_static(ka, kb, now):
    """(title, description, head html, body html) for /time/<a>-to-<b>/."""
    A, B = ZONES[ka], ZONES[kb]
    za, zb = A[2], B[2]
    jan, jul = _midweek(now.year, 1), _midweek(now.year, 7)
    noon = lambda d: dt.datetime(d.year, d.month, d.day, 12, tzinfo=dt.timezone.utc)  # noqa: E731
    gaps = [(m, offset_minutes(zb, noon(d)) - offset_minutes(za, noon(d))) for m, d in (('January', jan), ('July', jul))]
    same = gaps[0][1] == gaps[1][1]
    def rel(g, of=True):
        if g == 0:
            return 'the same time as' if of else 'the same time'
        return f'{hours(g)} {("ahead of" if of else "ahead") if g > 0 else "behind"}'
    if same:
        lead = f'{B[1]} ({B[0]}) is {rel(gaps[0][1])} {A[1]} ({A[0]}) all year.'
        short = lead
    else:
        lead = (f'{B[1]} is {rel(gaps[0][1])} {A[1]} in January, when the clocks read '
                f'{zone_short(ka, noon(jan))} and {zone_short(kb, noon(jan))}, and {rel(gaps[1][1], False)} in July, '
                f'when they read {zone_short(ka, noon(jul))} and {zone_short(kb, noon(jul))}.')
        short = f'{B[0]} is {rel(gaps[0][1])} {A[0]} in January and {rel(gaps[1][1], False)} in July.'
    nine = hour_table(za, zb, jan)[9]

    def labels(key):
        """'EST / EDT' when the zone's own label changes through the year."""
        names = []
        for d in (jan, jul):
            n = abbreviation(ZONES[key][2], noon(d))
            if n not in names:
                names.append(n)
        return ' / '.join(names)
    title = f'{A[0]} to {B[0]} converter: {A[1]} to {B[1]}'
    desc = (f'Convert {A[0]} to {B[0]}: 9 am {A[0]} is {nine[1]} {B[0]} in January. {short} '
            + ('Hour-by-hour table and shared working hours.' if same and len(pair_segments(za, zb, now)) == 1
               else 'Hour-by-hour table, the dates the gap changes, and shared working hours.'))
    head = (f'<section class="city-static"><p class="kicker">Time zone converter</p>'
            f'<h1>{e(A[0])} to <span class="grad">{e(B[0])}</span></h1>\n'
            f'<p class="live" id="live" aria-live="off"></p>\n'
            f'<p class="zone-para">{e(lead)}</p></section>')
    if same:
        tab = table([labels(ka), labels(kb)], hour_table(za, zb, jan))
    else:
        rows = [(a, b1, b2) for (a, b1), (_, b2) in zip(hour_table(za, zb, jan), hour_table(za, zb, jul))]
        tab = table([labels(ka), f'{labels(kb)}, January', f'{labels(kb)}, July'], rows)
    body = [f'<h2>{e(A[0])} to {e(B[0])}, hour by hour</h2>'
            f'<p class="tnote">Each hour of the day in {e(A[1])}, and the time in {e(B[1])} at that moment.</p>' + tab]
    segs = pair_segments(za, zb, now)
    if len(segs) > 1:
        body.append(f'<h2>When the gap changes in {now.year} and {now.year + 1}</h2>'
                    + table(['From', 'To', 'Difference'],
                            [(day(f), day(l) if l else 'and after', gap_sentence(A[1], B[1], g)) for f, l, g in segs]))
    months = [(jan, 'January'), (jul, 'July')]
    body.append('<h2>Working hours overlap</h2><p class="tnote">When 9 am – 5 pm on both sides meet, '
                'in each side\'s own time.</p>'
                + table(['', *(m for _, m in months)],
                        [(f'{x[1]}', *(overlap_text(x[2], y[2], d) for d, _ in months)) for x, y in ((A, B), (B, A))]))
    body.append('<h2>About these abbreviations</h2><ul class="changes">'
                + ''.join(f'<li><a href="/time/{k}/"><b>{e(ZONES[k][0])}</b></a>: {e(ZONES[k][3])}</li>' for k in (ka, kb)) + '</ul>')
    others = [(x, y) for x, y in ZONE_PAIRS if (x, y) != (ka, kb) and {x, y} & {ka, kb}]
    body.append('<h2>More conversions</h2><ul class="links">'
                + ''.join(f'<li><a href="/time/{zone_slug(x, y)}/">{e(ZONES[x][0])} to {e(ZONES[y][0])}</a></li>'
                          for x, y in others) + '</ul>')
    preload = f'z:{za}|{A[1]},z:{zb}|{B[1]}'
    return title, desc, head, '<section class="city-facts">' + '\n'.join(body) + '</section>', preload


def clock_key(zone, now):
    """Two zones with the same key show the same time every day of now's
    year and the next: same offset now, same changes on the same instants."""
    start = dt.datetime(now.year, 1, 1, tzinfo=dt.timezone.utc)
    return offset_minutes(zone, start), tuple(transitions(zone, start, days=731, limit=8))


def cities_on(zone, linkable, now, limit=24):
    key = clock_key(zone, now)
    return [p for p in sorted(linkable, key=lambda p: -p['pop']) if clock_key(p['zone'], now) == key][:limit]


def conversions_with(keys):
    return [(x, y) for x, y in ZONE_PAIRS if {x, y} & set(keys)]


def conversion_links(pairs):
    return ('<ul class="links">' + ''.join(f'<li><a href="/time/{zone_slug(x, y)}/">{e(ZONES[x][0])} to '
                                          f'{e(ZONES[y][0])}</a></li>' for x, y in pairs) + '</ul>')


def facts_html(zone, now):
    std, dst = year_times(zone, now)
    facts = [('Time zone', zone), ('UTC offset', offset_label(std[0]) + (f' / {offset_label(dst[0])}' if dst else '')),
             ('Abbreviation', std[1] + (f' / {dst[1]}' if dst else '')),
             ('Daylight saving', 'Yes' if dst else 'No')]
    return '<dl class="facts">' + ''.join(f'<div><dt>{e(k)}</dt><dd>{e(v)}</dd></div>' for k, v in facts) + '</dl>'


def changes_html(zone, now):
    changes = clock_changes(zone, now)
    if not changes:
        return ''
    return (f'<h2>Clock changes in {now.year} and {now.year + 1}</h2><ul class="changes">'
            + ''.join(f'<li>{e(t)}</li>' for _, t in changes) + '</ul>')


def zone_page(key, linkable, slugs, now):
    """(title, description, head, body, preload) for /time/<abbr>/."""
    abbr, name, zone, note = ZONES[key]
    std, dst = year_times(zone, now)
    span = offset_label(std[0]) + (f' / {offset_label(dst[0])}' if dst else '')
    title = f'{abbr} Time Now – Current {name} ({span})'
    if dst:
        lead = (f'{name} is {_named(*std)} in standard time and {_named(*dst)} while daylight saving time is on. '
                f'The clock above shows the time there right now.')
    else:
        lead = 'It does not change its clocks.'
        lead, note = note, lead   # the note already names the zone and its offset
    head = (f'<section class="city-static"><p class="kicker">Time zone</p>'
            f'<h1><span class="grad">{e(abbr)}</span> time now</h1>\n'
            f'<p class="live" id="live" aria-live="off"></p>\n'
            f'<p class="zone-para">{e(lead)} {e(note)}</p>\n'
            f'<p class="zone-next" id="zone-next" data-zone="{e(zone)}"></p>\n' + facts_html(zone, now) + '</section>')
    body = [changes_html(zone, now)]
    cities = cities_on(zone, linkable, now)
    if cities:
        body.append(f'<h2>Cities on {e(name)}</h2><ul class="links">{link_list(cities, slugs)}</ul>')
    body.append(f'<h2>Convert {e(abbr)}</h2>' + conversion_links(conversions_with([key])))
    desc = (f'The current {name} ({abbr}) time, live to the second. {span}'
            + (', every clock change this year and next' if dst else ', no daylight saving')
            + f', the cities that use it, and {abbr} conversions.')
    return title, desc, head, '<section class="city-facts">' + '\n'.join(b for b in body if b) + '</section>', \
        f'z:{zone}|{name}'


def country_page(slug, pages, linkable, slugs, now):
    """(title, description, head, body, preload) for /time/<country>/."""
    cc, called, note = COUNTRIES[slug]
    mine = sorted([p for p in pages if p['cc'] == cc], key=lambda p: -p['pop'])
    zone, country = mine[0]['zone'], mine[0]['country']
    std, dst = year_times(zone, now)
    label = zone_label(zone, now)
    title = f'Time in {called} Now – {label}'
    cap = called[0].upper() + called[1:]
    keys = [k for k, z in ZONES.items() if clock_key(z[2], now) == clock_key(zone, now)]
    if dst:
        lead = (f'{cap} keeps one time zone: {_named(*std)} in standard time and '
                f'{_named(*dst)} during daylight saving time.')
    else:
        lead = f'{cap} keeps one time zone, {_named(*std)}, all year, with no daylight saving.'
    head = (f'<section class="city-static"><p class="kicker">World time</p>'
            f'<h1>Time in <span class="grad">{e(called)}</span></h1>\n'
            f'<p class="live" id="live" aria-live="off"></p>\n'
            f'<p class="zone-para">{e(lead)} {e(note)}</p>\n'
            f'<p class="zone-next" id="zone-next" data-zone="{e(zone)}"></p>\n' + facts_html(zone, now) + '</section>')
    body = [changes_html(zone, now)]
    big = [p for p in linkable if p['cc'] == cc]
    by_slug = {slugs[p['id']]: p for p in linkable}
    if big:
        body.append(f'<h2>City time pages in {e(called)}</h2><ul class="links">{link_list(big, slugs)}</ul>')
        body.append(overlap_section(dict(big[0], name=called), by_slug, slugs[big[0]['id']], now))
    if keys:
        body.append(f'<h2>Convert {e(ZONES[keys[0]][0])}</h2>' + conversion_links(conversions_with(keys)))
    desc = (f'The current time in {called}, live to the second: {label}. '
            + ('Every clock change this year and next, ' if dst else 'No daylight saving. ')
            + f'{"the" if dst else "The"} main cities and working hours shared with London, New York and Sydney.')
    return title, desc, head, '<section class="city-facts">' + '\n'.join(b for b in body if b) + '</section>', \
        f'z:{zone}|{country}'


def zone_reference(now):
    """The hub's abbreviation table: readable with no JavaScript at all."""
    rows = []
    for key, (abbr, name, zone, _) in ZONES.items():
        std, dst = year_times(zone, now)
        rows.append((abbr, name, offset_label(std[0]),
                     f'{dst[1]} ({offset_label(dst[0])})' if dst else 'No change'))
    return (table(['Abbr', 'Zone', 'Standard', 'Daylight saving'], rows)
            + '<h2>Time zones now</h2><ul class="links">'
            + ''.join(f'<li><a href="/time/{k}/">{e(z[0])} time now</a></li>' for k, z in ZONES.items()) + '</ul>')


HUB_INTRO = (
    '<section class="city-facts"><h2>How the converter works</h2>'
    '<p>Type a time and a place the way you would say it: <b>8am Tokyo in London</b>, <b>3pm EST to IST</b>, '
    'an airport code such as <b>LHR</b>, or an offset such as <b>UTC+5:30</b>. Every city you add gets a row '
    'of hours, lined up so one column is one moment. Drag the slider or tap an hour to move every clock together; '
    'green hours are inside everyone\'s working day, so the meeting time that suits all of them stands out.</p>'
    '<p>Daylight saving is handled for each place on its own dates, so the gap between New York and London is '
    'right in the weeks when only one of them has changed its clocks. Pick a date to plan ahead; sunrise, sunset, '
    'the next clock change and public holidays for each city sit one tap away. When the time is set, send it as a '
    'link, add it to Google Calendar or Outlook, or download an .ics file. It all runs in your browser: no account, '
    'no sign-up, and nothing you type is sent anywhere.</p>'
    '<h2>Time zone abbreviations</h2>'
    '<p class="tnote">The abbreviations people type most, and the clock each one means here.</p>{table}'
    '</section>')


def city_index(pages, slugs, pairs=(), zone_pairs=(), countries=()):
    """The hub's list. Two cities with one name show their country."""
    names = {}
    for p in pages:
        names[p['name']] = names.get(p['name'], 0) + 1
    label = lambda p: p['name'] + (f', {p["country"]}' if names[p['name']] > 1 else '')  # noqa: E731
    groups = {}
    for p in sorted(pages, key=lambda p: p['name']):
        groups.setdefault(continent(p['zone']), []).append(p)
    out = ['<section class="city-index">']
    if countries:
        out.append('<h2>Time by country</h2><ul class="links">'
                   + ''.join(f'<li><a href="/time/{s}/">{e(n)}</a></li>' for s, n in countries) + '</ul>')
    if zone_pairs:
        out.append('<h2>Time zone conversions</h2><ul class="links">'
                   + ''.join(f'<li><a href="/time/{zone_slug(x, y)}/">{e(ZONES[x][0])} to {e(ZONES[y][0])}</a></li>'
                             for x, y in zone_pairs) + '</ul>')
    if pairs:
        out.append('<h2>Time differences</h2><ul class="links">'
                   + ''.join(f'<li><a href="/time/{s}/">{e(x)} – {e(y)}</a></li>' for s, x, y in pairs) + '</ul>')
    out.append('<h2>City time pages</h2>')
    for name in sorted(groups):
        out.append(f'<h3>{e(name)}</h3><ul class="links">'
                   + ''.join(f'<li><a href="/time/{slugs[p["id"]]}/">{e(label(p))}</a></li>' for p in groups[name])
                   + '</ul>')
    out.append('</section>')
    return '\n'.join(out)


def redirect_page(target):
    url = f'{SITE}/time/{target}/'
    return ('<!DOCTYPE html>\n<html lang="en"><head><meta charset="UTF-8">'
            f'<title>Moved</title><link rel="canonical" href="{url}">'
            f'<meta http-equiv="refresh" content="0; url=/time/{target}/"></head>'
            f'<body><p>This page moved to <a href="/time/{target}/">{url}</a>.</p></body></html>\n')


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
    feat = featured_ids(cities)
    pages = select_pages(cities, featured=feat)
    slugs = assign_slugs(pages, feat)
    by_slug = {slugs[p['id']]: p for p in pages}
    indexed = [p for p in pages if p['id'] in feat]
    pairs = [(pair_slug(x, y), by_slug[x], by_slug[y]) for x, y in PAIRS]
    assert all(p['id'] in feat for _, a, b in pairs for p in (a, b)), 'PAIRS must use featured cities'
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
        title='World Clock &amp; Time Zone Converter – Meeting Planner | Unichrono',
        description=e('Free world clock, time zone converter and meeting planner. Type "3pm EST to IST" or "8am Tokyo in London", '
                      'compare cities hour by hour, and find a time that suits everyone. No sign-up.'),
        canonical=f'{SITE}/time/', jsonld=json.dumps({
            '@context': 'https://schema.org', '@type': 'WebApplication', 'name': 'Unichrono World Time',
            'url': f'{SITE}/time/', 'applicationCategory': 'UtilitiesApplication', 'operatingSystem': 'Any',
            'offers': {'@type': 'Offer', 'price': '0'}}, indent=1),
        static='<section class="city-static"><p class="kicker">World time</p><h1>World Clock &amp; Time Zone <span class="grad">Converter</span></h1>'
               '<p class="zone-para">See the time in every city you care about, convert a time between any cities or '
               'time zones, compare them hour by hour, '
               'pick a meeting time that works for everyone, and share it.</p>'
               '<p class="live" id="live" aria-live="off"></p></section>',
        links=HUB_INTRO.replace('{table}', zone_reference(now)), preload='', robots='',
        cityindex=city_index(indexed, slugs, [(s, a['name'], b['name']) for s, a, b in pairs], ZONE_PAIRS,
                             [(c, next(p['country'] for p in pages if p['cc'] == COUNTRIES[c][0])) for c in COUNTRIES])))

    for c in pages:
        slug = slugs[c['id']]
        zone_bit = zone_label(c['zone'], now)
        head, links = city_static(c, pages, slugs, now)
        page = out / slug
        page.mkdir()
        page.joinpath('index.html').write_text(render(
            template,
            title=e(f'Current time in {c["name"]}, {c["country"]} – {zone_bit} | Unichrono'),
            description=e(city_description(c, zone_bit, now, slug)),
            canonical=f'{SITE}/time/{slug}/',
            jsonld=json.dumps({'@context': 'https://schema.org', '@type': 'WebPage',
                               'name': f'Time in {c["name"]}, {c["country"]}', 'url': f'{SITE}/time/{slug}/',
                               'about': {'@type': 'Place', 'name': c['name'],
                                         'address': {'@type': 'PostalAddress', 'addressCountry': c['cc']},
                                         'geo': {'@type': 'GeoCoordinates', 'latitude': c['lat'], 'longitude': c['lng']}}},
                              indent=1, ensure_ascii=False),
            static=head, links=links, preload=slug, cityindex='',
            robots='' if c['id'] in feat else '<meta name="robots" content="noindex, follow">'))

    for s, a, b in pairs:
        title, desc, head, body = pair_static(a, b, now)
        (out / s).mkdir()
        (out / s / 'index.html').write_text(render(
            template, title=e(f'{title} | Unichrono'), description=e(desc), canonical=f'{SITE}/time/{s}/',
            jsonld=json.dumps({'@context': 'https://schema.org', '@type': 'WebPage', 'name': title,
                               'url': f'{SITE}/time/{s}/'}, indent=1, ensure_ascii=False),
            static=head, links=body, preload=f'{slugs[a["id"]]},{slugs[b["id"]]}', cityindex='', robots=''))

    for ka, kb in ZONE_PAIRS:
        title, desc, head, body, preload = zone_pair_static(ka, kb, now)
        s = zone_slug(ka, kb)
        (out / s).mkdir()
        (out / s / 'index.html').write_text(render(
            template, title=e(f'{title} | Unichrono'), description=e(desc), canonical=f'{SITE}/time/{s}/',
            jsonld=json.dumps({'@context': 'https://schema.org', '@type': 'WebPage', 'name': title,
                               'url': f'{SITE}/time/{s}/'}, indent=1, ensure_ascii=False),
            static=head, links=body, preload=e(preload), cityindex='', robots=''))

    extra = [(k, zone_page(k, indexed, slugs, now)) for k in ZONES]
    extra += [(c, country_page(c, pages, indexed, slugs, now)) for c in COUNTRIES]
    for slug, (title, desc, head, body, preload) in extra:
        assert not (out / slug).exists(), f'{slug} clashes with a city page'
        (out / slug).mkdir()
        (out / slug / 'index.html').write_text(render(
            template, title=e(f'{title} | Unichrono'), description=e(desc), canonical=f'{SITE}/time/{slug}/',
            jsonld=json.dumps({'@context': 'https://schema.org', '@type': 'WebPage', 'name': title,
                               'url': f'{SITE}/time/{slug}/'}, indent=1, ensure_ascii=False),
            static=head, links=body, preload=e(preload), cityindex='', robots=''))

    taken = {p.name for p in out.iterdir()}
    for old, new in json.loads(REDIRECTS.read_text()).items() if REDIRECTS.exists() else ():
        assert new in taken, f'redirect {old} -> {new}: no such page'
        if old not in taken:
            (out / old).mkdir()
            (out / old / 'index.html').write_text(redirect_page(new))

    update_sitemap(root, [f'{SITE}/time/'] + [f'{SITE}/time/{slugs[p["id"]]}/' for p in indexed]
                   + [f'{SITE}/time/{s}/' for s, _, _ in pairs]
                   + [f'{SITE}/time/{zone_slug(a, b)}/' for a, b in ZONE_PAIRS]
                   + [f'{SITE}/time/{k}/' for k in ZONES] + [f'{SITE}/time/{c}/' for c in COUNTRIES],
                   now.date().isoformat())
    update_llms(root)
    return {'pages': len(pages), 'indexed': len(indexed), 'pairs': len(pairs), 'zone_pairs': len(ZONE_PAIRS), 'zones': len(ZONES), 'country_pages': len(COUNTRIES), 'countries': len({c['cc'] for c in cities}),
            'page_countries': len({p['cc'] for p in pages})}


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True)
    args = ap.parse_args()
    print(build(args.db))
