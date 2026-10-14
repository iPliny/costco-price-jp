# costco-price-jp

日本 Costco 各倉庫店的價格觀測紀錄網站（Astro 靜態網站，部署在 Cloudflare Pages：https://costco.crawlsnek.com/；程式碼與資料在 GitHub）。搬家時須依下方順序完成後台切換，合併程式碼本身不會改變 DNS。

日文版在網站根目錄，繁體中文版在 `/zh-hant/`，每頁右上角可切換。介面文字在 `src/lib/i18n.js`；紀錄的備註用 `note`（中文）與 `note_ja`（日文）兩欄，新增備註時兩欄都要填。

## 資料

商品分類定義在 `data/categories.json`（3 個大分類、24 個小分類）；每個商品的分類、信心與判斷日期在 `data/product_categories.csv`，以 `tools/check_categories.py` 檢查。新的商品番号加入 observations.csv 時，同時在 product_categories.csv 補上分類。

「高人氣商品」是可重疊的特別分類，在建置時自動計算：`data/weekly_heat.json` 依 `to` 排序的最新 4 週 TOP5 查詢字符合商品搜尋文字、商品番号或規格，或 `data/item_discussions.json` 中存在最近 4 週的該商品討論。討論以該檔最新 `from` 為基準，採 `(最新 from − 28 天, 最新 from]`；最新週與前三週納入，四週前同日不納入。首頁排序和人氣判斷共用同一個熱度比對函式。熱度項目可加 `categories`（小分類 id 陣列），只比對這些分類的商品，避免「米」這種短字命中米久、純米大吟醸。一般分類仍照常顯示高人氣商品。分類頁及按鈕的數量依正式／預覽模式中可顯示的商品計算。

所有紀錄在 `data/observations.csv`，一列一筆觀測。

- `review_status`：「已查核」與「待確認」都會上正式站，「待確認」會加標示並顯示備註；「待查核」只出現在預覽版。
- 網站不公開門市照片，只標示來源類型與店別。官網截圖（網路截圖）可以公開，放在 `public/evidence/`，檔名用紀錄編號，並去除檔案中的拍攝資訊；`evidence_image` 欄填路徑。店別以素材所在的店資料夾為準。
- 沒有 Costco 商品番号（`item_no`）的紀錄無法串連價格歷史，不出現在搜尋頁（日本のコストコ価格記録）與商品頁，預覽版也一樣；它們只以話題的身分出現在排名頁（今週の話題）的「店舗ごとの価格」。補上商品番号後會自動出現在搜尋頁。
- `note` 只有資訊性文字（例如「特別価格」）的紀錄可列為已查核；有待確認事項的標為待確認。

### 觀測區間

`period_from`／`period_to` 是「這段期間內曾看到這個價格」，不是整段期間每天的售價。

- 2026-09-12 至 2026-09-25 的首批素材，區間一律記為這兩週。
- 之後每週查價 2–3 次，每一批的區間記為「上次查價日的隔天」到「本次查價日」；能確定拍攝日時，`period_from` 與 `period_to` 都記拍攝日。
- 同一個原始檔（`evidence_sha256` 相同）重複上傳時不新增紀錄；不同日期重新拍到同價的商品，則新增一筆，區間用新的查價日期。

### 最近觀測

首頁的「最近の観測／最近觀測」入口連到 `/recent/`（實體門市），並可切換 `/recent/online/`（官網）；繁中對應頁在 `/zh-hant/`。兩種來源各自取最多 20 件不同商品，不把官網更新混入門市排序。頁面是靜態 HTML，不需要 JavaScript。

`recentProducts()` 從商品頁目前使用的 `p.current` 紀錄選代表價格，不改既有各店取價規則。先依來源篩選，再以 `period_to` 由新到舊選每件商品的一筆；同日優先查核程度，再按固定店別順序及紀錄編號。去重後以 `period_to` 分批：最新一批超過 20 件時隨機取 20 件；不足 20 件時全部列出，剩下名額從上一批隨機挑（還不夠再往更早一批補）。亂數以建置日期（日本時間）與來源為種子，同一天重建結果相同，每天部署時輪換；頁面上依日期新到舊、同日依商品號顯示。商品名、補登時間與優惠截止日不作為觀測日期。

卡片的店別、價格、規格、日期區間、來源與查核狀態都來自同一筆紀錄；缺少規格時不借用其他店的規格。日期沿用商品頁的區間／官網取得日期文字，不表示整段期間每天售價相同。正式版沿用已查核與待確認的公開政策，預覽版可含待查核；保留狀態及備註。缺價格、不支援的計價單位、日期缺漏／無效／顛倒，以及晚於建置當天日本日期的觀測，不進入此入口，不修改原始資料。

資料規則檢查：`node --test tests/recent-observations.test.js`。

### 値下げ・セール一覧

雙語固定網址 `/deals/`、`/zh-hant/deals/`，每次建置跟著資料更新，不產生歷史期數網址。`weeklyDeals(products, { asOf, preview })` 是純函式，沿用既有日本日期、有效日期與公開狀態規則：正式版只含已查核、待確認（標示），預覽可含待查核。排除無商品番号、社群回報、無效價格、非件／100g、缺漏／無效／顛倒／未來觀測期間。

以可用店頭紀錄最晚的 `period_to` 為 anchor，往前 6 天到 anchor（共 7 天）。門市特價只選本週 `price < list_price` 的紀錄，商品×店留最新一筆，同日依查核程度再依紀錄編號；`promo_end` 早於日本今天的特價移到收合的已結束清單。官網特價獨立列出，只用昨天或今天仍有觀測的官網紀錄。兩組各以一商品一卡顯示店別，依最大値引き額、該筆折扣率、商品番号排序；官網價格不當門市原價。

「前回より値下がり」選本週商品×店最新紀錄，再取同店、同計價單位、`period_to` 嚴格早於今回 `period_from` 的最近一筆；只列變便宜的紀錄，排除已在門市特價主清單的商品×店。以降幅、商品番号排序。更新日為三組用到的最新 `period_to`，三組皆空時用 anchor，無可用店頭紀錄也無特價時不捏造日期。`loadWeeklyDeals()` 只在靜態建置程序共用當日結果，避免每張商品頁重算全站資料。

規則檢查：`node --test tests/deals.test.js`；預覽建置：`CF_PAGES_BRANCH=test npm run build:cf`。

### 過去の記録

商品頁原有各店最新價格保持原樣；`priceRecords(p)` 在下方新增預設收合的全部公開紀錄表，依 `period_to` 新到舊、固定店別順序、紀錄編號排序。至少有兩個不同觀測終日才顯示。含官網及社群回報，保留來源、狀態、備註與原價；表格內部可橫向捲動，不畫走勢圖。

### 署名與調查方法

降價頁、各期本月話題與中文週報署名「編集部 ハクイ／編輯部 ハクイ」，連到雙語 `/about/` 調查方法；本月話題與週報 JSON-LD author 為 Person ハクイ，worksFor 為本站 Organization。調查方法的店名、商品數與紀錄數從該建置模式可公開資料計算，不刊登門市照片、聊天暱稱或原文。

### 本月話題

排名頁有「今週の話題／今月の話題」兩個分頁（`/ranking/`、`/ranking/monthly/`）。本月話題大約每月最後一個星期日出刊，由 Claude 撰寫（不交給 Codex），SEO 取向：標題用【年月】＋商品名＋値段，先列「この記事でわかること」與目次，小標題用搜尋者會問的問句，最後放よくある質問與調查方法。內容在 `data/monthly_topics.json`（`from`／`to` 是資料期間，日文與中文都要寫），每期有固定網址 `/ranking/monthly/<YYYY-MM>/`；分頁入口顯示最新一期全文，canonical 指向該期網址。每段的價格表在建置時從期間內的紀錄自動產生（社群回報不列入），內文的數字要和紀錄一致。新的一期加在檔案裡，舊的期數保留。

### 搜尋關鍵字（後台）

首頁搜尋框會把全形／半形、大小寫、片假名／平假名、空白與標點視為相同（「おいこす」找得到オイコス）。先找完全包含的商品；一筆都沒有時才放寬成「近い候補」，容許打錯字（3〜6 字 1 個字、7 字以上 2 個字），並在清單上方註明。多個詞用空白分開時每個詞都要符合。程式在 `src/lib/search.js`。

搜尋文字包含：商品名、各紀錄的店頭叫法、官網英文名、商品番号、規格、小分類名，以及下面兩個可以手動增加的關鍵字檔：

- `data/search_aliases.csv`：單一商品的別名，一列一個（`item_no,alias,lang,source,checked`）。`lang` 填 ja／zh／en，`source` 填 manual（POYU 手動）、claude 或 codex。例：`1590853,泰國香米,zh,manual,2026-10-07`。
- `data/search_synonyms.csv`：通用同義詞，一列一組、用 `|` 分隔（`terms,note`）。商品文字含其中任一個詞時，整組都會變成搜尋得到的詞（例：`卵|たまご|雞蛋`）。分類名不觸發同義詞。不要放單字的詞（「米」會誤配「米国産」），也不要放 2 個英文字母的縮寫（KS 會誤配 packs）。

Codex 的別名提案（prompt：Drive PM/Codex搜尋關鍵字Prompt）放在 `PM/04_待查核/<日期>_Codex搜尋關鍵字_v1/`，由 Claude 二讀後合併進 `search_aliases.csv`。規則檢查：`node --test tests/search.test.js`。

### 收藏

每頁右上角「今週の話題」旁有「★ お気に入り／收藏」入口，連到 `/favorites/`（繁中 `/zh-hant/favorites/`）。商品列表每張卡片右上的 ☆ 與商品頁標題下的按鈕可以加入或取消收藏；入口旁的數字是收藏件數（手機版只顯示 ★ 與數字）。

網站沒有登入，收藏只存在該裝置瀏覽器的 localStorage（`costco-price-jp:favorites`，商品番号陣列，新加入的在最前面），日文與中文頁共用，不會同步到其他裝置。收藏頁在瀏覽器讀取建置時產生的 `favorites/products.json`（每個商品各店目前顯示的那一筆，和商品頁相同），只顯示收藏的商品。收藏頁加 noindex、不放進網站地圖。程式在 `src/lib/favorites.js`，規則檢查：`node --test tests/favorites.test.js`。

### 週報（中文文章）

中文版有「週報」區：列表 `/zh-hant/blog/`，每篇 `/zh-hant/blog/<slug>/`（例：`weekly-4`），只有中文、日文版沒有對應頁。一篇一個檔案 `data/blog/<slug>.html`，檔名就是網址，發布後不改。檔案開頭是一段 JSON：

```
<!--POST {"title":"日本好市多週報#4：…（2026/10/17）","date":"2026-10-17","labels":["好市多","日本物價","週報","詞1","詞2"],"description":"150 字元以內的搜尋說明"}-->
<h2>…</h2><p>…</p>
```

`labels` 剛好 5 個，含固定的「好市多」「日本物價」「週報」；`description` 是頁面的搜尋說明（150 字元以內）；改過內容可加 `"updated":"YYYY-MM-DD"`。正文只用 h2、h3、p、a、strong、small、table、ul，不放 script／style；連到本站用 `/zh-hant/...` 路徑，不用舊的 github.io 網址，原始資料只放文末資料說明。週報先推到分支看預覽，POYU 同意才合併上線。檢查：`node --test tests/blog.test.js`（建置時格式不符也會失敗）。

## 每次更新前的檢查

- 値下げ頁與商品頁過去紀錄只用可公開紀錄，不含社群回報（過去紀錄除外，需標示來源）；不畫走勢圖。

- 商品圖只放 data/product_images.csv 列出的插圖（POYU 畫的示意圖），不放門市照片；頁面標示イメージ。
- `python3 tools/check_categories.py` 沒有錯誤，新商品都有分類。
- `node --test tests/*.test.js` 全部通過；search_aliases.csv 的別名不含真實暱稱或聊天原文。
- 搜尋頁與商品頁沒有任何無商品番号的商品（預覽版也是）。
- 排名頁新的一週加在最上面，舊的週次不移除；本月話題新的一期也保留舊期數，內文數字與紀錄一致。
- 不公開門市照片，聊天內容只有匿名改寫的摘要（沒有真實暱稱、原文或截圖）。商品頁「過去の話題」用編的動物化名（シカさん等），每個商品每週最多 3 則、頁面最多顯示 5 則，資料在 data/item_discussions.json。
- 官網價格只當作「線上商店」這家店的價格，不當原價。官網自動取得的價格只寫取得當天的日期，不寫區間。
- 同店、同商品、同價格、同區間的紀錄視為不同人分享同一張價牌，只留查核程度最高的一筆（已查核 > 待確認 > 待查核）。
- 大量新資料先進預覽版，給 POYU 看過再上線。
- 商品頁和排名頁每家店（含線上商店）只顯示一個價格：最後確認的那一筆，舊紀錄留在資料裡；商品頁下方的收合「過去の記録」另外列出全部公開紀錄。

## 指令

- `python3 tools/import_product_images.py <來源資料夾>`：用 Pillow 匯入已逐張檢視的商品插圖，產生壓縮圖片與索引；不在 Cloudflare 建置時執行。
- `npm run build`：正式版，含已查核與待確認紀錄
- `npm run build:preview`：預覽版，含待查核紀錄，頁面加 noindex
- `npm run build:cf`：Cloudflare Pages 建置入口；`CF_PAGES_BRANCH=main` 建正式版，其他分支（或未設定）建預覽版。固定 `SITE=https://costco.crawlsnek.com`、`BASE=/`，正式版會清除繼承的預覽模式。
- `npm run dev`：本機開發

Cloudflare Pages 連接 GitHub 後，推到 `main` 會自動部署正式版（包括每日爬蟲的提交）；其他分支自動產生預覽網址，含待查核紀錄、預覽橫幅及 noindex，且不送 GA4 統計。Node 版本由 `.node-version` 固定為 22；後台設定 Production branch 為 `main`、Build command 為 `npm run build:cf`、Output directory 為 `dist`。

`public/_headers` 只在 `pages.dev` 主機加 `X-Robots-Tag: noindex`，正式自訂網域不加；正式版的收藏頁仍保留原有 noindex。`/_astro/` 的雜湊檔案可快取一年，HTML 與價格 JSON 不套用此規則。語系路徑、結尾斜線及收藏的 localStorage 鍵名不變。

### 舊網址與搬家順序

舊的 `https://ipliny.github.io/costco-price-jp/` 由 GitHub Pages 的轉址頁轉到新網址，**不要停用 GitHub Pages**。原本 GitHub Pages 自訂網域提供的自動轉址，在清空自訂網域後會改由這些靜態頁接手。轉址保留路徑、query string 與 hash；沒有預建頁面的舊連結由 `404.html` 接手（需要 JavaScript）。這是 HTML／JavaScript 轉址，不是 HTTP 301。

1. 在 Cloudflare Pages 建立 Git 專案並選本 repo，使用上面的建置設定，先檢查 PR 分支預覽。合併前 `main` 尚無 `build:cf`，第一次正式建置失敗不影響既有網站。
2. 審核並同意後合併 PR。GitHub Pages 繼續提供上一次完整網站，但不再接收新價格更新；請在同一天完成第 2–5 步。
3. Cloudflare Pages 的 Custom domains 加入 `costco.crawlsnek.com`，等狀態為 Active，確認網站與搜尋正常。
4. GitHub repo → Settings → Pages，清空 Custom domain 並儲存，GitHub Pages 本身維持啟用。
5. GitHub Actions → **Old URL redirect** → Run workflow（`main`），完成後測試舊首頁、商品頁、繁中頁及搜尋參數。

`redirect-old-url.yml` 只允許手動觸發，且自訂網域未清空時會拒絕執行，避免正式網域轉向自身。它先建置正式版，再由 `tools/make_redirect_stubs.mjs` 讀取所有 `dist/**/index.html` 與 sitemap 的網址，產生 `dist-redirect/`，只上傳轉址頁。一般只需在搬家當天跑一次，後來新增的商品舊連結可由 404 接手。

搬家後另在 Search Console 保留舊資源，新增／驗證 `crawlsnek.com` 網域資源並提交新 sitemap；GA4 資料串流網址改成正式網址，評估 ID 與程式中的驗證碼不變。後台變更由 POYU 操作。

### 還原方式

- Cloudflare Pages 可還原到先前成功的正式部署；GitHub 程式碼不會因此自動還原。若壞版本會再次被推送或每日爬蟲提交觸發，應先處理對應的程式碼變更。
- 若必須退回 GitHub Pages，**先恢復完整網站的部署流程並確認成功，不能把 DNS 指向僅有轉址頁的部署**。本次搬家前的還原點是 `293b25648ebdf9efb3fe82c1155f8ca74ebf48fe`；經 PR 審核還原該版完整網站的 deploy workflow，使用 `SITE=https://costco.crawlsnek.com`、`BASE=/` 建置正式版，上傳 `dist/`。保留後續更新的 `data/`，不要整個 repo reset 到舊日期。
- 完整網站準備好後，再由 POYU 解除 Cloudflare Pages 的自訂網域綁定、在 GitHub Pages 填回 `costco.crawlsnek.com`，將 Cloudflare DNS 的 `costco` 指回 `ipliny.github.io`，確認 HTTPS、日中頁面與搜尋正常。回退期間不要執行 Old URL redirect。

設定依據：[Cloudflare Headers](https://developers.cloudflare.com/pages/configuration/headers/)、[Build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)、[GitHub integration](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/)。

## 流量統計

`src/lib/site.js` 填入 Google Analytics 4 的評估 ID（`GA_ID`）與 Search Console 的驗證碼（`GSC_VERIFICATION`）即可啟用；
填入 `GA_ID` 後頁尾會自動顯示使用分析工具的告知文字。預覽版不送統計。
網站正式網址是 https://costco.crawlsnek.com/ 。網站地圖在 `https://costco.crawlsnek.com/sitemap.xml`，可提交到 Search Console。
