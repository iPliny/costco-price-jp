"""Fetch costco.co.jp online prices for products we already track in a warehouse.

Only item numbers that have at least one warehouse (non-online) record in
data/observations.csv are fetched: an online price is only useful here as a
comparison with a store price (POYU, 2026-09-26).

Gentle by design: one request per item, DELAY seconds apart, a User-Agent that
names this site. Only facts are kept (price, discount, discount dates); no
Costco photos or product copy.

Usage:
  python3 tools/crawl_online.py            # fetch, write data/online_fetch.csv
  python3 tools/crawl_online.py --apply    # also merge into data/observations.csv
  python3 tools/crawl_online.py --merge-only     # merge an existing data/online_fetch.csv
  python3 tools/crawl_online.py --debug 1492255   # print the raw price fields

The workflow fetches first and merges afterwards, against a freshly pulled main,
so a long run never overwrites rows other people committed meanwhile.
"""
import csv, json, sys, time, urllib.error, urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone

UA = "costco-price-jp research bot (+https://ipliny.github.io/costco-price-jp/)"
API = "https://www.costco.co.jp/rest/v2/japan/products/{}?fields=FULL&lang=ja&curr=JPY"
PAGE = "https://www.costco.co.jp/p/{}"
DELAY = 6
JST = timezone(timedelta(hours=9))
OBS = "data/observations.csv"
FETCH = "data/online_fetch.csv"
ONLINE_STORE = "線上商店"
SOURCE = "官網自動取得"
PUBLIC_STATUSES = {"已查核", "待確認"}
# Stop early rather than keep hitting the site if it starts refusing us.
MAX_CONSECUTIVE_ERRORS = 5
FETCH_COLS = ["item_no", "name", "official_name", "fetched_at", "http", "status", "price", "list_price", "discount",
              "promo_from", "promo_end", "variants", "stock", "url"]


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, None
    except (urllib.error.URLError, TimeoutError, ValueError):
        return 0, None


def yen(p):
    """Integer yen from an OCC price object like {"value": 3598.0}."""
    if isinstance(p, dict) and p.get("value") is not None:
        return int(round(float(p["value"])))
    return None


def parse(item, d):
    """Pick the price facts out of the product API response.

    price.value (or the range minimum) is what the site charges now, already net of any
    couponDiscount, so the regular online price is that plus discountValue.
    """
    if not d or str(d.get("code", "")) != item:
        return {"status": "not_online"}
    price = yen(d.get("price"))
    ptype = (d.get("price") or {}).get("priceType", "")
    rng = d.get("priceRange") or {}
    if price is None or ptype == "FROM":
        price = yen(rng.get("minPrice")) or price
    coupon = d.get("couponDiscount") or {}
    discount = int(round(float(coupon.get("discountValue") or 0)))
    stock = ((d.get("stock") or {}).get("stockLevelStatus") or "")
    return {
        "status": "ok" if price else "no_price",
        "official_name": (d.get("name") or "").strip(),
        "list_price": (price + discount) if price else "",
        "discount": discount or "",
        "price": price or "",
        "promo_from": (coupon.get("localDiscountStartDate") or "")[:10] if discount else "",
        "promo_end": (coupon.get("localDiscountEndDate") or "")[:10] if discount else "",
        "variants": "range" if ptype == "FROM" or rng.get("minPrice") else "",
        "stock": stock,
    }


def read_obs():
    with open(OBS, encoding="utf-8", newline="") as f:
        r = csv.DictReader(f)
        return r.fieldnames, list(r)


def tracked_items(rows):
    """Item numbers with at least one public warehouse record, and our own name for each.

    Rows still 待查核 are preview-only, so they don't count: otherwise an online
    price would put a product on the public site before its store price is checked.
    """
    names = {}
    for r in rows:
        if r["item_no"] and r["store"] != ONLINE_STORE and r["review_status"] in PUBLIC_STATUSES:
            names.setdefault(r["item_no"], Counter())[r["name"]] += 1
    return {k: v.most_common(1)[0][0] for k, v in sorted(names.items(), key=lambda kv: int(kv[0]))}


def apply(fields, rows, results, today):
    """Merge fetched prices: extend the latest online row if unchanged, else add one."""
    added = extended = 0
    for res in results:
        if res["status"] != "ok":
            continue
        item = res["item_no"]
        name = res.get("official_name") or res["name"]
        # The values this result would be stored as (list price only kept when discounted).
        facts = {"price": res["price"], "list_price": res["list_price"] if res["discount"] else "",
                 "discount": res["discount"], "promo_end": res["promo_end"]}
        mine = [r for r in rows if r["item_no"] == item and r["source_type"] == SOURCE]
        last = max(mine, key=lambda r: r["period_to"], default=None)
        same = last and all(str(last[k]) == str(v) for k, v in facts.items())
        if same:
            last["name"] = name
            if last["period_to"] < today:
                last["period_to"] = today
                extended += 1
            continue
        note, note_ja = "", ""
        if res["variants"]:
            note, note_ja = "有多個規格，記錄最低價", "複数の仕様があるため最安値を記録"
        rows.append({
            **{k: "" for k in fields},
            "record_id": f"ON-{item}-{today.replace('-', '')}",
            "store": ONLINE_STORE, "source_type": SOURCE, "item_no": item, "name": name,
            **facts, "price_unit": "件",
            "period_from": today, "period_to": today,
            "note": note, "note_ja": note_ja, "review_status": "已查核",
        })
        added += 1
    with open(OBS, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    return added, extended


def merge_only(today):
    fields, rows = read_obs()
    with open(FETCH, encoding="utf-8", newline="") as f:
        results = list(csv.DictReader(f))
    added, extended = apply(fields, rows, results, today)
    print(f"observations.csv: {added} rows added, {extended} extended")


def main(argv):
    today = datetime.now(JST).strftime("%Y-%m-%d")
    if "--merge-only" in argv:
        merge_only(today)
        return
    fields, rows = read_obs()
    items = tracked_items(rows)
    wanted = [a for a in argv if a.isdigit()]
    if wanted:
        items = {k: items.get(k, "") for k in wanted}
    now = datetime.now(JST)
    print(f"fetching {len(items)} items, {DELAY}s apart", flush=True)
    results, errors = [], 0
    for i, (item, name) in enumerate(items.items()):
        if i:
            time.sleep(DELAY)
        http, d = fetch_json(API.format(item))
        res = {"item_no": item, "name": name, "fetched_at": now.strftime("%Y-%m-%d %H:%M"),
               "http": http, "url": PAGE.format(item), **parse(item, d)}
        results.append(res)
        print(json.dumps(res, ensure_ascii=False), flush=True)
        if "--debug" in argv and d:
            keep = {k: d.get(k) for k in ("code", "price", "priceRange", "couponDiscount", "discountMessage",
                                          "stock", "purchasable", "as400Discount") if k in d}
            print("   raw:", json.dumps(keep, ensure_ascii=False)[:1500])
        errors = errors + 1 if http not in (200, 404) else 0
        if errors >= MAX_CONSECUTIVE_ERRORS:
            print(f"stopping early: {errors} errors in a row (last HTTP {http})", flush=True)
            break
    with open(FETCH, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FETCH_COLS, extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        w.writerows(results)
    ok = sum(r["status"] == "ok" for r in results)
    print(f"done: {ok}/{len(results)} fetched items have an online price ({len(items)} tracked)")
    if "--apply" in argv:
        added, extended = apply(fields, rows, results, today)
        print(f"observations.csv: {added} rows added, {extended} extended")
    # Fail loudly if the site changed shape or blocked us and nothing parses any more.
    if results and ok == 0:
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])
