import fs from 'node:fs';
import { parseCsv } from './data.js';

export const couponToday = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const date = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '') &&
  Number.isFinite(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const amount = (s) => s === '' ? null : (/^\d+$/.test(String(s)) && Number.isSafeInteger(Number(s)) ? Number(s) : NaN);
export function loadCoupons(file = 'data/coupons.csv') {
  return fs.existsSync(file) ? parseCsv(fs.readFileSync(file, 'utf8')) : [];
}

export function couponIssueDate(row) {
  const match = /\/upz\/(\d{2})(\d{2})(\d{2})_/.exec(row.source_url ?? '');
  const issue = match ? `20${match[1]}-${match[2]}-${match[3]}` :
    row.source === '官網' ? row.fetched_at?.slice(0, 10) : '';
  return date(issue) ? issue : null;
}

// An omitted start is unknown, never a fabricated publication/start date.
export function activeCoupons(rows, products, asOf = couponToday()) {
  if (!date(asOf)) return [];
  const byItem = new Map(products.filter((p) => p.item_no).map((p) => [p.item_no, p]));
  const best = new Map();
  for (const row of rows) {
    const issue = couponIssueDate(row);
    const unit = row.price_unit || '件'; // Older imports predate the optional unit column.
    if (!/^\d+$/.test(row.item_no ?? '') || !row.name_ja?.trim() ||
        !issue || issue > asOf || !['件', '100g'].includes(unit) ||
        !date(row.week_to) || row.week_to < asOf ||
        (row.week_from && (!date(row.week_from) || row.week_from > asOf || row.week_from > row.week_to)) ||
        !date(row.fetched_at?.slice(0, 10)) || row.fetched_at.slice(0, 10) > asOf ||
        !['倉庫店', 'オンライン'].includes(row.scope) || !['電子報', '官網'].includes(row.source)) continue;
    let url;
    try { url = new URL(row.source_url); } catch { continue; }
    if (url.protocol !== 'https:' || !['cds2.costcojapan.jp', 'www.costco.co.jp'].includes(url.hostname) || url.username || url.password || url.port) continue;
    const [discount, after, before] = ['discount_yen', 'price_after', 'price_before'].map((key) => amount(row[key]));
    if ([discount, after, before].some(Number.isNaN) || (discount == null && after == null) ||
        (discount != null && discount <= 0) ||
        (discount != null && after != null && before != null && before - after !== discount)) continue;
    const current = best.get(row.item_no);
    if (!current || issue > current.issue_date || (issue === current.issue_date && row.fetched_at > current.fetched_at)) best.set(row.item_no, {
      ...row, discount_yen: discount, price_after: after, price_before: before,
      price_unit: unit, issue_date: issue,
      product: byItem.get(row.item_no) ?? null,
    });
  }
  return [...best.values()].sort((a, b) => (b.discount_yen ?? -1) - (a.discount_yen ?? -1) ||
    a.item_no.localeCompare(b.item_no, 'en', { numeric: true }));
}

export function couponList(rows, lang, pageUrl, site) {
  return {
    '@context': 'https://schema.org', '@type': 'ItemList', '@id': `${pageUrl}#coupons`,
    name: lang === 'ja' ? '今週のクーポン対象商品・公式メルマガより' : '本週折價券商品・官方電子報',
    url: `${pageUrl}#coupons`, numberOfItems: rows.length,
    itemListElement: rows.map((row, i) => ({
      '@type': 'ListItem', position: i + 1, name: row.name_ja,
      ...(row.product ? { url: new URL(`${lang === 'ja' ? '' : 'zh-hant/'}item/${row.product.id}/`, site).href } : {}),
    })),
  };
}
