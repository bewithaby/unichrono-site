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
    return dict(id=i, name=name, ascii=name, country=country, cc=cc, zone=zone, lat=0.0, lng=0.0, pop=pop, aliases='')


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

    def test_same_name_same_country_falls_back_to_id(self):
        cs = [city(1, 'Rajpur', 'IN', 10), city(2, 'Rajpur', 'IN', 5)]
        self.assertEqual(b.assign_slugs(cs), {1: 'rajpur-in-1', 2: 'rajpur-in-2'})


class Selection(unittest.TestCase):
    def test_top_plus_one_per_country(self):
        cs = [city(i, f'C{i}', 'AA', 1000 - i) for i in range(10)] + [city(99, 'Small', 'BB', 1)]
        ids = [c['id'] for c in b.select_pages(cs, top=3)]
        self.assertEqual(ids, [0, 1, 2, 99])


class Text(unittest.TestCase):
    def test_zone_paragraph_no_dst(self):
        p = b.zone_paragraph(city(1, 'Tokyo', 'JP', 1, 'Asia/Tokyo', 'Japan'), NOW)
        self.assertIn('UTC+9', p)
        self.assertIn('does not change its clocks', p)

    def test_zone_paragraph_dst(self):
        p = b.zone_paragraph(city(1, 'London', 'GB', 1, 'Europe/London', 'United Kingdom'), NOW)
        self.assertIn('25 Oct 2026', p)
        self.assertIn('28 Mar 2027', p)

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
            for href in re.findall(r'href="(/time/[^"?#]*)', page.read_text()):
                target = self.root / href.lstrip('/')
                if not (target / 'index.html').exists() and not target.is_file():
                    missing.append((str(page.relative_to(self.root)), href))
        self.assertEqual(missing[:5], [])

    def test_sitemap_lists_every_page_once(self):
        xml = (self.root / 'sitemap.xml').read_text()
        self.assertEqual(xml.count('<loc>https://unichrono.app/time/</loc>'), 1)
        self.assertEqual(xml.count('<loc>https://unichrono.app/time/tokyo/</loc>'), 1)
        self.assertEqual(xml.count('<loc>https://unichrono.app/</loc>'), 1)
        self.assertEqual(xml.count('/time/'), self.stats['pages'] + 1)

    def test_llms_line_once(self):
        self.assertEqual((self.root / 'llms.txt').read_text().count('/time/'), 1)

    def test_city_page_static_content(self):
        html = (self.root / 'time' / 'tokyo' / 'index.html').read_text()
        self.assertIn('<title>Current time in Tokyo, Japan – JST (UTC+9) | Unichrono</title>', html)
        self.assertIn('<link rel="canonical" href="https://unichrono.app/time/tokyo/">', html)
        self.assertIn('"@type": "Place"', html)
        self.assertIn('does not change its clocks', html)
        self.assertIn('data-preload="tokyo"', html)
        self.assertIn('href="/time/?c=tokyo,new-york"', html)

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
