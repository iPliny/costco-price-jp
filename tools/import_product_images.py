#!/usr/bin/env python3
"""Import locally reviewed product illustrations. Requires Pillow; never runs in Pages builds."""
import argparse
import csv
from datetime import datetime
import hashlib
from io import BytesIO
from pathlib import Path
import re
from zoneinfo import ZoneInfo

from PIL import Image, ImageOps, ImageStat

ROOT = Path(__file__).resolve().parents[1]
FIELDS = ['item_no', 'file', 'og_file', 'source_name', 'source_sha256', 'added', 'alt_ja', 'alt_zh']
PUBLISHABLE = {'已查核', '待確認'}
KEEP_STORE_NAME = {'spec_diff', 'different_product', 'name_unconfirmed'}


def read_csv(name):
    file = ROOT / 'data' / name
    if not file.exists():
        return []
    with file.open(encoding='utf-8-sig', newline='') as stream:
        return [{k: (v or '').strip() for k, v in row.items()} for row in csv.DictReader(stream)]


def product_names():
    # Match loadProducts()/productName(): both site languages currently use p.name.
    names = {}
    for row in read_csv('observations.csv'):
        if row['item_no'] and row['review_status'] in PUBLISHABLE:
            names.setdefault(row['item_no'], row['name'])
            if not names[row['item_no']] and row['name']:
                names[row['item_no']] = row['name']
    official = {row['item_no']: row for row in read_csv('product_names.csv')}
    verdicts = {row['item_no']: row['verdict'] for row in read_csv('online_match.csv')}
    for item in names:
        name_ja = ' '.join(official.get(item, {}).get('name_ja', '').split())
        if name_ja and verdicts.get(item) not in KEEP_STORE_NAME:
            names[item] = name_ja
    return names, official


def background_color(image):
    w, h = image.size
    size = max(1, min(w, h) // 40)
    boxes = [(0, 0, size, size), (w-size, 0, w, size),
             (0, h-size, size, h), (w-size, h-size, w, h)]
    colors = [ImageStat.Stat(image.crop(box)).mean for box in boxes]
    return tuple(round(sum(c[i] for c in colors) / 4) for i in range(3))


def load_image(file):
    with Image.open(file) as original:
        rgba = ImageOps.exif_transpose(original).convert('RGBA')
        opaque = Image.new('RGB', rgba.size, (255, 255, 255))
        opaque.paste(rgba, mask=rgba.getchannel('A'))
    # Fresh RGB image drops all EXIF, ICC and text metadata.
    clean = Image.new('RGB', opaque.size)
    clean.paste(opaque)
    return clean


def encode(image, fmt, quality, target):
    for q in range(quality, 0, -5):
        stream = BytesIO()
        image.save(stream, format=fmt, quality=q, **({'method': 6} if fmt == 'WEBP' else {'optimize': True}))
        payload = stream.getvalue()
        if len(payload) <= target:
            return payload
    raise ValueError(f'{fmt} cannot meet {target} byte budget')


def convert(file):
    image = load_image(file)
    bg = background_color(image)
    square = Image.new('RGB', (640, 640), bg)
    resized = ImageOps.contain(image, (640, 640), Image.Resampling.LANCZOS)
    square.paste(resized, ((640-resized.width)//2, (640-resized.height)//2))
    og = Image.new('RGB', (1200, 630), bg)
    resized = ImageOps.contain(image, (1200, 630), Image.Resampling.LANCZOS)
    og.paste(resized, ((1200-resized.width)//2, (630-resized.height)//2))
    return encode(square, 'WEBP', 80, 80*1024), encode(og, 'JPEG', 85, 150*1024)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='Folder of visually reviewed illustrations only')
    args = parser.parse_args()
    if not args.source.is_dir():
        parser.error('Source must be an existing directory')
    names, official = product_names()
    rows = read_csv('product_images.csv')
    records = {r['item_no']: r for r in rows}
    if len(records) != len(rows):
        raise ValueError('Duplicate item_no in product_images.csv')
    candidates = [p for p in sorted(args.source.iterdir()) if p.is_file() and p.suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp'}]
    seen = set()
    for file in candidates:
        if re.fullmatch(r'[0-9]+', file.stem) and file.stem in seen:
            raise ValueError(f'Multiple sources for item {file.stem}; keep one reviewed source')
        seen.add(file.stem)
    changed = 0
    for file in candidates:
        item = file.stem
        if not re.fullmatch(r'[0-9]+', item) or item not in names:
            print(f'SKIP {file.name}: invalid item number or no publishable product page')
            continue
        sha = hashlib.sha256(file.read_bytes()).hexdigest()
        old = records.get(item, {})
        webp_file = f'product-images/{item}.webp'
        og_file = f'product-images/og/{item}.jpg'
        if old.get('source_sha256') == sha and all((ROOT/'public'/p).is_file() for p in [webp_file, og_file]):
            print(f'UNCHANGED {file.name}')
            continue
        webp, jpeg = convert(file)
        for relative, payload in [(webp_file, webp), (og_file, jpeg)]:
            destination = ROOT/'public'/relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(payload)
        name_ja = ' '.join(official.get(item, {}).get('name_ja', names[item]).split()) or names[item] or f'コストコ商品 {item}'
        records[item] = dict(item_no=item, file=webp_file, og_file=og_file,
                             source_name=file.name, source_sha256=sha,
                             added=old.get('added') or datetime.now(ZoneInfo('Asia/Tokyo')).date().isoformat(),
                             alt_ja=f'{name_ja}のイメージイラスト',
                             alt_zh=f'{names[item] or f"Costco 商品 {item}"}示意插畫')
        print(f'IMPORTED {file.name}: webp={len(webp)} bytes, jpg={len(jpeg)} bytes')
        changed += 1
    if changed:
        with (ROOT/'data/product_images.csv').open('w', encoding='utf-8', newline='') as stream:
            writer = csv.DictWriter(stream, FIELDS, lineterminator='\n')
            writer.writeheader()
            writer.writerows(records[item] for item in sorted(records, key=lambda n: (int(n), n)))
    print(f'{changed} image(s) imported')


if __name__ == '__main__':
    main()
