import { loadProducts, yen, storeOrder, CRAWLED } from './data.js';
import { t, storeName, statusName, localePath, productName } from './i18n.js';

// 收藏頁用的商品資料（只在收藏頁讀取）：每個商品各店目前顯示的那一筆價格，與商品頁相同。
export function favoritesData(lang) {
  const s = t(lang);
  return loadProducts().map((p) => ({
    id: p.id,
    no: p.item_no,
    name: productName(lang, p),
    url: localePath(lang, `item/${p.id}/`),
    rows: [...p.current]
      .sort((a, b) => storeOrder(a.store, b.store))
      .map((o) => ({
        store: storeName(lang, o.store),
        price: yen(o.price) + (o.price_unit === '100g' ? s.per100g : ''),
        when: o.source_type === CRAWLED ? s.crawledOn(o.period_from, o.period_to) : s.period(o.period_from, o.period_to),
        status: statusName(lang, o.review_status),
        ok: o.review_status === '已查核',
      })),
  }));
}
