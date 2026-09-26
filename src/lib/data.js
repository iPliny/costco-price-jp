import fs from 'node:fs';
import path from 'node:path';

// 公開站輸出「已查核」與「待確認」（會標示）；PREVIEW=1 時連同待查核一起輸出，供內部預覽。
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

export function loadObservations() {
  const file = path.resolve('data/observations.csv');
  return parseCsv(fs.readFileSync(file, 'utf8'))
    .map((r) => ({
      ...r,
      price: num(r.price),
      list_price: num(r.list_price),
      discount: num(r.discount),
    }))
    .filter((r) => PREVIEW || PUBLISHABLE.has(r.review_status));
}

// 商品以 Costco 商品號歸戶；沒有商品號的紀錄以名稱暫時歸戶。
export function productId(r) {
  return r.item_no ? r.item_no : 'n-' + encodeURIComponent(r.name).replace(/%/g, '').slice(0, 40);
}

export function loadProducts() {
  const byId = new Map();
  for (const r of loadObservations()) {
    const id = productId(r);
    if (!byId.has(id)) byId.set(id, { id, item_no: r.item_no, name: r.name, spec: r.spec, observations: [] });
    byId.get(id).observations.push(r);
  }
  const products = [...byId.values()];
  for (const p of products) {
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
