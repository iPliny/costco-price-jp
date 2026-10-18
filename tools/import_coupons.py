"""Offline newsletter import. Never follows URLs or downloads remote images.

Owner: save complete HTML/PDF/screenshots outside the public repository.
Reviewer/Codex: inspect ALL local pages/images, then prepare a private facts JSON:
  {"complete": true, "evidence": {"file.jpg": "sha256..."}, "rows": [...]}
Each row has the public CSV fields except fetched_at, plus evidence_file pointing
to a visually checked local input (or HTML's saved local asset). Unknown optional
prices and start dates are empty, never zero. See README for the full workflow.
"""
import argparse
import csv
import hashlib
import json
import os
import re
import tempfile
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

COLS = 'week_from week_to item_no name_ja discount_yen price_after price_before scope source source_url fetched_at'.split()
LEGACY_COLS = COLS[:]
COLS.append('price_unit')
JST = timezone(timedelta(hours=9))


class SavedHTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.images = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'img' and attrs.get('src'):
            self.images.append(attrs['src'])


def local_inputs(inputs):
    files = set()
    for raw in inputs:
        p = Path(raw).resolve(strict=True)
        if p.suffix.lower() not in {'.html', '.htm', '.pdf', '.png', '.jpg', '.jpeg', '.webp'}:
            raise ValueError('input must be saved HTML, PDF, or an image')
        files.add(p)
        if p.suffix.lower() in {'.html', '.htm'}:
            b = p.read_bytes()
            encoding = 'cp932' if re.search(br'charset\s*=\s*["\']?shift[_-]jis', b, re.I) else 'utf-8-sig'
            parser = SavedHTML()
            parser.feed(b.decode(encoding))
            for src in parser.images:
                u = urlsplit(src)
                if u.scheme or u.netloc:
                    continue  # Including file://: never traverse arbitrary local paths.
                asset = (p.parent / unquote(u.path)).resolve()
                if p.parent not in asset.parents:
                    raise ValueError('saved resource escapes input directory')
                if asset.is_file():
                    files.add(asset)
    return files


def valid_date(s):
    if not isinstance(s, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', s):
        raise ValueError('expected ISO date')
    return date.fromisoformat(s)


def issue_date(row):
    # The sample URL contains an issue date, not a guessable next-issue URL.
    match = re.search(r'/upz/(\d{6})_', row['source_url'])
    if match:
        day = valid_date('20' + match[1][:2] + '-' + match[1][2:4] + '-' + match[1][4:6])
    elif row['source'] == '電子報':
        # Grouping a newsletter by import time would duplicate it when re-imported in a later week.
        raise ValueError('newsletter URL has no issue date (/upz/YYMMDD_)')
    else:
        day = valid_date(row['fetched_at'][:10])
    return day


def issue_week(row):
    publication = issue_date(row)  # Always validate the newsletter issue, even with a known start.
    # A Sunday issue can announce next Monday's offers. Keep them in that
    # explicit offer week so tomorrow's deal cannot erase today's active one.
    day = max(publication, valid_date(row['week_from'])) if row.get('week_from') else publication
    return (day - timedelta(days=day.weekday())).isoformat()


def validate(row, fetched_at):
    out = {k: row.get(k, '') for k in COLS}
    out['price_unit'] = out['price_unit'] or '件'
    out['fetched_at'] = fetched_at
    if any(not isinstance(v, str) for v in out.values()):
        raise ValueError('facts must be strings; unknown values must be empty strings')
    if not re.fullmatch(r'\d+', out['item_no']) or not out['name_ja'].strip():
        raise ValueError('missing or unreadable item number/name')
    end = valid_date(out['week_to'])
    if out['week_from'] and valid_date(out['week_from']) > end:
        raise ValueError('reversed date interval')
    if out['scope'] not in {'倉庫店', 'オンライン'} or out['source'] not in {'電子報', '官網'}:
        raise ValueError('invalid scope/source')
    if out['price_unit'] not in {'件', '100g'}:
        raise ValueError('unsupported price unit')
    url = urlsplit(out['source_url'])
    hosts = {'電子報': {'cds2.costcojapan.jp'}, '官網': {'www.costco.co.jp'}}
    if url.scheme != 'https' or url.hostname not in hosts[out['source']] or url.username or url.password or url.port:
        raise ValueError('source must be an official HTTPS URL')
    for k in ['discount_yen', 'price_after', 'price_before']:
        if out[k] and (not re.fullmatch(r'\d+', out[k]) or int(out[k]) > 9007199254740991):
            raise ValueError('invalid yen amount')
    if not out['discount_yen'] and not out['price_after']:
        raise ValueError('missing both discount and special price')
    if out['discount_yen'] == '0':
        raise ValueError('discount must be positive or unknown')
    if all(out[k] for k in ['price_before', 'price_after', 'discount_yen']):
        if int(out['price_before']) - int(out['price_after']) != int(out['discount_yen']):
            raise ValueError('price arithmetic mismatch')
    return out


def run(inputs, facts, output):
    inputs = list(inputs)
    files = local_inputs(inputs)
    if not facts:
        raise ValueError('visual review required: inspect local files and provide --facts; no CSV was changed')
    receipts = [facts] if isinstance(facts, (str, Path)) else list(facts)
    fetched_at = datetime.now(JST).isoformat(timespec='seconds')
    rows = []
    for receipt in receipts:
        rows.extend(reviewed_rows(receipt, files, fetched_at))
    selected = {}
    for row in rows:
        key = (issue_week(row), row['item_no'])
        previous = selected.get(key)
        if previous:
            if issue_date(row) == issue_date(previous):
                fields = [k for k in COLS if k not in {'fetched_at', 'source_url'}]
                if any(row[k] != previous[k] for k in fields):
                    raise ValueError('conflicting item in the same issue; resolve before import')
                # Identical facts from same-day campaign URLs keep a stable
                # provenance link regardless of --facts ordering.
                if row['source_url'] >= previous['source_url']:
                    continue
            elif issue_date(row) < issue_date(previous):
                continue
        selected[key] = row
    rows = list(selected.values())
    weeks = {issue_week(r) for r in rows}
    target = Path(output)
    old = []
    if target.exists():
        with target.open(encoding='utf-8-sig', newline='') as f:
            reader = csv.DictReader(f)
            if reader.fieldnames not in [COLS, LEGACY_COLS]:
                raise ValueError('unexpected existing CSV schema')
            old = [{**r, 'price_unit': r.get('price_unit') or '件'} for r in reader if issue_week(r) not in weeks]
    merged = sorted(old + rows, key=lambda r: (issue_week(r), int(r['item_no'])))
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', newline='', dir=target.parent, delete=False) as f:
            tmp = f.name
            writer = csv.DictWriter(f, fieldnames=COLS, lineterminator='\n')
            writer.writeheader()
            writer.writerows(merged)
        os.replace(tmp, target)
    finally:
        if tmp and Path(tmp).exists():
            Path(tmp).unlink()
    return len(rows)


def reviewed_rows(facts, files, fetched_at):
    data = json.loads(Path(facts).read_text(encoding='utf-8'))
    if data.get('complete') is not True or not data.get('rows'):
        raise ValueError('complete visual review of the issue is required; keep unresolved items in private report')
    verified = set()
    for filename, expected in data.get('evidence', {}).items():
        p = (Path(facts).resolve().parent / filename).resolve()
        if p not in files or hashlib.sha256(p.read_bytes()).hexdigest() != expected:
            raise ValueError('evidence missing or changed since review')
        verified.add(p)
    rows = []
    for row in data['rows']:
        evidence = (Path(facts).resolve().parent / row.get('evidence_file', '')).resolve()
        if evidence not in verified:
            raise ValueError('each row needs a verified local evidence_file')
        rows.append(validate(row, fetched_at))
    return rows


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('inputs', nargs='+', help='local complete HTML/PDF/screenshots only')
    parser.add_argument('--facts', nargs='+', help='one or more private, visually reviewed JSON receipts; never commit these files')
    parser.add_argument('--output', default='data/coupons.csv')
    args = parser.parse_args()
    try:
        print(f'Imported {run(args.inputs, args.facts, args.output)} coupons; older issue weeks preserved.')
    except (ValueError, OSError, KeyError) as e:
        parser.exit(1, f'{e}\n')
