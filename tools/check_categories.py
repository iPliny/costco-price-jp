#!/usr/bin/env python3
"""檢查商品分類及依網站規則計算人氣；只使用 Python 標準函式庫。"""
import argparse
import csv
from collections import Counter
from datetime import date, timedelta
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
FIELDS = ['item_no', 'category', 'confidence', 'basis', 'checked']
PUBLISHABLE = {'已查核', '待確認'}
KEEP_STORE_NAME = {'spec_diff', 'different_product', 'name_unconfirmed'}


def read_csv(name, root=ROOT):
    with (root / 'data' / name).open(encoding='utf-8', newline='') as stream:
        return [{k: v.strip() if isinstance(v, str) else v for k, v in row.items()}
                for row in csv.DictReader(stream)]


def read_json(name, root=ROOT):
    file = root / 'data' / name
    return json.loads(file.read_text(encoding='utf-8')) if file.exists() else []


def matches_heat(product, heat):
    # 與 data.js 的 matchesHeat 相同：子字串、小寫、不增加斷詞或正規化；有 categories 時只比對這些小分類。
    if heat.get('categories') and product.get('category') not in heat['categories']:
        return False
    text = f"{product['searchText']} {product['item_no']} {product['spec']}".lower()
    return heat['query'].lower() in text


def popularity(preview=False, root=ROOT):
    names = {r['item_no']: r for r in read_csv('product_names.csv', root)}
    matches = {r['item_no']: r['verdict'] for r in read_csv('online_match.csv', root)}
    groups = {}
    for row in read_csv('observations.csv', root):
        if row['item_no'] and (preview or row['review_status'] in PUBLISHABLE):
            groups.setdefault(row['item_no'], []).append(row)
    assigned = {r['item_no']: r['category'] for r in read_csv('product_categories.csv', root)}
    heat = sorted(read_json('weekly_heat.json', root), key=lambda w: w['to'])[-4:]
    talks = read_json('item_discussions.json', root)
    latest = max((d['from'] for d in talks), default='')
    cutoff = (date.fromisoformat(latest) - timedelta(days=28)).isoformat() if latest else ''
    discussed = {d['item_no'] for d in talks
                 if cutoff < d['from'] <= latest and d.get('comments')}
    result = []
    for item_no, rows in groups.items():
        name = next((r['name'] for r in rows if r['name']), '')
        spec = next((r['spec'] for r in rows if r['spec']), '')
        name_ja = re.sub(r'\s+', ' ', names.get(item_no, {}).get('name_ja', '')).strip()
        if name_ja and matches.get(item_no) not in KEEP_STORE_NAME:
            name = name_ja
        product = {'item_no': item_no, 'name': name, 'spec': spec,
                   'category': assigned.get(item_no),
                   'searchText': ' '.join(dict.fromkeys([name] + [r['name'] for r in rows]))}
        reasons = []
        if any(matches_heat(product, h) for week in heat for h in week['items']):
            reasons.append('heat')
        if item_no in discussed:
            reasons.append('discussion')
        if reasons:
            result.append({'item_no': item_no, 'name': name, 'reasons': reasons})
    return sorted(result, key=lambda p: int(p['item_no']))


def check(root=ROOT, preview=False):
    categories = read_json('categories.json', root)
    leaves = {c['id'] for c in categories if c.get('parent') and not c.get('special')}
    with (root / 'data/product_categories.csv').open(encoding='utf-8', newline='') as stream:
        reader = csv.DictReader(stream)
        header = reader.fieldnames
        rows = list(reader)
    errors = []
    if header != FIELDS:
        errors.append(f'CSV 欄位不對：預期 {FIELDS}，得到 {header}')
    counts = Counter()
    seen = set()
    for line, row in enumerate(rows, 2):
        if None in row or any(row.get(k) is None for k in FIELDS):
            errors.append(f'第 {line} 列欄位數不對')
        item_no = row.get('item_no', '')
        category = row.get('category', '')
        if item_no in seen:
            errors.append(f'商品番号重複：{item_no}')
        seen.add(item_no)
        if not item_no or not item_no.isascii() or not item_no.isdigit():
            errors.append(f'第 {line} 列商品番号不合法：{item_no}')
        if category not in leaves:
            errors.append(f'{item_no} 分類不合法或不是小分類：{category}')
        if row.get('confidence') not in {'high', 'low'}:
            errors.append(f'{item_no} confidence 必須是 high 或 low')
        if row.get('basis') not in {'name', 'official'}:
            errors.append(f'{item_no} basis 必須是 name 或 official')
        try:
            if date.fromisoformat(row.get('checked', '')).isoformat() != row['checked']:
                raise ValueError
        except (ValueError, TypeError):
            errors.append(f'{item_no} checked 必須是 YYYY-MM-DD')
        counts[category] += 1
    observations = {r['item_no'] for r in read_csv('observations.csv', root) if r['item_no']}
    order = lambda values: sorted(values, key=lambda x: (len(x), x))
    warnings = []
    if observations - seen:
        warnings.append('缺分類：' + ', '.join(order(observations - seen)))
    if seen - observations:
        warnings.append('多餘商品番号：' + ', '.join(order(seen - observations)))
    totals = {}
    for c in categories:
        if c.get('special'):
            continue
        totals[c['id']] = counts[c['id']] if c.get('parent') else sum(
            counts[child['id']] for child in categories if child.get('parent') == c['id'])
    return {'errors': errors, 'warnings': warnings, 'counts': totals,
            'popular': popularity(preview, root)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preview', action='store_true', help='人氣清單含待查核商品，對應 PREVIEW=1')
    parser.add_argument('--json', action='store_true', help='輸出完整 JSON 檢查結果')
    args = parser.parse_args()
    try:
        result = check(preview=args.preview)
    except (OSError, ValueError, KeyError, TypeError, csv.Error) as error:
        print(f'錯誤：{error}', file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        for message in result['errors']:
            print('錯誤：' + message)
        for message in result['warnings']:
            print('警告：' + message)
        for category, count in result['counts'].items():
            print(f'{category}: {count}')
        print(f"高人氣商品（{'預覽' if args.preview else '正式'}）: {len(result['popular'])}")
        print(', '.join(p['item_no'] for p in result['popular']))
        if not result['errors'] and not result['warnings']:
            print('檢查通過：沒有錯誤，沒有缺分類或多餘商品番号。')
    return 1 if result['errors'] else 0


if __name__ == '__main__':
    sys.exit(main())
