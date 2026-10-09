import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, searchIndex, fuzzyIncludes } from '../src/lib/search.js';
import { buildSearchIndex } from '../src/lib/data.js';

const find = (texts, q) => texts.filter((_, i) => searchIndex(texts, q).hits[i]);

test('片假名、平假名、全形半形與大小寫視為相同', () => {
  assert.equal(normalize('オイコス'), normalize('おいこす'));
  assert.equal(normalize('ＫＩＲＫＬＡＮＤ'), normalize('kirkland'));
  assert.equal(normalize('ﾊﾞｽﾃｨｯｼｭ'), normalize('バスティッシュ'));
  assert.equal(normalize('Air Pods'), normalize('airpods'));
});

test('完全找得到就不放寬', () => {
  const texts = [normalize('ダノンオイコス脂肪0 ブルーベリー'), normalize('アイコス')];
  const r = searchIndex(texts, 'おいこす');
  assert.deepEqual(r.hits, [true, false]);
  assert.equal(r.fuzzy, false);
});

test('打錯一個字時給近い候補', () => {
  const texts = [normalize('ティラミス'), normalize('ベーグル')];
  const r = searchIndex(texts, 'ティラミズ');
  assert.equal(r.fuzzy, true);
  assert.deepEqual(r.hits, [true, false]);
  assert.ok(fuzzyIncludes(normalize('kirkland signature'), normalize('kirkrand')));
  assert.ok(!fuzzyIncludes(normalize('ベーグル'), normalize('米')));
});

test('多個詞都要符合', () => {
  const texts = [normalize('オイコス ブルーベリー'), normalize('オイコス ストロベリー')];
  assert.deepEqual(searchIndex(texts, 'オイコス ブルー').hits, [true, false]);
});

test('同義詞與別名讓中文也找得到', () => {
  const groups = [['卵', 'たまご', '雞蛋'], ['お米', 'ライス', 'rice']];
  const egg = buildSearchIndex(['オーガニック卵 10個入'], groups);
  assert.ok(searchIndex([egg], '雞蛋').hits[0]);
  // 同義詞表沒有單字「米」，所以「米国産」不會被當成米。
  const beef = buildSearchIndex(['米国産 牛肉'], groups);
  assert.ok(!searchIndex([beef], 'rice').hits[0]);
  const rice = buildSearchIndex(['ジャスミンライス', '泰國香米'], groups);
  assert.ok(searchIndex([rice], '香米').hits[0]);
});
