import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadProductImages, loadProducts, heatImage } from '../src/lib/data.js';

const images = loadProductImages();
const products = loadProducts();

test('image index contains unique product numbers with published product pages', () => {
  const csv = fs.readFileSync('data/product_images.csv', 'utf8');
  const numbers = csv.trim().split('\n').slice(1).map((line) => line.split(',')[0]);
  assert.equal(new Set(numbers).size, numbers.length);
  assert.equal(images.size, numbers.length);
  for (const item of numbers) assert.ok(products.some((p) => p.item_no === item), item);
});

test('every indexed image exists within its size budget and has bilingual alt text', () => {
  for (const [item, image] of images) {
    assert.equal(image.file, `product-images/${item}.webp`);
    assert.equal(image.og_file, `product-images/og/${item}.jpg`);
    assert.ok(fs.statSync(path.join('public', image.file)).size <= 120 * 1024, image.file);
    assert.ok(fs.statSync(path.join('public', image.og_file)).size <= 200 * 1024, image.og_file);
    assert.ok(image.alt_ja.endsWith('のイメージイラスト'));
    assert.ok(image.alt_zh.endsWith('示意插畫'));
    assert.match(image.source_sha256, /^[a-f0-9]{64}$/);
    assert.match(image.added, /^\d{4}-\d{2}-\d{2}$/);
  }
});

const illustrated = (id, n, category = 'food') => ({
  item_no: id, searchText: 'topic', spec: '', category,
  observations: Array(n).fill({}), image: { file: `${id}.webp` },
});

test('weekly thumbnails honor explicit selection, matches, observation counts and missing images', () => {
  const items = [illustrated('10', 2), illustrated('2', 5), illustrated('3', 20, 'other'),
    { ...illustrated('4', 100), image: undefined }];
  const heat = { query: 'topic', categories: ['food'] };
  assert.equal(heatImage(items, heat).file, '2.webp');
  assert.equal(heatImage(items, { ...heat, image_item_no: '10' }).file, '10.webp');
  assert.equal(heatImage(items, { ...heat, image_item_no: 'missing' }), undefined);
  assert.equal(heatImage(items, { ...heat, image_item_no: '4' }), undefined);
  assert.equal(heatImage(items, { query: 'absent' }), undefined);
  const tied = [illustrated('10', 5), illustrated('2', 5)];
  assert.equal(heatImage(tied, heat).file, '2.webp');
  assert.equal(heatImage(tied.reverse(), heat).file, '2.webp');
});
