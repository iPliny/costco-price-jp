// 搜尋框的比對規則（建置時與瀏覽器共用）。
// 1. 正規化：全形半形、大小寫、片假名與平假名、空白與標點都視為相同。
// 2. 先找完全包含的商品；一筆都沒有時才放寬，容許少量打錯字（近い候補）。

const STRIP = /[\s・･\-‐‑–—―－_/／.,，、。'’"“”()（）［］\[\]「」『』【】&＋+!！?？~〜:：;；*＊#＃]/g;

export function normalize(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    // 片假名 → 平假名（ァ〜ヶ），ヴ 統一成 ぶ。
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/ゔ/g, 'ぶ')
    .replace(STRIP, '');
}

// 查詢以空白分詞，每個詞都要符合（AND）。
export function queryTerms(query) {
  return String(query ?? '').normalize('NFKC').split(/\s+/).map(normalize).filter(Boolean);
}

// 詞越長，容許越多錯字：1〜2 字不容錯，3〜6 字 1 個，7 字以上 2 個。
export function allowedEdits(term) {
  const n = [...term].length;
  return n <= 2 ? 0 : n <= 6 ? 1 : 2;
}

// text 裡是否有一段和 term 相差不超過 k 個字（插入、刪除、替換）。
export function fuzzyIncludes(text, term, k = allowedEdits(term)) {
  if (text.includes(term)) return true;
  if (k === 0) return false;
  const a = [...term];
  const b = [...text];
  let prev = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    const cur = [0];
    for (let i = 1; i <= a.length; i++) {
      cur[i] = Math.min(prev[i] + 1, cur[i - 1] + 1, prev[i - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    if (cur[a.length] <= k) return true;
    prev = cur;
  }
  return false;
}

// 回傳每一筆是否符合，以及是不是放寬後的結果。
export function searchIndex(texts, query) {
  const terms = queryTerms(query);
  if (!terms.length) return { hits: texts.map(() => true), fuzzy: false };
  const exact = texts.map((t) => terms.every((term) => t.includes(term)));
  if (exact.some(Boolean)) return { hits: exact, fuzzy: false };
  return { hits: texts.map((t) => terms.every((term) => fuzzyIncludes(t, term))), fuzzy: true };
}
