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
import csv, json, re, sys, time, unicodedata, urllib.error, urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone

UA = "costco-price-jp research bot (+https://ipliny.github.io/costco-price-jp/)"
API = "https://www.costco.co.jp/rest/v2/japan/products/{}?fields=FULL&lang=ja&curr=JPY"
PAGE = "https://www.costco.co.jp/p/{}"
DELAY = 6
JST = timezone(timedelta(hours=9))
OBS = "data/observations.csv"
FETCH = "data/online_fetch.csv"
# Reviewed matches between our store rows and the official product with the same item number.
# verdict: same (compare), spec_diff (show the online row, don't compare),
# different_product (the number is another product online: no online row at all).
MATCH = "data/online_match.csv"
MATCH_COLS = ["item_no", "verdict", "store_name", "official_name", "reason", "checked"]
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


def warehouse_only(d):
    decals = [((x.get("value") or {}).get("url") or "") + ((x.get("value") or {}).get("altText") or "")
              for x in d.get("decalData") or []]
    return any("WarehouseOnly" in t or "倉庫店限定" in t for t in decals)


def parse(item, d):
    """Pick the price facts out of the product API response.

    price.value (or the range minimum) is what the site charges now, already net of any
    couponDiscount, so the regular online price is that plus discountValue.
    """
    if not d or str(d.get("code", "")) != item:
        return {"status": "not_online"}
    # Warehouse-only products (decal 倉庫店限定商品) still carry a price in the API,
    # but costco.co.jp shows none and doesn't sell them online (POYU, 2026-09-26: 96069).
    # hidePriceValue means the same: the page shows no price.
    if warehouse_only(d):
        return {"status": "warehouse_only", "official_name": (d.get("name") or "").strip()}
    if d.get("hidePriceValue"):
        return {"status": "price_hidden", "official_name": (d.get("name") or "").strip()}
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


UNITS = {"ml": ("ml", 1), "l": ("ml", 1000), "g": ("g", 1), "kg": ("g", 1000), "缶": ("本", 1)}
QTY = re.compile(r"(\d+(?:\.\d+)?)\s*(ml|kg|l|g|本|個|袋|枚|包|食|粒|錠|ロール|缶|足|合|インチ)(?![a-z])(?:\s*[x×]\s*(\d+))?")


def quantities(text):
    """Pack sizes named in a product name, e.g. {"ml": {500.0, 12000.0}} for "500ml x 24"."""
    text = unicodedata.normalize("NFKC", text or "").lower().replace("㎏", "kg")
    out = {}
    for n, u, times in QTY.findall(text):
        key, mult = UNITS.get(u, (u, 1))
        vals = out.setdefault(key, set())
        vals.add(round(float(n) * mult, 1))
        if times:
            vals.add(round(float(n) * mult * int(times), 1))
    return out


def spec_conflict(store_text, official):
    """A unit both names mention with no size in common, e.g. 2個 vs 6個."""
    a, b = quantities(store_text), quantities(official)
    for key in a.keys() & b.keys():
        if not a[key] & b[key]:
            return f"{key}: 店頭 {sorted(a[key])} / 官網 {sorted(b[key])}"
    return None


def read_match():
    try:
        with open(MATCH, encoding="utf-8", newline="") as f:
            return {r["item_no"]: r for r in csv.DictReader(f)}
    except FileNotFoundError:
        return {}


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
    skip = {k for k, m in read_match().items() if m["verdict"] == "different_product"}
    for r in rows:
        if r["item_no"] in skip:
            continue
        if r["item_no"] and r["store"] != ONLINE_STORE and r["review_status"] in PUBLIC_STATUSES:
            names.setdefault(r["item_no"], Counter())[r["name"]] += 1
    return {k: v.most_common(1)[0][0] for k, v in sorted(names.items(), key=lambda kv: int(kv[0]))}


def apply(fields, rows, results, today):
    """Merge fetched prices: extend the latest online row if unchanged, else add one."""
    added = extended = 0
    match = read_match()
    # An item number that is another product online never gets an online row.
    wrong = {k for k, m in match.items() if m["verdict"] == "different_product"}
    rows[:] = [r for r in rows if not (r["source_type"] == SOURCE and r["item_no"] in wrong)]
    flag_spec_conflicts(rows, results, match)
    for r in rows:
        if r["source_type"] == SOURCE:
            mark_spec(r, match.get(r["item_no"]))
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
            note, note_ja = VARIANT_NOTE
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


def flag_spec_conflicts(rows, results, match):
    """Mark new items whose pack sizes differ from our store rows as spec_diff, for a person to confirm."""
    new = []
    for res in results:
        item, official = res["item_no"], res.get("official_name") or ""
        if res["status"] != "ok" or not official or item in match:
            continue
        store = [r for r in rows if r["item_no"] == item and r["store"] != ONLINE_STORE]
        text = " ".join(sorted({f"{r['name']} {r['spec']}" for r in store}))
        why = spec_conflict(text, official)
        if why:
            name = Counter(r["name"] for r in store).most_common(1)[0][0] if store else ""
            match[item] = {"item_no": item, "verdict": "spec_diff", "store_name": name, "official_name": official,
                           "reason": f"自動判斷規格不同（{why}）", "checked": "自動，待人工確認"}
            new.append(item)
    if new:
        print(f"spec_diff (auto): {', '.join(new)}")
        with open(MATCH, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=MATCH_COLS, lineterminator="\n")
            w.writeheader()
            w.writerows(sorted(match.values(), key=lambda m: int(m["item_no"])))


SPEC_NOTE = ("官網規格與店頭不同，不比價", "店頭と仕様が異なるため、比較していません")
VARIANT_NOTE = ("有多個規格，記錄最低價", "複数の仕様があるため最安値を記録")


def mark_spec(row, m):
    """Online rows of a spec_diff item show the official pack in spec and say they aren't compared."""
    if m and m["verdict"] == "spec_diff":
        row["spec"] = m["official_name"] or row["spec"]
        row["note"], row["note_ja"] = SPEC_NOTE
    elif (row["note"], row["note_ja"]) == SPEC_NOTE:
        row["spec"], row["note"], row["note_ja"] = "", "", ""


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
            keep = {k: d.get(k) for k in ("code", "price", "decalData", "priceRange", "couponDiscount", "discountMessage",
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
