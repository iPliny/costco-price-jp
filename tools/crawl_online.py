"""Fetch costco.co.jp online prices for the item numbers we track.

Read-only and gentle: one request every DELAY seconds, only for item numbers
already in data/observations.csv. Keeps prices (facts) only; never copies
Costco's photos, descriptions or reviews.

Usage: python3 tools/crawl_online.py [--debug ITEM ...]
Writes data/online_fetch.csv (one row per item per run) for review.
"""
import csv, html, json, re, sys, time, urllib.request, urllib.error
from datetime import datetime, timezone, timedelta

UA = "costco-price-jp research bot (+https://ipliny.github.io/costco-price-jp/)"
DELAY = 6
JST = timezone(timedelta(hours=9))


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ja"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.geturl(), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, url, ""


def ld_products(page):
    out = []
    for m in re.finditer(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', page, re.S):
        try:
            d = json.loads(html.unescape(m.group(1)))
        except ValueError:
            continue
        for x in d if isinstance(d, list) else [d]:
            if isinstance(x, dict) and x.get("@type") == "Product":
                out.append(x)
    return out


def parse(item, page):
    prods = [p for p in ld_products(page) if str(p.get("sku", "")).strip() == item] or ld_products(page)
    if not prods:
        return None
    p = prods[0]
    offers = p.get("offers") or {}
    if isinstance(offers, list):
        offers = offers[0] if offers else {}
    return {
        "name": p.get("name", ""),
        "sku": p.get("sku", ""),
        "price": offers.get("price", ""),
        "currency": offers.get("priceCurrency", ""),
        "availability": str(offers.get("availability", "")).rsplit("/", 1)[-1],
    }


def items_from_csv(path="data/observations.csv"):
    with open(path, encoding="utf-8") as f:
        return sorted({r["item_no"].strip() for r in csv.DictReader(f) if r["item_no"].strip()}, key=int)


def main(argv):
    debug = "--debug" in argv
    items = [a for a in argv if a.isdigit()] or items_from_csv()
    now = datetime.now(JST).strftime("%Y-%m-%d %H:%M")
    rows = []
    for i, item in enumerate(items):
        if i:
            time.sleep(DELAY)
        status, final_url, page = fetch(f"https://www.costco.co.jp/p/{item}")
        info = parse(item, page) if status == 200 else None
        row = {"item_no": item, "fetched_at": now, "http": status, "url": final_url, **(info or {})}
        rows.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
        if debug:
            print("  ld+json:", json.dumps(ld_products(page), ensure_ascii=False)[:1500])
            for kw in ["ld+json", '"price"', 'class="price-original', 'class="discount', 'you-pay', 'price-after', 'notranslate', 'out-of-stock', 'ng-state']:
                hits = [m for m in re.finditer(re.escape(kw), page) if "{" not in page[m.start() - 5:m.start()]]
                print(f"  [{kw}] x{len(hits)}")
                for m in hits[:3]:
                    frag = re.sub(r'_ngcontent-[\w-]+=""', "", page[max(0, m.start() - 200):m.start() + 700])
                    print("     ", re.sub(r"\s+", " ", frag))
    fields = ["item_no", "fetched_at", "http", "url", "sku", "name", "price", "currency", "availability"]
    with open("data/online_fetch.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    ok = sum(1 for r in rows if r.get("price") not in (None, ""))
    print(f"done: {ok}/{len(rows)} items have an online price")


if __name__ == "__main__":
    main(sys.argv[1:])
