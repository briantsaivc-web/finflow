# FinFlow 內容修改標準作業程序（SOP）
適用：增刪修改 **人物設定／卡片／人生商城／學習內容／參數** 這類「內容」；也涵蓋需要動引擎的情況該怎麼分流。
定案 2026-09-02（v2.27.0-S22）。每次改內容照這份走，不要憑記憶。

---

## 0. 三條鐵律（先背這個）

1. **只改 `src/`，不改產物。** `index.html`、`card_editor.html`、`dist/` 都是 `npm run build` 打出來的；直接改它們，下次打包就被蓋掉，而且 git diff 會是一整坨看不出改了什麼。
2. **金額單位一律「千元」。** 月薪 30＝3 萬、房子 1000＝100 萬。寫 8000 就是 800 萬（S21 獨董車馬費就是這樣炸掉平衡的）。
3. **`main` 永遠是可玩版本。** 沒過測試的東西不進 `main`；GitHub Pages 直接發布 `main`，推上去幾分鐘後全世界都在玩你推的那一版。

---

## 1. 東西在哪裡

| 要改的 | 檔案 | 區段 |
|---|---|---|
| 職業（20 種）、盤面、股票股性、電腦玩家性格 | `src/data/packs/base.json` | `professions` / `boardLayout` / `stockDefs` / `personalities` |
| 夢想卡、生活消費卡、市場卡、人生事件（基礎批） | `src/data/packs/base.json` | `cards.DREAM` / `LIFESTYLE` / `MARKET` / `LIFE_EVENT` |
| 機會卡（小額／大額） | `base.json`（早期批）＋ `v10.json`（十期擴充批） | `cards.OPPORTUNITY_SMALL` / `OPPORTUNITY_LARGE` |
| 特殊機會（要人脈） | `special.json` | `cards.OPPORTUNITY_SPECIAL` |
| 總經／政策／黑天鵝／台灣案例事件 | `m4.json`（＋ `skill.json` 3 張產業變革） | `cards.MACRO_EVENT` |
| 品格帳本 326 張 | `m6.json` | `cards.LIFE_TAPESTRY` |
| 夢想圈事件 | `outer.json` | `cards.OUTER_LIFE` |
| **人生商城** | `mall.json` | `cards.MALL` |
| **學習**：技能、技能情境卡、數位資產、徽章 | `skill.json` | `cards.SKILL` / `LIFE_EVENT`（kind=SKILL_GATE）/ `DIGITAL` / `BADGE` |
| 平衡參數（幾百個開關與數值） | `src/data/config/defaultParams.json` | — |
| 規則本身（新機制、新 op、新決策） | `src/engine/…`、`src/ui/…` | 見 §4 |

完整欄位一覽：`FinFlow_內容盤點_v2.27.0-S22.xlsx`（每張卡每個欄位都攤開了）。
打包順序與檔案清單在 `build/bundle.js` 的 `PACKS_ORDER`——**新增一個 JSON 檔要在那裡登記**，否則不會進遊戲。

---

## 2. 先分級：這個改動是哪一種？

| 級別 | 定義 | 例子 | 誰做 | 要跑什麼 |
|---|---|---|---|---|
| **A 調數值／改文案** | 不新增欄位、不新增 op、不新增 id | 補習班 15→18、改情境文字、把某張卡的 joy 從 2 改 1 | 你自己在卡片工坊或直接改 JSON | §3 全套（約 3 分鐘） |
| **B 新增／刪除卡片，用既有欄位** | 新卡的每個欄位、每個 op 都是引擎已經認得的 | 再加一張商城卡、一張生活卡、一個職業 | 你或 Claude（走 `finflow-card-designer` skill） | §3 全套；刪卡要先過 §3.3 的 id 檢查 |
| **C 需要新機制** | 需要新欄位、新 op、新決策種類、依玩家狀態動態計算的數值 | 「技能分級」「依月薪計價」「N 輪後引爆」「獨立董事」 | **只能走工程書 → 改引擎 → 加測試**；不要硬塞進 JSON | §3 全套＋新增一支 `tests/sXXtest.js` |

分不出來 A/B 還是 C？跑 `node tests/contentcheck.js`：它會用引擎原始碼掃出來的 op 清單比對，**用了引擎沒有的 op 直接 FAIL**——S21 那批 30 張卡有 6 個洞就是這樣被抓的。或照 `finflow-card-designer` skill 第 7 步：先去 `src/engine` 搜關鍵字，查到才算有。

---

## 3. 每次改動的固定流程（A／B 級）

在 `C:\Users\brian\agents\finflow`（或任何一台的工作目錄）：

### 3.1 開工前：同步、開分支
```bash
git pull origin main                 # 先拿最新，避免跟別台電腦／Claude 的版本打架
git checkout -b content/S23-主題     # 一批改動一條分支；主題用中文或英文都可以
npm install                          # 第一次或 node_modules 不在時
```

### 3.2 改內容
- **卡片工坊**（`card_editor.html`，瀏覽器直接開）：選卡包 → 改 → 「匯出 JSON」→ 貼回對應的 `src/data/packs/xxx.json`。它有即時預覽與欄位審計，適合改單張。
- **直接改 JSON**：用 VS Code 開，存檔前確認括號成對。整批新增（例如 10 張卡）用這個。
- 新卡片欄位照**同牌堆現有卡**抄，不要自己發明欄位名。特別注意：
  - 小孩閘門：MALL 寫 `payload.reqChild: true`；LIFESTYLE／LIFE_EVENT 寫 `requiresChildSinceS12: true`（兩個牌堆欄位名不一樣，是歷史包袱）。
  - 總經事件的玩家級 op（CASH_DELTA、SKIP_TURNS…）要明寫 `target`（all／others／self）。
  - 二選一（CHOICE）**第 1 個選項＝建議的那個**：介面會標「建議」、電腦玩家會選它。
  - id 命名跟著牌堆前綴走（`ML_`、`LS`、`OPS_`、`OPL_`、`SKL_`、`BDG_`…），全域不可重複。
  - 有平衡疑慮的數字，優先掛在 `defaultParams.json` 當開關，不要寫死（鐵律 4：開關全關要能重現基線）。

### 3.3 檢查（每一步都要綠，順序不能跳）
```bash
node tests/contentcheck.js           # ① 靜態檢查：JSON 合法、id 唯一、op 引擎認得、欄位名對、量級、程式寫死的 id 還在
npm run build                        # ② 打包：src → index.html + card_editor.html
npm run extract                      # ③ 抽引擎層給 Node 測試用
node tests/gate.js                   # ④ 1000 局壓力：NaN／死結／分錄不平必須全 0（約 30 秒）
node tests/runtests.js               # ⑤ 檔內自我測試 95 條（T-33/T-38/T-49/T-68 專抓內容洞）
node tests/simtest.js                # ⑥ 平衡指紋：三種 NPC 的自由率／破產率，跟上一版比（A 級純文案可略）
```
一句話版：`npm test`（②③④⑤＋介面測試全跑，約 5 分鐘）。

**⑥ 怎麼判讀**：自由率或破產率動超過 3 個百分點，代表這批內容真的改變了難度——不一定是錯，但要寫進變更說明，並且要能說出為什麼。

**刪卡或改 id 之前**：①會列出「引擎／介面寫死了 id」——那些 id 被程式或教學直接引用（例如 `LS12`、`SKL_BOOK`、`ML_INS1`、`PRO_FOUNDER`），刪了程式會炸；要刪就要一起改程式，那是 C 級。

### 3.4 版本號與紀錄（缺一不可，多人連線靠版本字串比對）
1. `src/engine/core/engineCore.js` 的 `ns.BUILD = { ver:"v2.28.0-S23", date:"…" }`
   - 只調數值／文案：第三碼 +1（v2.27.**1**）
   - 新增卡片或機制：第二碼 +1（v2.**28**.0）
2. `package.json` 的 `"version"`
3. `README.md`：第 5 行「目前版本」＋ 版本沿革表加一列
4. `docs/CHANGELOG_S23_vX.Y.Z.md`：改了什麼、為什麼、平衡指紋前後對照、沒做的事
5. 規則有變才需要：`manual/rulebook.html`／`quickstart.html` 改對應段落，`cd manual && node topdf.js` 重產 PDF

### 3.5 交付
```bash
git add -A
git commit -m "S23 主題 vX.Y.Z-S23"      # 訊息開頭放期別＋版本，跟歷史一致
git checkout main && git merge content/S23-主題
git push origin main                     # GitHub Pages 幾分鐘後自動更新
```
推完到 https://briantsaivc-web.github.io/finflow/ 開一局，右下角 ❔ 看版本字串是不是新的——**這一步是 read-back，不能省**。

---

## 4. C 級（要動引擎）怎麼走

1. **概念稿**：現況（附實際查到的函式名／程式片段，不能憑印象）、缺口、要決定的問題。這一步用 `finflow-card-designer` skill 第 7 步的格式。
2. **工程書**（像 `FinFlow_S15工程書` 那樣）：改哪些函式、新欄位語意、NPC 怎麼決策、介面怎麼呈現、驗收條件（AI 可自驗／需你本機試玩）。
3. 實作時同時交：引擎改動 ＋ 內容 JSON ＋ `tests/sXXtest.js`（每條新規則至少一項直接呼叫引擎的測試——鐵律 5：NPC 跑不到的路徑等於沒被測到）。
4. 其餘照 §3.3–3.5。

---

## 5. 委派給 Claude（或任何 AI）時的固定指令書

貼這四段，少一段就會出 S21 那種「有卡片、沒接線」：

1. **目標**：改哪個檔、哪張卡、改成什麼；級別 A/B/C。
2. **驗收條件**：`node tests/contentcheck.js` 0 錯、`gate.js` 全 0、`runtests.js` 95/95、simtest 指紋前後對照表（AI 自驗）；線上版本字串正確（你本機驗）。
3. **回報格式**：變更說明 `.md` 寫檔；改動清單逐張列 id；未預期發現另列。
4. **交叉影響**：同一張卡是否被程式寫死引用（contentcheck ①會列）；同一個參數是否有別的卡在用；改的是不是多人連線會比對的東西（版本字串）。

---

## 6. 出事了怎麼退

| 狀況 | 做法 |
|---|---|
| 推上去才發現壞了 | `git revert HEAD && git push origin main`（不要 reset --hard，歷史要留） |
| 本機改到一半想放棄 | `git checkout -- .`（丟掉未 commit 的改動）或 `git stash` |
| 兩台電腦版本對不上 | 在舊的那台 `git fetch origin && git status` 看落後幾個 commit；沒有本機改動就 `git pull`，有的話先 commit 再 pull 解衝突 |
| 不確定線上是哪一版 | 開遊戲看 ❔ 的版本字串；或 `git log --oneline -1 origin/main` |
| Claude 交的 bundle | `git pull <bundle 路徑> main`（增量 bundle 要接在它標的 commit 之後，`git bundle verify` 會告訴你） |

---

## 7. 每期交付到 Claude 專案的固定組合（沿用既有慣例）

| 產物 | 去處 |
|---|---|
| `FinFlow_Sxx_index.html` | 專案（同時刪上一版，刪前先交回一份） |
| `FinFlow_Sxx變更說明_主題_vX.Y.Z.md` | 專案（永久保留） |
| 內容盤點 xlsx | 只能放 repo 或 Drive（專案知識庫不收二進位） |
