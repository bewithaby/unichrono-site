#!/usr/bin/env python3
"""Tells Bing, Yandex, Seznam and Naver (through IndexNow) which pages changed,
so they recrawl now instead of whenever they next pass by. Google does not
take part; it reads the sitemap.

    python3 tools/indexnow.py --since <git rev>   # pages changed since that commit
    python3 tools/indexnow.py --all               # every URL in the sitemap

Run it AFTER the push is live: the search engine fetches the key file from
the site to prove the ping came from the owner, and refuses if it is missing.
"""
import argparse
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

SITE = 'https://unichrono.app'
ROOT = Path(__file__).resolve().parents[1]
ENDPOINT = 'https://api.indexnow.org/indexnow'


def key():
    keys = [p for p in ROOT.glob('*.txt') if re.fullmatch(r'[0-9a-f]{32}\.txt', p.name)]
    assert len(keys) == 1, f'expected one <32 hex>.txt key file at the site root, found {len(keys)}'
    return keys[0].stem


def sitemap_urls():
    return re.findall(r'<loc>([^<]+)</loc>', (ROOT / 'sitemap.xml').read_text())


def url_for(path):
    """Site file → public URL: index.html → /, time/x/index.html → /time/x/."""
    if path.endswith('index.html'):
        return f'{SITE}/{path[:-len("index.html")]}'
    return f'{SITE}/{path}' if path.endswith('.html') else None


def changed_urls(since):
    files = subprocess.check_output(['git', 'diff', '--name-only', since, 'HEAD'], cwd=ROOT, text=True).split()
    listed = set(sitemap_urls())
    return sorted({u for u in map(url_for, files) if u in listed})


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--since')
    g.add_argument('--all', action='store_true')
    args = ap.parse_args()
    k = key()
    live = urllib.request.urlopen(f'{SITE}/{k}.txt', timeout=20).read().decode().strip()
    if live != k:
        sys.exit(f'{SITE}/{k}.txt is not live yet (got {live[:40]!r}); push and wait for Pages first')
    urls = sitemap_urls() if args.all else changed_urls(args.since)
    if not urls:
        print('nothing to send')
        return
    body = json.dumps({'host': 'unichrono.app', 'key': k, 'keyLocation': f'{SITE}/{k}.txt',
                       'urlList': urls[:10000]}).encode()
    req = urllib.request.Request(ENDPOINT, body, {'Content-Type': 'application/json; charset=utf-8'})
    with urllib.request.urlopen(req, timeout=30) as r:
        print(r.status, f'{len(urls)} URLs sent')   # 200 or 202 = accepted


if __name__ == '__main__':
    main()
