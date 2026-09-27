import fs from 'node:fs';
import path from 'node:path';

// 公開站輸出「已查核」與「待確認」（會標示）；PREVIEW=1 時連同待查核一起輸出，供內部預覽。
// 沒有 Costco 商品號的紀錄無法串連歷史，搜尋頁與商品頁（含預覽）都不顯示；
// 它們只以話題的身分出現在排名頁（loadReports）。
export const PREVIEW = process.env.PREVIEW === '1';
const PUBLISHABLE = new Set(['已查核', '待確認']);

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const num = (v) => (v === '' ? null : Number(v));

export const COMMUNITY = '社群回報';
export const ONLINE_STORE = '線上商店';
export const CRAWLED = '官網自動取得';

// 店別固定順序，線上商店放最後（大家都查得到）。
const STORE_ORDER = ['熊本御船倉庫店', '座間倉庫店', '新三郷倉庫店', '川崎倉庫店', '浜松倉庫店', ONLINE_STORE];
export function storeOrder(a, b) {
  const i = (st) => (STORE_ORDER.includes(st) ? STORE_ORDER.indexOf(st) : STORE_ORDER.length - 1);
  return i(a) - i(b) || a.localeCompare(b, 'ja');
}

// 官網同商品番号但規格不同的商品（data/online_match.csv 的 spec_diff，POYU 2026-09-27）不比價。
const SPEC_DIFF = (() => {
  const file = path.resolve('data/online_match.csv');
  if (!fs.existsSync(file)) return new Set();
  return new Set(parseCsv(fs.readFileSync(file, 'utf8')).filter((m) => m.verdict === 'spec_diff').map((m) => m.item_no));
})();

// 官網價格只是另一家店的價格。比較時用期間重疊的官網紀錄（同計價單位、取最新的一筆），
// 回傳「這家店比官網貴多少」（負數＝比較便宜）；沒有可比的官網紀錄時回傳 null。
export function onlineDiff(o, observations) {
  if (o.store === ONLINE_STORE || o.price == null || SPEC_DIFF.has(o.item_no)) return null;
  const overlaps = (a, b) => a.period_from && b.period_from && a.period_from <= (b.period_to || b.period_from) && b.period_from <= (a.period_to || a.period_from);
  const online = observations
    .filter((x) => x.store === ONLINE_STORE && x.price != null && x.price_unit === o.price_unit && overlaps(o, x))
    .sort((a, b) => (b.period_to || '').localeCompare(a.period_to || ''))[0];
  return online ? o.price - online.price : null;
}

function readObservations() {
  const file = path.resolve('data/observations.csv');
  return parseCsv(fs.readFileSync(file, 'utf8')).map((r) => ({
    ...r,
    price: num(r.price),
    list_price: num(r.list_price),
    discount: num(r.discount),
  }));
}

export function loadObservations() {
  return readObservations().filter((r) => r.item_no && (PREVIEW || PUBLISHABLE.has(r.review_status)));
}

// 排名頁引用的群組回報不需要商品號（只當作當下的回報，不進商品歷史）。
export function loadReports(ids) {
  const byId = new Map(readObservations().map((r) => [r.record_id, r]));
  return ids.map((id) => byId.get(id)).filter((r) => r && (PREVIEW || PUBLISHABLE.has(r.review_status)));
}

// 商品以 Costco 商品號歸戶。
export function productId(r) {
  return r.item_no;
}

// 官網的正式商品名稱（爬蟲寫入 data/product_names.csv）；英文名稱顯示在商品頁標題下方（POYU 2026-09-27，SEO 用）。
function loadOfficialNames() {
  const file = path.resolve('data/product_names.csv');
  if (!fs.existsSync(file)) return new Map();
  return new Map(parseCsv(fs.readFileSync(file, 'utf8')).map((r) => [r.item_no, r]));
}

export function loadProducts() {
  const official = loadOfficialNames();
  const byId = new Map();
  for (const r of loadObservations()) {
    const id = productId(r);
    if (!byId.has(id)) byId.set(id, { id, item_no: r.item_no, name: r.name, spec: r.spec, observations: [] });
    byId.get(id).observations.push(r);
  }
  const products = [...byId.values()];
  for (const p of products) {
    // 第一筆紀錄沒有商品名時，改用同商品其他紀錄的名稱（例如官網取得的正式名稱）；都沒有就留空，頁面改顯示商品番号。
    if (!p.name) p.name = p.observations.find((o) => o.name)?.name ?? '';
    if (!p.spec) p.spec = p.observations.find((o) => o.spec)?.spec ?? '';
    p.nameEn = official.get(p.item_no)?.name_en ?? '';
    p.stores = [...new Set(p.observations.map((o) => o.store))];
    // 社群回報只在商品沒有其他來源時才用來算價格區間。
    const checked = p.observations.filter((o) => o.source_type !== COMMUNITY);
    const basis = checked.length ? checked : p.observations;
    p.communityOnly = !checked.length;
    const unitPrices = basis.filter((o) => o.price_unit === '件').map((o) => o.price);
    const per100 = basis.filter((o) => o.price_unit === '100g').map((o) => o.price);
    p.minPrice = unitPrices.length ? Math.min(...unitPrices) : null;
    p.maxPrice = unitPrices.length ? Math.max(...unitPrices) : null;
    p.min100g = per100.length ? Math.min(...per100) : null;
    p.max100g = per100.length ? Math.max(...per100) : null;
    // 最新價格（給搜尋結果的描述用）：非社群回報中確認日最新的一筆，同一天依店別順序。
    p.latest = [...basis].filter((o) => o.price != null).sort((a, b) => (b.period_to || '').localeCompare(a.period_to || '') || storeOrder(a.store, b.store))[0] ?? null;
  }
  return products.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

export const yen = (n) => (n == null ? '—' : n.toLocaleString('ja-JP') + '円');

export function priceRange(lo, hi, suffix = '') {
  if (lo == null) return null;
  return lo === hi ? yen(lo) + suffix : `${yen(lo)}–${yen(hi)}${suffix}`;
}

// 每週熱度：以該週在各店聊天群組提到商品的不同人數排名（各店合計）。
// 只存統計數字與改寫過的匿名摘要，不存暱稱或原文。最新一週排在最後。
export function loadHeat() {
  const file = path.resolve('data/weekly_heat.json');
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8')).sort((a, b) => a.to.localeCompare(b.to));
}
