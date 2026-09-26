// 日文版放在網站根目錄（搜尋流量的主力），繁體中文版放在 /zh-hant/。
export const LANGS = {
  ja: { htmlLang: 'ja', prefix: '', label: '日本語' },
  zh: { htmlLang: 'zh-Hant', prefix: 'zh-hant/', label: '中文' },
};

const STRINGS = {
  ja: {
    brand: 'コストコ価格記録',
    siteDescription: '日本のコストコ（Costco Japan）各倉庫店で確認した価格の記録を検索できます。',
    homeTitle: 'コストコ価格記録｜日本のコストコ各倉庫店の価格を検索',
    heading: '日本のコストコ価格記録',
    summary: (n, s) => `${n}商品・${s}店舗の価格記録を掲載。商品名やコストコ商品番号で検索できます。`,
    searchPlaceholder: '商品名・商品番号で検索（例：オイコス、86171）',
    allStores: 'すべての店舗',
    itemNoMissing: '商品番号なし',
    recordCount: (n) => `${n}件の記録`,
    storeJoin: '・',
    empty: '該当する商品が見つかりません。',
    back: '← 商品一覧へ戻る',
    itemNoLabel: (no) => (no ? `コストコ商品番号 ${no}` : 'コストコ商品番号なし'),
    itemTitle: (name) => `${name}｜コストコ価格記録`,
    itemDescription: (name, no) => `${name}（コストコ商品番号 ${no || 'なし'}）の日本の各コストコ倉庫店での価格記録。`,
    history: '価格の記録',
    historyNote: '記録が少ないため価格グラフは表示していません。各記録は「この期間中に確認された価格」で、期間中ずっとその価格だったことを示すものではありません。「要確認」の記録は一部の詳細が未確認です。備考をご覧ください。',
    wasPrice: '通常価格',
    off: '値引き',
    per100g: '／100g',
    spec: '規格',
    source: '情報源',
    observed: '確認期間',
    promoEnd: '割引終了',
    note: '備考',
    showScreenshot: '公式サイトの画面を見る',
    screenshotAlt: (name) => `${name} 公式サイトの価格画面`,
    period: (from, to) => (from && to ? `${from} 〜 ${to} の間に確認` : from ? `${from} 以降に確認` : '確認日未定'),
    previewBar: '内部プレビュー：未確認のデータを含みます。公開サイトには確認済みと要確認の記録のみ表示されます。',
    footer: '価格は店頭の価格表示や公式サイトなどで確認した記録で、「ある期間に確認された価格」を示すものです。現在の販売価格ではありません。実際の価格は店頭の表示をご確認ください。当サイトはコストコとは関係ありません。',
    stores: { 線上商店: 'オンライン' },
    sources: { 門市價牌: '店頭の価格表示', 網路截圖: '公式サイトの画面' },
    statuses: { 已查核: '確認済み', 待確認: '要確認', 待查核: '未確認' },
  },
  zh: {
    brand: 'Costco 價格紀錄',
    siteDescription: '日本好市多（Costco Japan）各倉庫店價格紀錄查詢。',
    homeTitle: 'Costco 價格紀錄｜日本好市多各店價格查詢',
    heading: '日本 Costco 價格紀錄',
    summary: (n, s) => `收錄 ${n} 項商品，來自 ${s} 個來源店別。可用商品名、Costco 商品號搜尋。`,
    searchPlaceholder: '搜尋商品名或商品號，例如 オイコス、86171',
    allStores: '全部店別',
    itemNoMissing: '商品號待補',
    recordCount: (n) => `${n} 筆紀錄`,
    storeJoin: '、',
    empty: '找不到符合的商品。',
    back: '← 回到商品列表',
    itemNoLabel: (no) => (no ? `Costco 商品號 ${no}` : 'Costco 商品號待補'),
    itemTitle: (name) => `${name}｜Costco 價格紀錄`,
    itemDescription: (name, no) => `${name}（Costco 商品號 ${no || '待補'}）在日本各 Costco 倉庫店的價格觀測紀錄。`,
    history: '價格紀錄',
    historyNote: '紀錄太少時不畫價格曲線；每筆標示的是「該期間曾觀測到」的價格，不代表整段期間每天都是這個價。標示「待確認」的紀錄還有細節未核實，請參考備註。',
    wasPrice: '原價',
    off: '折',
    per100g: '／100g',
    spec: '規格',
    source: '來源',
    observed: '觀測',
    promoEnd: '優惠至',
    note: '備註',
    showScreenshot: '查看官網截圖',
    screenshotAlt: (name) => `${name} 官網價格截圖`,
    period: (from, to) => (from && to ? `${from} 至 ${to} 間曾觀測` : from ? `${from} 起曾觀測` : '觀測日期待確認'),
    previewBar: '內部預覽：含尚未查核的資料，正式站只會顯示已查核與待確認紀錄。',
    footer: '價格來自門市價牌、官網等來源的觀測紀錄，標示為「某期間曾觀測到的價格」，不代表今日售價。實際價格以店內標示為準。本站與 Costco 無關。',
    stores: {},
    sources: {},
    statuses: {},
  },
};

export function t(lang) {
  return STRINGS[lang];
}

// 資料欄位（店名、來源、狀態）以中文存放，顯示時依語言轉換。
export const storeName = (lang, s) => STRINGS[lang].stores[s] ?? s;
export const sourceName = (lang, s) => STRINGS[lang].sources[s] ?? s;
export const statusName = (lang, s) => STRINGS[lang].statuses[s] ?? s;
export const noteText = (lang, o) => (lang === 'ja' ? o.note_ja || o.note : o.note);

export function localePath(lang, path = '') {
  return import.meta.env.BASE_URL + LANGS[lang].prefix + path;
}
