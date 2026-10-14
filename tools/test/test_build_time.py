import datetime as dt
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_time as b  # noqa: E402

DB = os.environ.get('UC_CITIES_DB', '/Users/aby/XcodeProjects/unichrono-ios/Unichrono/Resources/cities.sqlite')
NOW = dt.datetime(2026, 10, 4, tzinfo=dt.timezone.utc)


def city(i, name, cc, pop, zone='Europe/London', country='X'):
    return dict(id=i, name=name, ascii=name, country=country, cc=cc, zone=zone, lat=None, lng=None, pop=pop, aliases='')


class Slugs(unittest.TestCase):
    def test_slugify(self):
        self.assertEqual(b.slugify('São Paulo'), 'sao-paulo')
        self.assertEqual(b.slugify("N'Djamena"), 'ndjamena')
        self.assertEqual(b.slugify('  Ho Chi Minh City '), 'ho-chi-minh-city')

    def test_slugClashGetsCountry(self):
        cs = [city(1, 'San Jose', 'US', 10), city(2, 'San Jose', 'CR', 5), city(3, 'Tokyo', 'JP', 9)]
        self.assertEqual(b.assign_slugs(cs), {1: 'san-jose-us', 2: 'san-jose-cr', 3: 'tokyo'})

    def test_new_york_city_is_new_york(self):
        self.assertEqual(b.assign_slugs([city(1, 'New York City', 'US', 10)]), {1: 'new-york'})

    def test_featured_city_keeps_the_bare_name(self):
        cs = [city(1, 'Hyderabad', 'PK', 10), city(2, 'Hyderabad', 'IN', 5)]
        self.assertEqual(b.assign_slugs(cs, featured={2}), {1: 'hyderabad-pk', 2: 'hyderabad'})

    def test_slug_from_display_name_not_geonames_ascii(self):
        self.assertEqual(b.assign_slugs([dict(city(1, 'Zürich', 'CH', 10), ascii='Zuerich')]), {1: 'zurich'})
        self.assertEqual(b.slugify('Diyarbakır'), 'diyarbakir')
        self.assertEqual(b.slugify('San Pawl il-Baħar'), 'san-pawl-il-bahar')

    def test_same_name_same_country_falls_back_to_id(self):
        cs = [city(1, 'Rajpur', 'IN', 10), city(2, 'Rajpur', 'IN', 5)]
        self.assertEqual(b.assign_slugs(cs), {1: 'rajpur-in-1', 2: 'rajpur-in-2'})


class Selection(unittest.TestCase):
    def test_top_plus_one_per_country(self):
        cs = [city(i, f'C{i}', 'AA', 1000 - i) for i in range(10)] + [city(99, 'Small', 'BB', 1)]
        ids = [c['id'] for c in b.select_pages(cs, top=3)]
        self.assertEqual(ids, [0, 1, 2, 99])


    def test_boroughs_next_to_a_bigger_city_are_skipped(self):
        nyc = dict(city(1, 'New York City', 'US', 9_000_000), lat=40.71, lng=-74.01)
        brooklyn = dict(city(2, 'Brooklyn', 'US', 2_500_000), lat=40.65, lng=-73.95)
        newark = dict(city(3, 'Philadelphia', 'US', 1_500_000), lat=39.95, lng=-75.17)
        manhattan = dict(city(4, 'Manhattan', 'US', 1_400_000), lat=40.78, lng=-73.97)
        bronx = dict(city(5, 'The Bronx', 'US', 1_300_000), lat=40.85, lng=-73.87)  # 19 km from NYC, 7 from Manhattan
        ids = [c['id'] for c in b.select_pages([nyc, brooklyn, newark, manhattan, bronx], top=5)]
        self.assertEqual(ids, [1, 3])

    def test_featured_cities_are_added(self):
        cs = [city(i, f'C{i}', 'AA', 1000 - i) for i in range(10)]
        ids = [c['id'] for c in b.select_pages(cs, top=3, featured={7})]
        self.assertEqual(ids, [0, 1, 2, 7])

    def test_featured_ids_pick_the_biggest_and_fail_on_unknown(self):
        cs = [city(1, 'Kingston', 'JM', 900), city(2, 'Kingston', 'JM', 5)]
        self.assertEqual(b.featured_ids(cs, [('Kingston', 'JM')]), {1})
        with self.assertRaises(AssertionError):
            b.featured_ids(cs, [('Atlantis', 'XX')])


class Facts(unittest.TestCase):
    def test_clock_changes_london(self):
        got = [t for _, t in b.clock_changes('Europe/London', NOW)]
        self.assertEqual(got[0], 'Sun 29 Mar 2026: clocks go forward 1 hour at 1:00\u00a0am, to BST (UTC+1)')
        self.assertEqual(got[1], 'Sun 25 Oct 2026: clocks go back 1 hour at 2:00\u00a0am, to GMT (UTC)')
        self.assertEqual(len(got), 4)
        self.assertEqual(b.clock_changes('Asia/Tokyo', NOW), [])

    def test_overlap_crosses_the_date_line(self):
        # Tokyo's Wednesday 9 am is Los Angeles' Tuesday 4 pm (PST).
        o = b.overlap('Asia/Tokyo', 'America/Los_Angeles', dt.date(2026, 1, 14))
        self.assertEqual((o[0].hour, o[1].hour), (9, 10))
        self.assertIsNone(b.overlap('Europe/London', 'Australia/Sydney', dt.date(2026, 1, 14)))
        self.assertEqual(b.overlap_text('Europe/London', 'America/New_York', dt.date(2026, 7, 15)),
                         '2:00\u00a0pm – 5:00\u00a0pm (3 hours)')

    def test_sun_matches_the_tool(self):
        rise, set_ = b.sun_times(51.51, -0.13, 'Europe/London', dt.date(2026, 6, 21))
        self.assertEqual((f'{rise:%H:%M}', f'{set_:%H:%M}'), ('04:44', '21:22'))  # time/js/sun.js gives the same
        self.assertEqual(b.sun_times(78.22, 15.65, 'Arctic/Longyearbyen', dt.date(2026, 6, 21)), 'day')
        self.assertEqual(b.sun_times(78.22, 15.65, 'Arctic/Longyearbyen', dt.date(2026, 12, 21)), 'night')

    def test_pair_segments_london_new_york(self):
        segs = b.pair_segments('Europe/London', 'America/New_York', NOW)
        self.assertEqual(segs[0], (dt.date(2026, 1, 1), dt.date(2026, 3, 7), -300))
        self.assertEqual(segs[1], (dt.date(2026, 3, 8), dt.date(2026, 3, 28), -240))
        self.assertEqual(len(segs), 9)
        self.assertEqual(b.pair_segments('Asia/Tokyo', 'Asia/Seoul', NOW), [(dt.date(2026, 1, 1), None, 0)])

    def test_us_zones_have_no_backwards_rows(self):
        # Eastern and Pacific both change at 2 am local, three hours apart: the
        # gap is 2 or 4 hours for those hours only, never for a whole day.
        segs = b.pair_segments('America/Los_Angeles', 'America/New_York', NOW)
        self.assertEqual(segs, [(dt.date(2026, 1, 1), None, 180)])
        self.assertTrue(b.brief_gaps('America/Los_Angeles', 'America/New_York', NOW))
        self.assertFalse(b.brief_gaps('Europe/London', 'Europe/Paris', NOW))
        for f, l, _ in b.pair_segments('Europe/London', 'America/New_York', NOW):
            self.assertTrue(l is None or l >= f)


class Text(unittest.TestCase):
    def test_zone_paragraph_no_dst(self):
        p = b.zone_paragraph(city(1, 'Tokyo', 'JP', 1, 'Asia/Tokyo', 'Japan'), NOW)
        self.assertEqual(p, 'Tokyo uses Asia/Tokyo time: JST (UTC+9) all year. Tokyo does not change its clocks.')

    def test_city_not_country_for_no_dst(self):
        # Phoenix keeps its clocks; the United States does not.
        p = b.zone_paragraph(city(1, 'Phoenix', 'US', 1, 'America/Phoenix', 'United States'), NOW)
        self.assertIn('Phoenix does not change its clocks', p)
        self.assertNotIn('United States', p)

    def test_zone_paragraph_dst_is_stable(self):
        p = b.zone_paragraph(city(1, 'London', 'GB', 1, 'Europe/London', 'United Kingdom'), NOW)
        self.assertEqual(p, 'London uses Europe/London time: GMT (UTC) as standard time and BST (UTC+1) '
                            'during daylight saving time.')
        # The same text before and after the October change.
        later = dt.datetime(2026, 12, 1, tzinfo=dt.timezone.utc)
        self.assertEqual(p, b.zone_paragraph(city(1, 'London', 'GB', 1, 'Europe/London', 'United Kingdom'), later))

    def test_southern_hemisphere_daylight_is_the_bigger_offset(self):
        p = b.zone_paragraph(city(1, 'Sydney', 'AU', 1, 'Australia/Sydney', 'Australia'), NOW)
        self.assertIn('AEST (UTC+10) as standard time and AEDT (UTC+11) during daylight saving', p)

    def test_zone_label_for_titles(self):
        self.assertEqual(b.zone_label('Europe/London', NOW), 'GMT/BST')
        self.assertEqual(b.zone_label('Asia/Tokyo', NOW), 'JST (UTC+9)')

    def test_tz_data_is_the_pinned_package(self):
        import tzdata
        self.assertEqual(b.TZ_VERSION, tzdata.IANA_VERSION)

    def test_holidays_are_english_and_skip_sundays(self):
        se = b.holidays_for('SE', [2026])
        self.assertTrue(se)
        self.assertFalse([n for _, n in se if 'Sunday' in n.split('; ') or n == 'Söndag'])
        self.assertIn(['2026-04-05', 'Easter Sunday'], se)
        it = b.holidays_for('IT', [2026])
        self.assertTrue(it is None or 'Capodanno' not in [n for _, n in it])

    def test_continent(self):
        self.assertEqual(b.continent('America/Sao_Paulo'), 'Americas')
        self.assertEqual(b.continent('Australia/Sydney'), 'Oceania')
        self.assertEqual(b.continent('Asia/Tokyo'), 'Asia')

    def test_offset_label(self):
        self.assertEqual(b.offset_label(330), 'UTC+5:30')
        self.assertEqual(b.offset_label(-180), 'UTC−3')
        self.assertEqual(b.offset_label(0), 'UTC')


@unittest.skipUnless(os.path.exists(DB), 'cities.sqlite not available')
class EndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        (cls.root / 'sitemap.xml').write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            '  <url>\n    <loc>https://unichrono.app/</loc>\n  </url>\n</urlset>\n')
        (cls.root / 'llms.txt').write_text('# Unichrono\n')
        cls.stats = b.build(DB, cls.root, NOW)
        b.build(DB, cls.root, NOW)  # a second run must not duplicate anything

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_page_count_and_countries(self):
        self.assertTrue(500 <= self.stats['pages'] <= 700, self.stats)
        self.assertEqual(self.stats['countries'], self.stats['page_countries'])

    def test_every_internal_link_resolves(self):
        missing = []
        for page in (self.root / 'time').rglob('index.html'):
            for href in re.findall(r'<a [^>]*href="(/time/[^"?#]*)', page.read_text()):
                target = self.root / href.lstrip('/')
                if not (target / 'index.html').exists() and not target.is_file():
                    missing.append((str(page.relative_to(self.root)), href))
        self.assertEqual(missing[:5], [])

    def test_sitemap_lists_every_page_once(self):
        xml = (self.root / 'sitemap.xml').read_text()
        self.assertEqual(xml.count('<loc>https://unichrono.app/time/</loc>'), 1)
        self.assertEqual(xml.count('<loc>https://unichrono.app/time/tokyo/</loc>'), 1)
        self.assertEqual(xml.count('<loc>https://unichrono.app/</loc>'), 1)
        self.assertEqual(xml.count('/time/'), self.stats['indexed'] + self.stats['pairs'] + self.stats['zone_pairs']
                         + self.stats['zones'] + self.stats['country_pages'] + 1)
        self.assertIn('<loc>https://unichrono.app/time/est-to-ist/</loc>', xml)
        self.assertNotIn('/time/casey/', xml)
        self.assertIn('<loc>https://unichrono.app/time/london-new-york/</loc>', xml)

    def test_llms_line_once(self):
        self.assertEqual((self.root / 'llms.txt').read_text().count('/time/'), 1)

    def test_city_page_static_content(self):
        html = (self.root / 'time' / 'tokyo' / 'index.html').read_text()
        self.assertIn('<title>Current time in Tokyo, Japan – JST (UTC+9) | Unichrono</title>', html)
        london = (self.root / 'time' / 'london' / 'index.html').read_text()
        self.assertIn('<title>Current time in London, United Kingdom – GMT/BST | Unichrono</title>', london)
        self.assertIn('id="zone-next"', london)
        self.assertNotIn('Next clock changes', london)
        self.assertIn('<link rel="canonical" href="https://unichrono.app/time/tokyo/">', html)
        self.assertIn('"@type": "Place"', html)
        self.assertIn('Tokyo does not change its clocks', html)
        self.assertIn('data-preload="tokyo"', html)
        self.assertIn('href="/time/new-york-tokyo/"', html)
        self.assertIn('href="/time/?c=tokyo,dubai"', html)
        self.assertIn('Clock changes in 2026 and 2027', london)
        self.assertIn('<h2>Working hours overlap</h2>', html)
        self.assertIn('<h2>Sunrise and sunset in Tokyo</h2>', html)
        self.assertNotIn('noindex', html)

    def test_only_featured_pages_are_indexed(self):
        casey = (self.root / 'time' / 'casey' / 'index.html').read_text()
        self.assertIn('<meta name="robots" content="noindex, follow">', casey)
        hub = (self.root / 'time' / 'index.html').read_text()
        self.assertNotIn('href="/time/casey/"', hub)
        self.assertIn('href="/time/tokyo/"', hub)
        self.assertEqual(self.stats['indexed'], len(b.FEATURED))

    def test_pair_page(self):
        html = (self.root / 'time' / 'london-new-york' / 'index.html').read_text()
        self.assertIn('<title>London to New York time difference | Unichrono</title>', html)
        self.assertIn('data-preload="london,new-york"', html)
        self.assertIn('New York is 5 hours behind London for most of the year', html)
        self.assertIn('<link rel="canonical" href="https://unichrono.app/time/london-new-york/">', html)

    def test_zone_pair_page(self):
        html = (self.root / 'time' / 'est-to-ist' / 'index.html').read_text()
        self.assertIn('<title>EST to IST converter: Eastern Time to India Standard Time | Unichrono</title>', html)
        self.assertIn('data-preload="z:America/New_York|Eastern Time,z:Asia/Kolkata|India Standard Time"', html)
        self.assertIn('9 hours 30 min ahead in July', html)
        self.assertIn('<td>9:00\u00a0am</td><td>7:30\u00a0pm</td><td>6:30\u00a0pm</td>', html)
        self.assertIn('href="/time/pst-to-ist/"', html)
        fixed = (self.root / 'time' / 'utc-to-jst' / 'index.html').read_text()
        self.assertIn('9 hours ahead of Coordinated Universal Time (UTC) all year', fixed)
        self.assertNotIn('dates the gap changes', fixed)

    def test_zone_and_country_pages(self):
        est = (self.root / 'time' / 'est' / 'index.html').read_text()
        self.assertIn('<title>EST Time Now – Current Eastern Time (UTC−5 / UTC−4) | Unichrono</title>', est)
        self.assertIn('data-preload="z:America/New_York|Eastern Time"', est)
        self.assertIn('href="/time/new-york/"', est)
        self.assertIn('href="/time/ist-to-est/"', est)
        india = (self.root / 'time' / 'india' / 'index.html').read_text()
        self.assertIn('<title>Time in India Now – IST (UTC+5:30) | Unichrono</title>', india)
        self.assertIn('India keeps one time zone, IST (UTC+5:30), all year', india)
        self.assertIn('href="/time/mumbai/"', india)
        uk = (self.root / 'time' / 'uk' / 'index.html').read_text()
        self.assertIn('<title>Time in the UK Now – GMT/BST | Unichrono</title>', uk)
        self.assertIn('Clock changes in 2026 and 2027', uk)
        rev = (self.root / 'time' / 'ist-to-est' / 'index.html').read_text()
        self.assertIn('<h1>IST to <span class="grad">EST</span></h1>', rev)

    def test_hub(self):
        hub = (self.root / 'time' / 'index.html').read_text()
        self.assertIn('<title>World Clock &amp; Time Zone Converter – Meeting Planner | Unichrono</title>', hub)
        self.assertIn('href="/time/india/"', hub)
        self.assertIn('href="/time/est/"', hub)
        self.assertIn('<h2>How the converter works</h2>', hub)
        self.assertIn('<td>IST</td><td>India Standard Time</td><td>UTC+5:30</td><td>No change</td>', hub)
        self.assertIn('href="/time/est-to-ist/"', hub)
        self.assertIn('href="/time/london-new-york/"', hub)

    def test_hub_finder(self):
        hub = (self.root / 'time' / 'index.html').read_text()
        self.assertIn('id="dirq"', hub)
        self.assertIn('class="handoff"', hub)
        self.assertNotIn('dtab', hub)  # no tabs: every group is on show
        self.assertLess(hub.index('data-g="popular"'), hub.index('data-g="zones"'))
        self.assertIn('<a class="chipl hot" href="/time/india/">Time in India</a>', hub)
        for g in ('popular', 'conv', 'zones', 'countries', 'cities', 'pairs'):
            self.assertIn(f'class="dgroup" data-g="{g}"', hub)
        # Every indexed page is still linked from the hub, now inside the finder.
        for slug in ('tokyo', 'india', 'est', 'est-to-ist', 'london-new-york', 'ist-to-jst'):
            self.assertIn(f'href="/time/{slug}/"', hub)
        self.assertLess(hub.index('href="/time/est-to-ist/"'), hub.index('href="/time/gst-to-ist/"'))
        self.assertIn('<span class="sr">EST to </span>IST', hub)
        phil = (self.root / 'time' / 'philippines' / 'index.html').read_text()
        self.assertIn('PHT (UTC+8)', phil)
        self.assertNotIn('PST (UTC+8)', phil)

    def test_renamed_slugs_redirect(self):
        stub = (self.root / 'time' / 'zuerich' / 'index.html').read_text()
        self.assertIn('<meta http-equiv="refresh" content="0; url=/time/zurich/">', stub)
        self.assertIn('<link rel="canonical" href="https://unichrono.app/time/zurich/">', stub)

    def test_data_files(self):
        self.assertTrue((self.root / 'time/data/search.json').stat().st_size > 1_000_000)
        self.assertTrue((self.root / 'time/data/pages.json').exists())
        self.assertTrue((self.root / 'time/data/holidays/JP.json').exists())

    def test_no_leftovers(self):
        stale = self.root / 'time' / 'not-a-city'
        stale.mkdir(parents=True)
        (stale / 'index.html').write_text('old')
        b.build(DB, self.root, NOW)
        self.assertFalse(stale.exists())


if __name__ == '__main__':
    unittest.main()
