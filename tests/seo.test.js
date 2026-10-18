import test from 'node:test';
import assert from 'node:assert/strict';
import { breadcrumb, jsonLd, pageMetadata } from '../src/lib/seo.js';

test('商品觀測頁描述資訊與可見導覽，不宣稱可購買價格', () => {
  const nodes = pageMetadata({ title: '商品', description: '歷史價格', url: 'https://example.test/item/1/',
    home: 'https://example.test/', brand: '価格記録', language: 'ja', isHome: false });
  assert.equal(nodes[0]['@type'], 'WebPage');
  assert.equal(nodes[0].url, 'https://example.test/item/1/');
  assert.ok(!jsonLd(nodes).includes('Offer'));
  const crumbs = breadcrumb([['首頁', 'https://example.test/'], ['商品', nodes[0].url]]);
  assert.deepEqual(crumbs.itemListElement.map((x) => x.position), [1, 2]);
});

test('嵌入 JSON-LD 的文字不能關閉 script 元素', () => {
  const name = '</script><script>alert(1)</script>';
  const value = jsonLd({ name });
  assert.ok(!value.includes('<'));
  assert.equal(JSON.parse(value).name, name);
});
