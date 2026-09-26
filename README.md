# costco-price-jp

日本 Costco 各倉庫店的價格觀測紀錄網站（Astro 靜態網站，部署在 GitHub Pages）。

## 資料

所有紀錄在 `data/observations.csv`，一列一筆觀測。

- `review_status` 為「已查核」的紀錄才會出現在正式站；「待查核」只出現在預覽版。
- 網站不公開原始照片，只標示來源類型與店別。店別以素材所在的店資料夾為準。
- `note` 只有資訊性文字（例如「特別価格」）的紀錄可列為已查核；有待確認事項的保留為待查核。

### 觀測區間

`period_from`／`period_to` 是「這段期間內曾看到這個價格」，不是整段期間每天的售價。

- 2026-09-12 至 2026-09-25 的首批素材，區間一律記為這兩週。
- 之後每週查價 2–3 次，每一批的區間記為「上次查價日的隔天」到「本次查價日」；能確定拍攝日時，`period_from` 與 `period_to` 都記拍攝日。
- 同一個原始檔（`evidence_sha256` 相同）重複上傳時不新增紀錄；不同日期重新拍到同價的商品，則新增一筆，區間用新的查價日期。

## 指令

- `npm run build`：正式版，只含已查核紀錄
- `npm run build:preview`：預覽版，含待查核紀錄，頁面加 noindex
- `npm run dev`：本機開發

推到 `main` 會由 GitHub Actions 自動部署到 GitHub Pages。
