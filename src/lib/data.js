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

const MATCH = (() => {
  const file = path.resolve('data/online_match.csv');
  if (!fs.existsSync(file)) return new Map();
  return new Map(parseCsv(fs.readFileSync(file, 'utf8')).map((m) => [m.item_no, m.verdict]));
})();
// 官網同商品番号但規格不同的商品（data/online_match.csv 的 spec_diff，POYU 2026-09-27）不比價。
const SPEC_DIFF = new Set([...MATCH].filter(([, v]) => v === 'spec_diff').map(([k]) => k));
// 商品頁標題用官網的日文正式名稱（POYU 2026-09-28，SEO：搜尋字多半是官網那種叫法）。
// 規格不同、不同商品、或名稱還沒確認是同一商品的，繼續用店頭品名。
const KEEP_STORE_NAME = new Set(['spec_diff', 'different_product', 'name_unconfirmed']);

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

// 一家店只顯示一個價格（POYU 2026-09-28）：每家店（含線上商店）取最後確認的一筆。
// 折扣已在確認期間內結束的紀錄，以折扣結束日當作它的日期；同一天時查核程度高、較晚加入的優先。
const STATUS_RANK = { 已查核: 3, 待確認: 2, 待查核: 1 };
const effectiveDate = (o) => (o.discount && o.promo_end && o.promo_end < (o.period_to || '') ? o.promo_end : o.period_to || '');
export function latestPerStore(observations) {
  const best = new Map();
  observations.forEach((o, i) => {
    const cur = best.get(o.store);
    const key = [effectiveDate(o), STATUS_RANK[o.review_status] ?? 0, i];
    if (!cur || key[0] > cur.key[0] || (key[0] === cur.key[0] && (key[1] > cur.key[1] || (key[1] === cur.key[1] && key[2] > cur.key[2])))) best.set(o.store, { o, key });
  });
  return [...best.values()].map((b) => b.o);
}

// 最近觀測沿用商品頁目前各店的一筆紀錄，避免入口和商品頁顯示不同價格。
// 日期只用觀測區間終點；補登、改名或優惠到期都不會變成新的觀測日。
const validObservationDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const japanToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const compareRecentObservations = (a, b) => b.period_to.localeCompare(a.period_to) ||
  (STATUS_RANK[b.review_status] ?? 0) - (STATUS_RANK[a.review_status] ?? 0) || storeOrder(a.store, b.store) ||
  (a.record_id || '').localeCompare(b.record_id || '', 'en', { numeric: true });

export function recentProducts(products, channel, { limit = 20, asOf = japanToday(), preview = PREVIEW } = {}) {
  if (!['store', 'online'].includes(channel) || !validObservationDate(asOf) || !Number.isInteger(limit) || limit <= 0) return [];
  const byItem = new Map();
  for (const product of products) {
    if (!product.item_no) continue;
    const observation = (product.current || []).filter((o) =>
      o.store && (channel === 'online' ? o.store === ONLINE_STORE : o.store !== ONLINE_STORE) &&
      (PUBLISHABLE.has(o.review_status) || (preview && o.review_status === '待查核')) &&
      o.price != null && Number.isFinite(o.price) && o.price >= 0 && ['件', '100g'].includes(o.price_unit) &&
      validObservationDate(o.period_from) && validObservationDate(o.period_to) &&
      o.period_from <= o.period_to && o.period_to <= asOf
    ).sort(compareRecentObservations)[0];
    if (!observation) continue;
    const current = byItem.get(product.item_no);
    if (!current || compareRecentObservations(observation, current.observation) < 0) byItem.set(product.item_no, { product, observation });
  }
  return [...byItem.values()].sort((a, b) => b.observation.period_to.localeCompare(a.observation.period_to) ||
    a.product.item_no.localeCompare(b.product.item_no, 'en', { numeric: true })).slice(0, limit);
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
  const categories = loadCategories();
  const assignments = loadProductCategories();
  const heat = loadHeat().slice(-4);
  const discussed = recentDiscussionItems();
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
    const nameJa = (official.get(p.item_no)?.name_ja ?? '').replace(/\s+/g, ' ').trim();
    if (nameJa && !KEEP_STORE_NAME.has(MATCH.get(p.item_no))) p.name = nameJa;
    // 搜尋框也要找得到店頭價牌上的叫法（例如「バスティッシュ」）。
    p.searchText = [...new Set([p.name, ...p.observations.map((o) => o.name)])].join(' ');
    p.category = assignments.get(p.item_no) ?? null;
    p.categoryTop = categories.find((c) => c.id === p.category)?.parent ?? null;
    p.popular = heat.some((week) => week.items.some((h) => matchesHeat(p, h))) || discussed.has(p.item_no);
    p.nameEn = official.get(p.item_no)?.name_en ?? '';
    // 官網有這個商品頁（爬蟲拿到名稱或價格）時，標題區也放一個官網連結。
    p.onOfficialSite = official.has(p.item_no) || p.observations.some((o) => o.source_type === CRAWLED);
    p.stores = [...new Set(p.observations.map((o) => o.store))];
    // 社群回報只在商品沒有其他來源時才用來算價格區間。
    p.current = latestPerStore(p.observations);
    const checked = p.current.filter((o) => o.source_type !== COMMUNITY);
    const basis = checked.length ? checked : p.current;
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

// 商品頁「過去の話題」：各店聊天群組裡提到這個商品的留言（POYU 2026-09-28）。
// 只存編的動物化名與改寫過的留言，不存暱稱或原文。最新的週在上，每個商品最多顯示 5 則。
export const DISCUSSION_LIMIT = 5;
let discussions;
export function discussionsFor(itemNo) {
  if (!discussions) {
    const file = path.resolve('data/item_discussions.json');
    discussions = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  }
  let left = DISCUSSION_LIMIT;
  return discussions
    .filter((d) => d.item_no === itemNo)
    .sort((a, b) => b.from.localeCompare(a.from))
    .map((d) => {
      const comments = d.comments.slice(0, left);
      left -= comments.length;
      return { ...d, comments };
    })
    .filter((d) => d.comments.length);
}

// 一般分類採人工維護；特別分類不寫入商品的 category 欄位。
export function loadCategories() {
  return JSON.parse(fs.readFileSync(path.resolve('data/categories.json'), 'utf8'));
}

function loadProductCategories() {
  const file = path.resolve('data/product_categories.csv');
  if (!fs.existsSync(file)) return new Map();
  const leaves = new Set(loadCategories().filter((c) => c.parent && !c.special).map((c) => c.id));
  return new Map(parseCsv(fs.readFileSync(file, 'utf8')).filter((r) => leaves.has(r.category)).map((r) => [r.item_no, r.category]));
}

// 保留首頁原來的子字串比對；排序和最近四週人氣共用同一規則。
// 熱度項目有 categories 時只比對這些小分類的商品（例如「米」不該命中米久フランク、純米大吟醸）。
export function matchesHeat(p, h) {
  if (h.categories?.length && !h.categories.includes(p.category)) return false;
  return `${p.searchText} ${p.item_no} ${p.spec}`.toLowerCase().includes(h.query.toLowerCase());
}

export function sortProducts(products) {
  const latest = loadHeat().at(-1);
  const heatRank = (p) => latest?.items.find((h) => matchesHeat(p, h))?.rank ?? Infinity;
  return [...products].sort((a, b) => heatRank(a) - heatRank(b) || b.observations.length - a.observations.length || a.name.localeCompare(b.name, 'ja'));
}

// 以資料最新週的 from 為基準，涵蓋該週及前三週；四週前的同日不納入。
export function recentDiscussionItems() {
  const file = path.resolve('data/item_discussions.json');
  const rows = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const latest = rows.reduce((date, row) => row.from > date ? row.from : date, '');
  if (!latest) return new Set();
  const cutoff = new Date(Date.parse(`${latest}T00:00:00Z`) - 28 * 86400000).toISOString().slice(0, 10);
  return new Set(rows.filter((r) => r.from > cutoff && r.from <= latest && r.comments?.length).map((r) => r.item_no));
}

export function inCategory(p, id) {
  return id === 'popular' ? p.popular : p.category === id || p.categoryTop === id;
}

export function populatedCategories(products = loadProducts()) {
  return loadCategories().filter((c) => products.some((p) => inCategory(p, c.id)));
}
