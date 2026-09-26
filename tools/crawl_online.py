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
            if isinstance(x, dict) and str(x.get("@type", "")).lower() == "product":
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
            m = re.search(r'<script id="storefront-state" type="application/json">(.*?)</script>', page, re.S)
            if m:
                state = json.loads(html.unescape(m.group(1)))
                def walk(o, path=""):
                    if isinstance(o, dict):
                        for k, v in o.items():
                            walk(v, f"{path}.{k}")
                    elif isinstance(o, list):
                        for i, v in enumerate(o[:5]):
                            walk(v, f"{path}[{i}]")
                    elif re.search(r"(?i)discount|coupon|price|promo|valid|stock", path):
                        print("   state", path[-140:], "=", str(o)[:120])
                walk(state)
            time.sleep(DELAY)
            st, _, api = fetch(f"https://www.costco.co.jp/rest/v2/japan/products/{item}?fields=FULL&lang=ja&curr=JPY")
            print("   occ api", st, re.sub(r"\s+", " ", api)[:200])
            for kw in ["discount", "coupon", "price"]:
                for mm in list(re.finditer(kw, api, re.I))[:4]:
                    print(f"   api[{kw}]", api[max(0, mm.start() - 60):mm.start() + 160])
    fields = ["item_no", "fetched_at", "http", "url", "sku", "name", "price", "currency", "availability"]
    with open("data/online_fetch.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    ok = sum(1 for r in rows if r.get("price") not in (None, ""))
    print(f"done: {ok}/{len(rows)} items have an online price")


if __name__ == "__main__":
    main(sys.argv[1:])
