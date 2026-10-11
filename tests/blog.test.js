import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePost, checkPost, loadPosts } from '../src/lib/blog.js';

const meta = {
  title: '日本好市多週報#9：測試',
  date: '2026-10-17',
  labels: ['好市多', '日本物價', '週報', 'Costco優格', '日本米價'],
  description: '測試用搜尋說明。',
};
const make = (m = {}, body = '<h2>小標</h2><p>內文</p>', slug = 'weekly-9') =>
  parsePost(slug, `<!--POST ${JSON.stringify({ ...meta, ...m })}-->\n${body}`);

test('合格文章沒有錯誤', () => {
  const p = make();
  assert.deepEqual(checkPost(p), []);
  assert.equal(p.html, '<h2>小標</h2><p>內文</p>');
});

test('labels 須剛好 5 個且含固定三個', () => {
  assert.ok(checkPost(make({ labels: ['好市多', '日本物價', '週報', 'A'] })).length);
  assert.ok(checkPost(make({ labels: ['好市多', '日本物價', 'X', 'A', 'B'] })).length);
  assert.ok(checkPost(make({ labels: ['好市多', '日本物價', '週報', 'A', 'A'] })).length);
});

test('搜尋說明最多 150 字元', () => {
  assert.deepEqual(checkPost(make({ description: 'あ'.repeat(150) })), []);
  assert.ok(checkPost(make({ description: 'あ'.repeat(151) })).length);
});

test('檔名、日期、危險標籤與舊網址', () => {
  assert.ok(checkPost(make({}, undefined, 'Weekly 9')).length);
  assert.ok(checkPost(make({ date: '2026/10/17' })).length);
  assert.ok(checkPost(make({}, '<p onclick="x()">a</p>')).length);
  assert.ok(checkPost(make({}, '<script>x</script>')).length);
  assert.ok(checkPost(make({}, '<a href="https://ipliny.github.io/costco-price-jp/zh-hant/">站</a>')).length);
});

test('repo 內所有文章都通過檢查', () => {
  assert.doesNotThrow(() => loadPosts());
});
