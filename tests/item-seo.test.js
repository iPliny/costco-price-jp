import test from 'node:test';
import assert from 'node:assert/strict';
import { relatedProducts, physicalStoreCount, productOffers, latestPublicDate, latestDate } from '../src/lib/data.js';
import { t } from '../src/lib/i18n.js';

const asOf = '2026-10-18';
const row = (overrides = {}) => ({ store: '座間倉庫店', price: 1000, price_unit: '件',
  source_type: '門市價牌', review_status: '已查核', period_to: asOf, ...overrides });
const product = (id, overrides = {}) => ({ id, item_no: id, category: 'bread', categoryTop: 'food',
  popular: false, current: [row()], ...overrides });
const ids = (rows) => rows.map((p) => p.id);
const subject = product('1');

test('related: excludes self, missing item number and unavailable current records', () => {
  const candidates = [subject, product('2'), product('3', { item_no: '' }), product('4', { current: [] }),
    product('5', { current: [row({ review_status: '待查核' })] }), product('6', { current: [row({ review_status: 'unknown' })] })];
  assert.deepEqual(ids(relatedProducts(subject, candidates, { preview: false })), ['2']);
  assert.deepEqual(ids(relatedProducts(subject, candidates, { preview: true })), ['2', '5']);
});

test('related: small category precedes top category, never unrelated categories', () => {
  const candidates = [product('2', { category: 'milk', popular: true }), product('3'),
    product('4', { category: 'soap', categoryTop: 'daily' })];
  assert.deepEqual(ids(relatedProducts(subject, candidates)), ['3', '2']);
  assert.deepEqual(relatedProducts({ ...subject, category: null }, candidates), []);
  assert.deepEqual(ids(relatedProducts({ ...subject, categoryTop: null }, candidates)), ['3']);
});

test('related: distinct physical stores, popularity, date and numeric item number determine order', () => {
  const candidates = [
    product('10'), product('9'),
    product('8', { current: [row({ period_to: '2026-10-17' })] }),
    product('7', { popular: true }),
    product('6', { current: [row(), row({ store: '浜松倉庫店' })] }),
    product('5', { current: [row(), row(), row({ store: '線上商店' })] }),
  ];
  const before = structuredClone(candidates);
  assert.equal(physicalStoreCount(candidates.at(-1)), 1);
  assert.deepEqual(ids(relatedProducts(subject, candidates)), ['6', '7', '5', '9', '10', '8']);
  assert.deepEqual(ids(relatedProducts(subject, [...candidates].reverse())), ['6', '7', '5', '9', '10', '8']);
  assert.deepEqual(candidates, before);
});

test('related: default six and explicit limits, including invalid limits', () => {
  const candidates = Array.from({ length: 9 }, (_, n) => product(String(n + 2)));
  assert.equal(relatedProducts(subject, candidates).length, 6);
  assert.deepEqual(ids(relatedProducts(subject, candidates, { limit: 2 })), ['2', '3']);
  for (const limit of [0, -1, 1.5, NaN]) assert.deepEqual(relatedProducts(subject, candidates, { limit }), []);
});

test('offers: one eligible record is Offer; multiple are AggregateOffer', () => {
  assert.deepEqual(productOffers(subject, { asOf }), { '@type': 'Offer', priceCurrency: 'JPY', price: 1000 });
  const p = product('1', { current: [row(), row({ price: 900, store: '線上商店' })] });
  const before = structuredClone(p);
  assert.deepEqual(productOffers(p, { asOf }), { '@type': 'AggregateOffer', priceCurrency: 'JPY', lowPrice: 900, highPrice: 1000, offerCount: 2 });
  assert.deepEqual(p, before);
});

test('offers: excludes community, 100g, stale, future, invalid dates/prices and private status', () => {
  const excluded = [
    { source_type: '社群回報' }, { price_unit: '100g' }, { period_to: '2026-08-18' },
    { period_to: '2026-10-19' }, { period_to: '2026-02-30' }, { period_to: '' },
    { price: null }, { price: NaN }, { price: Infinity }, { price: -1 },
    { review_status: '待查核' }, { review_status: 'unknown' },
  ].map(row);
  for (const record of excluded) assert.equal(productOffers(product('1', { current: [record] }), { asOf, preview: false }), null);
  assert.equal(productOffers(product('1', { current: excluded }), { asOf, preview: false }), null);
  assert.equal(productOffers(product('1', { current: [row(), ...excluded] }), { asOf, preview: false })['@type'], 'Offer');
  assert.equal(productOffers(product('1', { item_no: '' }), { asOf }), null);
  assert.equal(productOffers(subject, { asOf: 'invalid' }), null);
  assert.equal(productOffers(product('1', { current: [] }), { asOf }), null);
});

test('offers: includes the 60-day boundary, pending confirmation and preview policy', () => {
  const p = product('1', { current: [row({ period_to: '2026-08-19', review_status: '待確認' })] });
  assert.equal(productOffers(p, { asOf, preview: false })['@type'], 'Offer');
  const preview = product('1', { current: [row({ review_status: '待查核' })] });
  assert.equal(productOffers(preview, { asOf, preview: true })['@type'], 'Offer');
});

test('lastmod: latest public end date, future and invalid dates skipped, no fabricated fallback', () => {
  const records = [row({ period_to: '2026-10-10' }), row({ period_to: '2026-10-17', review_status: '待確認' }),
    row({ period_to: '2026-10-18', review_status: '待查核' }), row({ period_to: '2026-10-19' }),
    row({ period_to: '2026-02-30' }), row({ period_to: '' })];
  assert.equal(latestPublicDate(records, { asOf, preview: false }), '2026-10-17');
  assert.equal(latestPublicDate(records, { asOf, preview: true }), asOf);
  assert.equal(latestPublicDate([], { asOf }), null);
  assert.equal(latestPublicDate([row({ period_to: '2026-10-19' })], { asOf }), null);
  assert.equal(latestDate([null, 'invalid', '2026-10-10', '2026-10-19'], { asOf }), '2026-10-10');
  assert.equal(latestDate(['2026-10-19'], { asOf }), null);
  assert.equal(latestDate([asOf], { asOf: 'invalid' }), null);
});

test('descriptions: only multiple stores with unequal piece prices add the localized range', () => {
  for (const lang of ['ja', 'zh']) {
    const s = t(lang);
    const original = s.itemDescription('Test', '1', null, 2);
    assert.equal(s.itemDescription('Test', '1', null, 2, null, null), original);
    assert.equal(s.itemDescription('Test', '1', null, 2, 900, 900), original);
    assert.equal(s.itemDescription('Test', '1', null, 1, 900, 1000), s.itemDescription('Test', '1', null, 1));
    assert.ok(s.itemDescription('Test', '1', null, 2, 900, 1000).endsWith(lang === 'ja'
      ? '2店舗の価格を比較できます（900円〜1,000円）。' : '可比較 2 家店的價格（900〜1,000 円）。'));
  }
});
