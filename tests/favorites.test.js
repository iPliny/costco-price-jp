import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFavorites, toggled } from '../src/lib/favorites.js';

test('壞掉或空的儲存值當作沒有收藏', () => {
  assert.deepEqual(parseFavorites(null), []);
  assert.deepEqual(parseFavorites('not json'), []);
  assert.deepEqual(parseFavorites('{"a":1}'), []);
  assert.deepEqual(parseFavorites('["1590853", 3, "", "1590853", "87652"]'), ['1590853', '87652']);
});

test('加入的排在最前面，再按一次取消', () => {
  assert.deepEqual(toggled(['87652'], '1590853'), ['1590853', '87652']);
  assert.deepEqual(toggled(['1590853', '87652'], '1590853'), ['87652']);
});
