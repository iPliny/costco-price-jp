#!/usr/bin/env python3
"""價格資料品質檢查：只找問題、不改資料；僅用 Python 標準庫。"""
import argparse
from collections import Counter, defaultdict
import csv
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from itertools import combinations
from pathlib import Path
import re
import sys
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
PRICE_RATIO_THRESHOLD = 2
PRICE_CHANGE_THRESHOLD = Decimal('0.40')
ONLINE_STORE = '線上商店'
# 新增店別時須與 src/lib/data.js 的 STORE_ORDER 同步。
STORES = {'熊本御船倉庫店', '座間倉庫店', '新三郷倉庫店', '川崎倉庫店',
          '浜松倉庫店', '入間倉庫店', ONLINE_STORE}
STATUSES = {'已查核', '待確認', '待查核'}
STATUS_RANK = {'已查核': 3, '待確認': 2, '待查核': 1}
FIELDS = ['record_id', 'store', 'source_type', 'item_no', 'name', 'spec', 'price',
          'price_unit', 'list_price', 'discount', 'promo_end', 'period_from',
          'period_to', 'evidence_sha256', 'evidence_image', 'note', 'note_ja', 'review_status']
REPORT_FIELDS = ['level', 'rule', 'record_id', 'store', 'item_no', 'name', 'price',
                 'price_unit', 'period_from', 'period_to', 'review_status', 'detail']
RULES = [f'E{i}' for i in range(1, 9)] + [f'W{i}' for i in range(1, 10)]
UNCERTAINTY = ('要確認', '未確認', '不明', '待確認', '?', '？')
# 2026-10-18：首次 main 掃描有 1 筆既存 promo_end 用斜線日期格式。
# 依任務要求整條 E6 暫降 warning，等人工查核修正舊資料後移除此例外。
# 因此期間顛倒／未來日期等新的 E6 也暫不阻擋 CI，仍完整列入報告。
DOWNGRADED_RULES = {'E6': '2026-10-18 初次 main 有既存 promo_end 斜線日期，待人工查核後恢復 error'}


def japan_today():
    return datetime.now(timezone(timedelta(hours=9))).date()


def parse_date(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def integer(value):
    return int(value) if isinstance(value, str) and re.fullmatch(r'[0-9]+', value) else None


def normalized_name(value):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', value).casefold())


def trigrams(value):
    return {value[i:i + 3] for i in range(len(value) - 2)}


def finding(rule, row, detail, downgrades):
    level = 'warning' if rule.startswith('W') or rule in downgrades else 'error'
    if rule in downgrades:
        detail = f'原為 error；暫降 warning：{downgrades[rule]}；{detail}'
    return dict(level=level, rule=rule, **{k: row.get(k, '') for k in REPORT_FIELDS[2:-1]}, detail=detail)


def latest_key(row):
    # 與網站 latestPerStore 一致：已結束折扣用截止日；同日依查核程度及原列順序。
    effective = row['period_to']
    if row['discount'] and parse_date(row['promo_end']) and row['promo_end'] < effective:
        effective = row['promo_end']
    return effective, STATUS_RANK.get(row['review_status'], 0), row['_line']


def check_rows(rows, categories, official_names, as_of, downgrades=None):
    """純資料檢查；測試可明確傳入空的 downgrades 以驗證原始嚴重程度。"""
    downgrades = DOWNGRADED_RULES if downgrades is None else downgrades
    findings = []
    rows = [{k: str(r.get(k, '') or '').strip() for k in FIELDS} | {'_line': i}
            for i, r in enumerate(rows, 2)]
    seen = Counter(r['record_id'] for r in rows)

    def emit(rule, row, detail):
        findings.append(finding(rule, row, f"CSV 第 {row['_line']} 列；{detail}", downgrades))

    eligible = []
    for r in rows:
        price, regular = integer(r['price']), integer(r['list_price'])
        start, end, promo = (parse_date(r[k]) for k in ('period_from', 'period_to', 'promo_end'))
        if not r['record_id'] or seen[r['record_id']] > 1:
            emit('E2', r, 'record_id 空白' if not r['record_id'] else f"record_id 重複 {seen[r['record_id']]} 筆")
        if r['review_status'] not in STATUSES:
            emit('E3', r, 'review_status 不在允許清單')
        if r['store'] not in STORES:
            emit('E4', r, 'store 不在已知 6 家倉庫店及線上商店清單')
        issues = []
        if r['price'] and (price is None or price <= 0):
            issues.append('price 有值但不是正整數')
        if r['price_unit'] not in {'件', '100g'}:
            issues.append('price_unit 必須是 件 或 100g')
        if issues:
            emit('E5', r, '；'.join(issues))
        issues = []
        if not start or not end:
            issues.append('period_from／period_to 必須是有效 YYYY-MM-DD')
        if r['promo_end'] and not promo:
            issues.append('promo_end 有值時必須是有效 YYYY-MM-DD')
        if start and end and start > end:
            issues.append('period_from 晚於 period_to')
        if end and end > as_of:
            issues.append(f'period_to 晚於 as-of {as_of}')
        if issues:
            emit('E6', r, '；'.join(issues))
        if r['item_no'] and not re.fullmatch(r'[0-9]+', r['item_no']):
            emit('E7', r, 'item_no 有值但不是 ASCII 純數字')
        if r['list_price'] and (regular is None or price is None or price <= 0 or regular <= price):
            emit('E8', r, 'list_price 必須是可與有效 price 比較且嚴格大於 price 的整數')
        if bool(r['note']) != bool(r['note_ja']):
            emit('W4', r, 'note 與 note_ja 只填一邊')
        if r['item_no'] and r['item_no'] not in categories:
            emit('W5', r, 'item_no 未列於 product_categories.csv')
        issues = []
        if r['discount'] and (integer(r['discount']) is None or regular is None or price is None or
                              integer(r['discount']) != regular - price):
            issues.append('discount 不等於 list_price − price，或缺少可計算的整數欄位')
        if promo and start and promo < start:
            issues.append('promo_end 早於 period_from')
        if issues:
            emit('W6', r, '；'.join(issues))
        if r['review_status'] == '已查核' and any(s in r['note'] or s in r['note_ja'] for s in UNCERTAINTY):
            emit('W7', r, '已查核備註仍含不確定用語或問號')
        if (r['item_no'] and re.fullmatch(r'[0-9]+', r['item_no']) and r['store'] in STORES and
                price is not None and price > 0 and r['price_unit'] in {'件', '100g'} and
                start and end and start <= end <= as_of and r['review_status'] in STATUSES):
            eligible.append(r)

    by_store = defaultdict(list)
    for r in eligible:
        by_store[r['store'], r['item_no'], r['price_unit']].append(r)
    latest = {key: max(group, key=latest_key) for key, group in by_store.items()}
    by_product = defaultdict(list)
    for (store, item, unit), r in latest.items():
        if store != ONLINE_STORE:
            by_product[item, unit].append(r)
    for (item, unit), group in sorted(by_product.items()):
        prices = [integer(r['price']) for r in group]
        if max(prices) > min(prices) * PRICE_RATIO_THRESHOLD:
            detail = '同商品同單位實體店最新價格最高／最低超過 {} 倍：{}'.format(
                PRICE_RATIO_THRESHOLD, '、'.join(f"{r['store']}={r['price']}（{r['record_id']}）" for r in group))
            for r in group:
                emit('W1', r, detail)

    for key, group in sorted(by_store.items()):
        by_date = defaultdict(list)
        for r in group:
            by_date[r['period_to']].append(r)
        previous = None
        for end in sorted(by_date):
            for r in by_date[end]:
                if previous is not None and not r['list_price']:
                    old, new = integer(previous['price']), integer(r['price'])
                    if Decimal(abs(new - old)) > Decimal(old) * PRICE_CHANGE_THRESHOLD:
                        emit('W2', r, f"比嚴格較早的上一筆 {previous['record_id']}（{previous['period_to']}、{old}）變動 "
                             f"{Decimal(new - old) / Decimal(old):+.2%}，且無 list_price")
            previous = max(by_date[end], key=lambda r: (STATUS_RANK.get(r['review_status'], 0), r['_line']))

    for r in eligible:
        if r['store'] == ONLINE_STORE:
            continue
        official = latest.get((ONLINE_STORE, r['item_no'], r['price_unit']))
        if official:
            a, b = integer(r['price']), integer(official['price'])
            if max(a, b) > min(a, b) * PRICE_RATIO_THRESHOLD:
                emit('W3', r, f"與線上商店最新同單位紀錄 {official['record_id']}（{official['period_to']}、{b}）相差超過 {PRICE_RATIO_THRESHOLD} 倍；非同日比較，須核對規格與期間")

    names = defaultdict(lambda: defaultdict(list))
    duplicates = defaultdict(list)
    for r in rows:
        if not r['item_no']:
            continue
        name = official_names.get(r['item_no'], r['name']) if r['store'] == ONLINE_STORE else r['name']
        name = normalized_name(name)
        if name:
            names[r['item_no']][name].append(r)
        if r['price']:
            key = tuple(r[k] for k in ('store', 'item_no', 'price', 'period_from', 'period_to'))
            duplicates[key].append(r)
    for item, variants in sorted(names.items()):
        conflicts = defaultdict(set)
        triples = {name: trigrams(name) for name in variants}
        for a, b in combinations(sorted(variants), 2):
            if not triples[a].intersection(triples[b]):
                conflicts[a].add(b)
                conflicts[b].add(a)
        for name, others in sorted(conflicts.items()):
            # 同一規則每列最多一筆；保留對照紀錄 ID，方便私有報告回查。
            other_ids = sorted({r['record_id'] for other in others for r in variants[other]})
            for r in variants[name]:
                emit('W8', r, '正規化名稱與下列紀錄無共同 3 字片段（線上商店優先用正式名稱）：' + '、'.join(other_ids))
    for group in duplicates.values():
        if len(group) > 1:
            for r in group:
                emit('W9', r, '同店／商品／價格／期間重複；候選紀錄：' + '、'.join(x['record_id'] for x in group))
    return sorted(findings, key=lambda f: (RULES.index(f['rule']), f['record_id'], f['detail']))


def read_table(file, expected=None):
    with Path(file).open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream, strict=True)
        if expected is not None and reader.fieldnames != expected:
            raise ValueError('CSV 表頭必須依序為：' + ','.join(expected))
        if reader.fieldnames is None or len(set(reader.fieldnames)) != len(reader.fieldnames):
            raise ValueError('CSV 表頭空白或重複')
        rows = []
        for row in reader:
            if None in row or any(v is None for v in row.values()):
                raise ValueError(f'CSV 第 {reader.line_num} 列欄位數不符')
            rows.append(row)
        return rows


def check(csv_path, as_of, downgrades=None):
    downgrades = DOWNGRADED_RULES if downgrades is None else downgrades
    try:
        rows = read_table(csv_path, FIELDS)
        # 跟隨 --csv 所在資料夾；假資料測試不會讀取 repo 的真實資料。
        parent = Path(csv_path).parent
        category_rows = read_table(parent / 'product_categories.csv',
                                  ['item_no', 'category', 'confidence', 'basis', 'checked'])
        name_rows = read_table(parent / 'product_names.csv', ['item_no', 'name_ja', 'name_en', 'checked'])
        categories = {r['item_no'].strip() for r in category_rows}
        official_names = {r['item_no'].strip(): r['name_ja'].strip() for r in name_rows if r['name_ja'].strip()}
        return check_rows(rows, categories, official_names, as_of, downgrades)
    except (OSError, UnicodeError, csv.Error, ValueError) as error:
        return [finding('E1', {}, f'檔案無法解析或表頭錯誤：{error}', downgrades)]


def write_reports(folder, findings):
    folder.mkdir(parents=True, exist_ok=True)
    for level, name in [('error', 'errors.csv'), ('warning', 'warnings.csv')]:
        with (folder / name).open('w', encoding='utf-8-sig', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=REPORT_FIELDS)
            writer.writeheader()
            writer.writerows(f for f in findings if f['level'] == level)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv', type=Path, default=ROOT / 'data/observations.csv')
    parser.add_argument('--as-of', type=parse_date, default=japan_today(), metavar='YYYY-MM-DD')
    parser.add_argument('--report', type=Path, metavar='輸出資料夾')
    args = parser.parse_args(argv)
    if args.as_of is None:
        parser.error('--as-of 必須是有效 YYYY-MM-DD')
    findings = check(args.csv, args.as_of)
    counts = Counter((f['rule'], f['level']) for f in findings)
    for rule in RULES:
        print(f"{rule}: error={counts[rule, 'error']} warning={counts[rule, 'warning']}")
    errors = sum(f['level'] == 'error' for f in findings)
    print(f'TOTAL: error={errors} warning={len(findings) - errors}')
    if args.report:
        try:
            if args.csv.resolve() in {(args.report / name).resolve() for name in ('errors.csv', 'warnings.csv')}:
                print('報告輸出不得覆寫 --csv 輸入檔', file=sys.stderr)
                return 1
            write_reports(args.report, findings)
        except OSError as error:
            print(f'無法輸出報告：{error}', file=sys.stderr)
            return 1
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
