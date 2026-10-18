import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyDeals, priceRecords, ONLINE_STORE, COMMUNITY } from '../src/lib/data.js';
import { activeCoupons, couponList, loadCoupons } from '../src/lib/coupons.js';
import { t } from '../src/lib/i18n.js';

const asOf = '2026-10-15';
const row = (overrides = {}) => ({ item_no: '1', record_id: 'r1', store: '熊本御船倉庫店',
  price: 800, list_price: 1000, discount: 200, price_unit: '件', review_status: '已查核',
  source_type: '門市價牌', period_from: '2026-10-14', period_to: '2026-10-14', ...overrides });
const product = (item_no, observations) => ({ id: item_no, item_no, name: `商品${item_no}`, observations });
const p = (observations) => product('1', observations);
const run = (products, options = {}) => weeklyDeals(products, { asOf, preview: false, ...options });
const ids = (cards) => cards.map((c) => c.product.item_no);
const recordIds = (cards) => cards.flatMap((c) => c.records.map((r) => r.observation.record_id));

test('week is seven inclusive days anchored to latest eligible store observation, independent of online', () => {
  const result = run([p([row(), row({ store: '座間倉庫店', record_id: 'day6', period_from: '2026-10-08', period_to: '2026-10-08' }),
    row({ store: '新三郷倉庫店', record_id: 'day7', period_from: '2026-10-07', period_to: '2026-10-07' }),
    row({ store: ONLINE_STORE, period_from: asOf, period_to: asOf })])]);
  assert.equal(result.anchor, '2026-10-14');
  assert.equal(result.from, '2026-10-08');
  assert.deepEqual(recordIds(result.storeSales), ['r1', 'day6']);
  assert.equal(result.updated, asOf);
});

test('future, malformed, reversed dates, invalid prices and units cannot affect anchor or lists', () => {
  const bad = [
    { period_to: '2026-10-16' }, { period_from: '2026-10-15' }, { period_to: '2026-02-30' },
    { period_to: '' }, { period_from: 'bad' }, { price: NaN }, { price: null }, { price: '800' },
    { price: Infinity }, { price: -1 }, { price_unit: 'kg' }, { store: '' },
  ];
  for (const overrides of bad) assert.equal(run([p([row(overrides)])]).storeSales.length, 0);
  assert.equal(run([p([row()])], { asOf: 'bad' }).anchor, null);
});

test('no item number and community reports are excluded even in preview', () => {
  const result = run([product('', [row({ item_no: '' })]), p([row({ source_type: COMMUNITY })])], { preview: true });
  assert.equal(result.storeSales.length, 0);
  assert.equal(result.anchor, null);
});

test('public statuses reuse existing policy; unreviewed appears only in preview', () => {
  assert.equal(run([p([row({ review_status: '待確認' })])]).storeSales.length, 1);
  assert.equal(run([p([row({ review_status: '待查核' })])]).storeSales.length, 0);
  assert.equal(run([p([row({ review_status: '待查核' })])], { preview: true }).storeSales.length, 1);
  assert.equal(run([p([row({ review_status: '不可公開' })])], { preview: true }).storeSales.length, 0);
});

test('ended store sales move to collapsed list; end date equal to asOf remains active', () => {
  const result = run([p([row({ promo_end: '2026-10-14' }), row({ store: '座間倉庫店', promo_end: asOf })])]);
  assert.equal(result.storeSales[0].records[0].observation.store, '座間倉庫店');
  assert.equal(result.endedSales[0].records[0].observation.store, '熊本御船倉庫店');
});

test('a sale requires a valid regular price higher than the observed price', () => {
  for (const list_price of [800, 700, null, NaN, Infinity, '1000']) {
    assert.equal(run([p([row({ list_price })])]).storeSales.length, 0);
  }
  assert.equal(run([p([row({ discount: null })])]).storeSales.length, 1);
});

test('one sale per product and store: latest date, status rank, then record id', () => {
  const result = run([p([row({ record_id: 'r9', period_from: '2026-10-13', period_to: '2026-10-13' }),
    row({ record_id: 'r0', review_status: '待確認' }), row({ record_id: 'r2' }), row({ record_id: 'r1' })])]);
  assert.deepEqual(recordIds(result.storeSales), ['r1']);
});

test('online sales require an observation in last two days, never enter store sales or drops', () => {
  const result = run([p([row({ store: ONLINE_STORE, period_from: '2026-10-13', period_to: '2026-10-13' }),
    row({ store: ONLINE_STORE, record_id: 'online', period_from: asOf, period_to: asOf })]),
    product('2', [row({ item_no: '2', store: ONLINE_STORE, period_from: '2026-10-13', period_to: '2026-10-13' })])]);
  assert.deepEqual(ids(result.onlineSales), ['1']);
  assert.equal(result.storeSales.length, 0);
  assert.equal(result.priceDrops.length, 0);
  assert.equal(result.anchor, null);
  assert.equal(result.updated, asOf);
  assert.equal(run([p([row({ store: ONLINE_STORE })])]).onlineSales.length, 1);
});

test('drops require same store and unit, and previous end strictly before current start', () => {
  const current = row({ list_price: null, discount: null, period_from: '2026-10-12' });
  const earlier = row({ record_id: 'previous', price: 1000, list_price: null, discount: null,
    period_from: '2026-10-10', period_to: '2026-10-10' });
  const result = run([p([current, earlier])]);
  assert.equal(result.priceDrops[0].records[0].previous.record_id, 'previous');
  assert.equal(result.priceDrops[0].reduction, 200);
  for (const overrides of [{ store: '座間倉庫店' }, { price_unit: '100g' }, { period_to: '2026-10-12' }, { price: 800 }]) {
    assert.equal(run([p([current, { ...earlier, ...overrides }])]).priceDrops.length, 0);
  }
});

test('drops use latest eligible current record and closest nonoverlapping previous, not highest price', () => {
  const result = run([p([
    row({ list_price: null, discount: null, period_from: '2026-10-12' }),
    row({ record_id: 'old-high', price: 2000, list_price: null, period_from: '2026-10-01', period_to: '2026-10-01' }),
    row({ record_id: 'closest', price: 700, list_price: null, period_from: '2026-10-10', period_to: '2026-10-10' }),
  ])]);
  assert.equal(result.priceDrops.length, 0);
});

test('active store sale pair is not repeated in drops; other stores of that item may drop', () => {
  const result = run([p([row(), row({ price: 1200, record_id: 'old', period_from: '2026-10-01', period_to: '2026-10-01' }),
    row({ store: '座間倉庫店', record_id: 'drop', list_price: null, discount: null }),
    row({ store: '座間倉庫店', record_id: 'old-zama', price: 1200, period_from: '2026-10-01', period_to: '2026-10-01' })])]);
  assert.deepEqual(recordIds(result.priceDrops), ['drop']);
});

test('sale cards group stores and sort by max reduction, its rate, then numeric item number', () => {
  const products = [product('10', [row({ item_no: '10' })]), product('2', [row({ item_no: '2' })]),
    product('3', [row({ item_no: '3', price: 300, list_price: 500 })]),
    product('4', [row({ item_no: '4' }), row({ item_no: '4', store: '座間倉庫店', price: 700 })])];
  const before = structuredClone(products);
  const result = run(products);
  assert.deepEqual(ids(result.storeSales), ['4', '3', '2', '10']);
  assert.equal(result.storeSales[0].records.length, 2);
  assert.deepEqual(products, before);
  const onlineProducts = products.map((product) => ({ ...product, observations: [
    { ...product.observations.reduce((best, o) => o.price < best.price ? o : best), store: ONLINE_STORE },
  ] }));
  assert.deepEqual(ids(run(onlineProducts).onlineSales), ['4', '3', '2', '10']);
});

test('drop cards sort by reduction then item number, without rate tie break', () => {
  const result = run(['10', '2', '3'].map((id) => product(id, [row({ item_no: id, price: id === '3' ? 500 : 800, list_price: null }),
    row({ item_no: id, price: 1000, list_price: null, period_from: '2026-10-01', period_to: '2026-10-01' })])));
  assert.deepEqual(ids(result.priceDrops), ['3', '2', '10']);
});

test('no qualifying deals uses anchor as updated, and empty inputs have no fabricated date', () => {
  assert.equal(run([p([row({ list_price: null, discount: null })])]).updated, '2026-10-14');
  assert.equal(run([]).updated, null);
});

test('priceRecords preserves all public sources and sorts by date, store order, record id', () => {
  const observations = [row({ record_id: 'r2' }), row({ record_id: 'r1', source_type: COMMUNITY }),
    row({ record_id: 'online', store: ONLINE_STORE, review_status: '待確認' }),
    row({ record_id: 'older', period_to: '2026-10-01' }), row({ record_id: 'hidden', review_status: '待查核' }),
    row({ record_id: 'unknown', review_status: '不可公開' }), row({ record_id: 'missing', item_no: '' })];
  const before = structuredClone(observations);
  assert.deepEqual(priceRecords(p(observations), { preview: false }).map((o) => o.record_id), ['r1', 'r2', 'online', 'older']);
  assert.equal(priceRecords(p(observations), { preview: true }).length, 5);
  assert.deepEqual(observations, before);
});

test('caller hides priceRecords when all records have only one distinct observation end date', () => {
  const records = priceRecords(p([row(), row({ store: ONLINE_STORE })]), { preview: false });
  assert.equal(new Set(records.map((o) => o.period_to)).size >= 2, false);
  const withOlder = priceRecords(p([...records, row({ period_to: '2026-10-01' })]), { preview: false });
  assert.equal(new Set(withOlder.map((o) => o.period_to)).size >= 2, true);
});

test('ended store sale pair is not listed as a drop', () => {
  const result = run([p([row({ promo_end: '2026-10-12' }),
    row({ price: 1000, list_price: null, discount: null, record_id: 'old', period_from: '2026-10-01', period_to: '2026-10-01' })])]);
  assert.deepEqual(recordIds(result.endedSales), ['r1']);
  assert.equal(result.priceDrops.length, 0);
});

const coupon = (overrides = {}) => ({ week_from: '', week_to: '2026-10-25', item_no: '1',
  name_ja: 'テスト商品', discount_yen: '200', price_after: '800', price_before: '1000',
  scope: '倉庫店', source: '電子報', source_url: 'https://cds2.costcojapan.jp/cds/mail-images/upz/261016_test/pc_index.html',
  fetched_at: '2026-10-18T10:00:00+09:00', ...overrides });
const couponRun = (rows, products = []) => activeCoupons(rows, products, '2026-10-18');

test('coupons: missing file, empty, expired and future data provide no section entries', () => {
  assert.deepEqual(loadCoupons('data/__missing_coupons__.csv'), []);
  assert.deepEqual(couponRun([]), []);
  assert.deepEqual(couponRun([coupon({ week_to: '2026-10-17' }), coupon({ week_from: '2026-10-19' }),
    coupon({ fetched_at: '2026-10-19T10:00:00+09:00' })]), []);
  assert.equal(couponRun([coupon({ week_to: '2026-10-18' })]).length, 1);
});

test('coupons: discount descending; special price without known discount comes last', () => {
  const rows = [coupon({ item_no: '10' }), coupon({ item_no: '2' }),
    coupon({ item_no: '3', discount_yen: '500', price_before: '1300' }),
    coupon({ item_no: '4', discount_yen: '', price_before: '' })];
  const before = structuredClone(rows);
  assert.deepEqual(couponRun(rows).map((r) => r.item_no), ['3', '2', '10', '4']);
  assert.deepEqual(rows, before);
  assert.equal(couponRun(rows).at(-1).discount_yen, null);
});

test('coupons: only existing products get links in either locale and ItemList includes every row', () => {
  const rows = couponRun([coupon(), coupon({ item_no: '2' })], [product('1', [])]);
  assert.equal(rows[0].product.id, '1');
  assert.equal(rows[1].product, null);
  for (const lang of ['ja', 'zh']) {
    const list = couponList(rows, lang, 'https://example.com/deals/', 'https://example.com/');
    assert.equal(list.numberOfItems, 2);
    assert.equal(list.itemListElement.length, 2);
    assert.equal(list.itemListElement[0].url, `https://example.com/${lang === 'ja' ? '' : 'zh-hant/'}item/1/`);
    assert.equal(Object.hasOwn(list.itemListElement[1], 'url'), false);
  }
});

test('coupons: both languages identify announcement data and unknown values', () => {
  assert.equal(t('ja').couponsBadge, 'クーポン情報');
  assert.equal(t('zh').couponsBadge, '折價券資訊');
  for (const lang of ['ja', 'zh']) {
    assert.ok(t(lang).couponsNote.includes('Costco') || t(lang).couponsNote.includes('コストコ'));
    assert.ok(t(lang).couponsStartUnknown);
    assert.ok(t(lang).couponsSpecial);
  }
});

test('coupons: invalid dates, prices, scopes, provenance and inconsistent arithmetic never publish', () => {
  for (const bad of [{ week_to: '2026-02-30' }, { week_from: '2026-10-26' }, { discount_yen: '0' },
    { price_after: '-1' }, { price_before: '999' }, { price_after: 'oops' }, { item_no: '' },
    { scope: 'unknown' }, { source: 'LINE' }, { source_url: 'javascript:alert(1)' },
    { source_url: 'https://example.com/' }, { fetched_at: '' }]) {
    assert.deepEqual(couponRun([coupon(bad)]), [], JSON.stringify(bad));
  }
  const row = couponRun([coupon({ price_after: '', price_before: '' })])[0];
  assert.equal(row.price_after, null);
  assert.equal(row.week_from, '');
});

test('coupons: issue date wins over import time and input order across overlapping weeks', () => {
  const older = coupon({ source_url: coupon().source_url.replace('261016', '261009'), fetched_at: '2026-10-18T12:00:00+09:00' });
  const newer = coupon({ discount_yen: '300', price_before: '1100', fetched_at: '2026-10-18T10:00:00+09:00' });
  for (const rows of [[older, newer], [newer, older]]) {
    const result = couponRun(rows);
    assert.equal(result[0].discount_yen, 300);
    assert.equal(result[0].issue_date, '2026-10-16');
  }
  assert.equal(couponRun([{ ...older, fetched_at: newer.fetched_at }, newer])[0].discount_yen, 300);
});

test('coupons: per-100g prices retain their unit; legacy whole-item rows still work', () => {
  assert.equal(couponRun([coupon({ price_unit: '100g' })])[0].price_unit, '100g');
  assert.equal(couponRun([coupon()])[0].price_unit, '件');
  assert.deepEqual(couponRun([coupon({ price_unit: 'kg' })]), []);
});

test('coupons: current and upcoming offers switch on the actual advertised start date', () => {
  const current = coupon({ week_to: '2026-10-18', source_url: coupon().source_url.replace('261016', '261015') });
  const upcoming = coupon({ week_from: '2026-10-19', source_url: coupon().source_url.replace('261016', '261018'), discount_yen: '300', price_before: '1100' });
  assert.equal(activeCoupons([current, upcoming], [], '2026-10-18')[0].discount_yen, 200);
  assert.equal(activeCoupons([current, upcoming], [], '2026-10-19')[0].discount_yen, 300);
});
