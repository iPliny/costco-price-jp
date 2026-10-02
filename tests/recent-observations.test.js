import test from 'node:test';
import assert from 'node:assert/strict';
import { recentProducts } from '../src/lib/data.js';

const AS_OF = '2026-09-30';
const KUMAMOTO = '熊本御船倉庫店';
const ZAMA = '座間倉庫店';
const ONLINE = '線上商店';
const options = (extra = {}) => ({ asOf: AS_OF, preview: false, ...extra });

function observation(itemNo, extra = {}) {
  return {
    record_id: `record-${itemNo}`,
    item_no: String(itemNo),
    store: KUMAMOTO,
    price: 1298,
    price_unit: '件',
    period_from: '2026-09-20',
    period_to: '2026-09-25',
    review_status: '已查核',
    ...extra,
  };
}

function product(itemNo, records = [{}], extra = {}) {
  return {
    id: String(itemNo),
    item_no: String(itemNo),
    name: `商品 ${itemNo}`,
    current: records.map((record) => observation(itemNo, record)),
    ...extra,
  };
}

const itemNos = (rows) => rows.map(({ product: item }) => item.item_no);
const recordIds = (rows) => rows.map(({ observation: record }) => record.record_id);

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

test('store and online lists select their own observations without leaking channels', () => {
  const products = [
    product(1, [
      { record_id: 'store-1', period_to: '2026-09-22' },
      { record_id: 'online-1', store: ONLINE, period_to: '2026-09-30' },
    ]),
    product(2, [{ record_id: 'online-2', store: ONLINE }]),
    product(3, [{ record_id: 'store-3', store: ZAMA }]),
    product(4, [{ store: '' }]),
  ];

  const stores = recentProducts(products, 'store', options());
  assert.deepEqual(itemNos(stores), ['3', '1']);
  assert.deepEqual(recordIds(stores), ['store-3', 'store-1']);
  assert.ok(stores.every(({ observation: row }) => row.store && row.store !== ONLINE));

  const online = recentProducts(products, 'online', options());
  assert.deepEqual(itemNos(online), ['1', '2']);
  assert.ok(online.every(({ observation: row }) => row.store === ONLINE));
});

test('each product appears once and uses its most recent eligible store observation', () => {
  const products = [
    product(1, [
      { record_id: 'older', period_to: '2026-09-24' },
      { record_id: 'newer', store: ZAMA, period_to: '2026-09-26' },
      { record_id: 'online', store: ONLINE, period_to: '2026-09-30' },
    ]),
    product(2),
  ];
  const rows = recentProducts(products, 'store', options());
  assert.deepEqual(itemNos(rows), ['1', '2']);
  assert.deepEqual(recordIds(rows), ['newer', 'record-2']);
});

test('same-date ties prefer checked evidence, then the fixed store order, then record ID', () => {
  const products = [
    product(1, [
      { record_id: 'unconfirmed', review_status: '待確認', store: KUMAMOTO },
      { record_id: 'checked', review_status: '已查核', store: ZAMA },
    ]),
    product(2, [
      { record_id: 'zama', store: ZAMA },
      { record_id: 'kumamoto', store: KUMAMOTO },
    ]),
    product(3, [
      { record_id: 'record-b', store: KUMAMOTO },
      { record_id: 'record-a', store: KUMAMOTO },
    ]),
  ];
  assert.deepEqual(recordIds(recentProducts(products, 'store', options())), [
    'checked', 'kumamoto', 'record-a',
  ]);
});

test('formal output includes checked and unconfirmed evidence; preview additionally includes unchecked evidence', () => {
  const products = [
    product(1, [{ review_status: '已查核' }]),
    product(2, [{ review_status: '待確認' }]),
    product(3, [{ review_status: '待查核' }]),
    product(4, [{ review_status: 'unknown' }]),
    product(5, [{ review_status: '' }]),
  ];
  assert.deepEqual(itemNos(recentProducts(products, 'store', options())), ['1', '2']);
  assert.deepEqual(itemNos(recentProducts(products, 'store', options({ preview: true }))), ['1', '2', '3']);
});

test('dates must be strict calendar dates in a non-future, forward-running range', () => {
  const invalid = [
    { period_from: '', period_to: '2026-09-25' },
    { period_from: '2026-09-20', period_to: '' },
    { period_from: '2026-02-30', period_to: '2026-03-01' },
    { period_from: '2026-02-28', period_to: '2026-02-29' },
    { period_from: '2026-09-20', period_to: '2026-09-31' },
    { period_from: '2026-9-20', period_to: '2026-09-25' },
    { period_from: '2026-09-20', period_to: '2026-9-25' },
    { period_from: '2026-09-26', period_to: '2026-09-25' },
    { period_from: '2026-09-20', period_to: '2026-10-01' },
  ];
  const products = [
    ...invalid.map((record, index) => product(index + 1, [record])),
    product(20, [{ period_from: '2024-02-29', period_to: '2024-02-29' }]),
    product(21, [{ period_from: AS_OF, period_to: AS_OF }]),
  ];
  assert.deepEqual(itemNos(recentProducts(products, 'store', options())), ['21', '20']);
});

test('the actual observation interval and price are preserved, including per-100g prices', () => {
  const products = [product(1, [{
    price: 248,
    price_unit: '100g',
    period_from: '2026-09-01',
    period_to: '2026-09-19',
  }])];
  const [row] = recentProducts(products, 'store', options());
  assert.equal(row.observation.price, 248);
  assert.equal(row.observation.price_unit, '100g');
  assert.equal(row.observation.period_from, '2026-09-01');
  assert.equal(row.observation.period_to, '2026-09-19');
});

test('observation date wins over promotion end date, without reviving discarded historical records', () => {
  const discardedPromotion = observation(1, {
    record_id: 'discarded-promotion',
    period_from: '2026-09-01',
    period_to: '2026-09-30',
    discount: 200,
    promo_end: '2026-09-02',
  });
  const products = [
    product(1, [{ record_id: 'current-1', period_to: '2026-09-23' }], {
      observations: [discardedPromotion],
    }),
    product(2, [{
      record_id: 'current-promotion',
      period_from: '2026-09-01',
      period_to: '2026-09-26',
      discount: 100,
      promo_end: '2026-09-03',
    }]),
    product(3, [{ period_to: '2026-09-24' }]),
  ];
  const rows = recentProducts(products, 'store', options());
  assert.deepEqual(itemNos(rows), ['2', '3', '1']);
  assert.deepEqual(recordIds(rows), ['current-promotion', 'record-3', 'current-1']);
  assert.equal(rows[0].observation.period_to, '2026-09-26');
});

test('same-date products use numeric item-number order, unchanged by name edits or input order', () => {
  const products = [
    product(100, [{}], { name: 'A' }),
    product(10, [{}], { name: 'B' }),
    product(2, [{}], { name: 'Z' }),
    product(20, [{ period_to: '2026-09-26' }], { name: 'C' }),
  ];
  const expected = ['20', '2', '10', '100'];
  assert.deepEqual(itemNos(recentProducts(products, 'store', options())), expected);

  const renamed = products.map((item, index) => ({ ...item, name: `更新後の名称 ${index}` })).reverse();
  assert.deepEqual(itemNos(recentProducts(renamed, 'store', options())), expected);
});

test('equal-date observation selection is stable when candidate order changes', () => {
  const item = product(1, [
    { record_id: 'b', store: KUMAMOTO },
    { record_id: 'zama', store: ZAMA },
    { record_id: 'a', store: KUMAMOTO },
  ]);
  const forward = recentProducts([item], 'store', options());
  const backward = recentProducts([{ ...item, current: [...item.current].reverse() }], 'store', options());
  assert.deepEqual(recordIds(forward), ['a']);
  assert.deepEqual(recordIds(backward), ['a']);
});

test('the default cap is 20 distinct eligible products after channel filtering and per-product selection', () => {
  const invalid = Array.from({ length: 22 }, (_, index) => product(index + 100, [{ price: null }]));
  const online = Array.from({ length: 22 }, (_, index) => product(index + 200, [{ store: ONLINE }]));
  const valid = Array.from({ length: 24 }, (_, index) => product(index + 1, [
    { record_id: `kumamoto-${index}`, store: KUMAMOTO },
    { record_id: `zama-${index}`, store: ZAMA },
  ])).reverse();
  const products = [...invalid, ...online, ...valid];
  const validIds = new Set(Array.from({ length: 24 }, (_, index) => String(index + 1)));

  const rows = itemNos(recentProducts(products, 'store', options()));
  assert.equal(rows.length, 20);
  assert.equal(new Set(rows).size, 20);
  assert.ok(rows.every((id) => validIds.has(id)));
  assert.equal(recentProducts(products, 'store', options({ limit: 3 })).length, 3);
  assert.deepEqual(recentProducts(products, 'store', options({ limit: 0 })), []);
});

test('a newest batch larger than the cap is sampled at random, reproducibly for the same build date', () => {
  const products = Array.from({ length: 30 }, (_, index) => product(index + 1, [{ period_to: '2026-09-30' }]));
  const first = itemNos(recentProducts(products, 'store', options()));
  const again = itemNos(recentProducts([...products].reverse(), 'store', options()));
  assert.equal(first.length, 20);
  assert.deepEqual(again, first);
  assert.deepEqual(first, [...first].sort((a, b) => Number(a) - Number(b)));
  const otherDays = ['a', 'b', 'c', 'd'].map((seed) => itemNos(recentProducts(products, 'store', options({ seed }))).join());
  assert.ok(otherDays.some((list) => list !== first.join()));
});

test('a newest batch smaller than the cap is shown in full and topped up at random from the previous batch', () => {
  const newest = Array.from({ length: 15 }, (_, index) => product(index + 1, [{ period_to: '2026-09-30' }]));
  const previous = Array.from({ length: 10 }, (_, index) => product(index + 101, [{ period_to: '2026-09-28' }]));
  const older = Array.from({ length: 10 }, (_, index) => product(index + 201, [{ period_to: '2026-09-20' }]));
  const rows = recentProducts([...older, ...previous, ...newest], 'store', options());
  const ids = itemNos(rows);
  assert.equal(ids.length, 20);
  assert.deepEqual(ids.slice(0, 15), Array.from({ length: 15 }, (_, index) => String(index + 1)));
  assert.ok(ids.slice(15).every((id) => Number(id) > 100 && Number(id) <= 110));

  const thin = recentProducts([...older, ...previous.slice(0, 2), ...newest], 'store', options());
  assert.equal(thin.length, 20);
  assert.deepEqual(itemNos(thin).slice(15, 17), ['101', '102']);
  assert.ok(itemNos(thin).slice(17).every((id) => Number(id) > 200));
});

test('ineligible prices, units and missing item numbers are excluded while zero remains a valid price', () => {
  const invalidPrices = [null, undefined, NaN, Infinity, -Infinity, -1];
  const products = [
    ...invalidPrices.map((price, index) => product(index + 1, [{ price }])),
    product(10, [{ price_unit: '' }]),
    product(11, [{ price_unit: 'kg' }]),
    product('', [{}]),
    product(12, [{ price: 0 }]),
    product(13, [{ price: 100, price_unit: '100g' }]),
  ];
  assert.deepEqual(itemNos(recentProducts(products, 'store', options())), ['12', '13']);
});

test('empty and sparse current lists return only eligible entries without mutating the input', () => {
  assert.deepEqual(recentProducts([], 'store', options()), []);
  const products = [
    product(1, []),
    product(2, [{ price: null }]),
    product(3, [
      { record_id: 'zama', store: ZAMA },
      { record_id: 'kumamoto', store: KUMAMOTO },
    ]),
  ];
  const before = structuredClone(products);
  deepFreeze(products);
  const rows = recentProducts(products, 'store', options());
  assert.deepEqual(itemNos(rows), ['3']);
  assert.deepEqual(recordIds(rows), ['kumamoto']);
  assert.deepEqual(products, before);
  assert.deepEqual(recentProducts(products, 'online', options()), []);
});
