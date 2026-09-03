# 夢想里程碑配圖

這個資料夾放的是**夢想里程碑的配圖**：玩家每推進一點圓夢進度，全服公告會把對應的那張圖秀出來。

目前 **8 個夢想 × 20 張 = 160 張**，全部 1280×720（16:9）WebP，中位檔案大小約 106KB。

## 換掉一張不喜歡的圖

**直接用同檔名覆蓋那個檔案就好。** 不用改任何程式碼、不用重新 `npm run build`、不用發新版本。

```
assets/dreams/dream_peaks/03.webp   ← 覺得這張醜？丟一張新的蓋掉它，重整頁面就換好了
```

這也是刻意把圖放外部檔案、而不是 base64 內嵌進 `index.html` 的唯一理由：內嵌的話換一張圖就要重跑打包、重新發版，而且 `index.html` 會從 1.5MB 漲到 18MB 以上。

> 打包時 `build/bundle.js` 會把整個 `assets/` 複製一份到 `dist/`。所以覆蓋完，如果你是從 `dist/` 部署，記得重跑一次 `npm run build`（只是複製檔案，很快）。

## 資料夾與命名

```
assets/dreams/<夢想資料夾>/<兩位數編號>.webp
```

| 資料夾 | 夢想 | id |
|---|---|---|
| `dream_stars/` | 摘下二十顆米其林星 | `DREAM_STARS` |
| `dream_shops/` | 環島吃遍一百家老店 | `DREAM_SHOPS` |
| `dream_peaks/` | 完登台灣百岳 | `DREAM_PEAKS` |
| `dream_dive/` | 潛遍世界十大潛點 | `DREAM_DIVE` |
| `dream_continent/` | 七大洲都留下腳印 | `DREAM_CONTINENT` |
| `dream_sail/` | 駕帆船橫越太平洋 | `DREAM_SAIL` |
| `dream_school/` | 創辦一所實驗學校 | `DREAM_SCHOOL` |
| `dream_found/` | 成立家族公益基金會 | `DREAM_FOUND` |

編號 `01`–`20` 對應 `src/data/packs/base.json` 裡該夢想 `milestones` 陣列的**位置**，不是「第幾點」——每一局會從這 20 條裡抽 5 條當本局路線，所以同一張圖在不同局可能落在不同的點數上。

資料長這樣，`img` 是**相對於這個資料夾**的路徑：

```json
"milestones": [
  { "t": "玉山主峰｜3,952 公尺", "img": "dream_peaks/01.webp" },
  "純字串的舊格式也還吃得下去（就是沒有圖）"
]
```

## 要重新生成某一張圖？

`data/dream-library-160.json` 是這 160 張圖的**出處紀錄**：每一條都留著當初的 `imagePrompt`、`title`、授權與來源。要重畫哪一張，照著那條的 prompt 去生成，存成同樣的檔名蓋回來就好。

那份 JSON 只是紀錄，**不會被打包進 `index.html`**（不然 prompt 與授權欄位會白白撐大 100KB）。遊戲實際讀的是 `base.json` 裡的 `{t, img}`。

## 規格建議

| 項目 | 值 |
|---|---|
| 格式 | `.webp`（`.jpg` / `.png` 也讀得到，只是檔案大） |
| 尺寸 | 1280×720（16:9）。公告的顯示區會上下裁切 |
| 單檔大小 | **≤ 150KB** |
| 色調 | 遊戲是深色底（`#0E1622` 一帶），太亮太白的圖會刺眼 |

## 圖不見了會怎樣？

**不會壞。** 每一個 `<img>` 都掛了 `onerror`，載不到就把自己移除，公告回到「純文字＋emoji」——也就是 S23 以前的樣子。

所以：

- 只把 `index.html` 單檔丟給別人、沒帶這個資料夾 → 照常可以玩，只是沒圖
- 某張圖檔名打錯、或還沒畫 → 只有那一條沒圖，其他照常
- GitHub Pages 部署 → 這個資料夾要跟著 `index.html` 一起上傳，路徑是相對的

`tests/s24test.js` 有專門一項在守這件事，不要拿掉。
