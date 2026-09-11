# T-001 release-manager 回報：新股抽籤 發版準備（版本號／changelog／build）

- 角色：release-manager
- 範圍：版本號、changelog、build。**未執行 `git commit`／`git push`，未部署 GitHub Pages。**
- 前置條件核對：
  1. QA 報告（`docs/qa/T-001-qa-report.md`）：有條件通過，2 項 Major（T-68、AC5 文字落差）——T-68 已修復（見下）；AC5 是驗收條件文字精確度問題，非程式錯誤，code-reviewer 已確認是既有設計（比照既有股票交易手續費處理方式），不影響本次判定。
  2. code-reviewer（`docs/reports/T-001-code-reviewer-final.md`）：有條件通過，2 項 Major（IPO_SUBSCRIBE 缺破產防呆、規則書手續費文案誤植百分比）——兩項均已由對應角色修復（`docs/reports/T-001-engine-engineer-fix-bankrupt.md`、`docs/reports/T-001-content-writer-fix-fee-text.md`），並經複審判定**通過**。
  3. 製作人已於對話中明確裁示「驗收通過，可以發布」。
  三項前置條件齊備，進入發版流程。

## 結論（3 行內）
1. 版本號定為 **v2.53.0-S45**（前一版 v2.52.0-S44；新機制上線＝升 Y；任務單 `docs/tickets/T-001-新股抽籤.md` 第 6 行已明載「目標版本：S45」），已同步改到 `package.json`、`src/engine/core/engineCore.js` 兩處源頭，並重新 `npm run build` 讓 `index.html`／`dist/index.html`／`card_editor.html` 三個建置產物一併帶上新版號。
2. Changelog 已寫入 `docs/FinFlow_S45變更說明_新股抽籤_v2.53.0.md`，格式對齊最近一份同類文件 `docs/FinFlow_S34變更說明_進修商城升階與右欄瘦身_v2.42.0.md`（S25–S34 慣例；S35–S44 期間該慣例中斷、改用 commit message 承載 changelog，本次依 CLAUDE.md 第 6 節「changelog 寫入 docs/」的明文規定恢復寫檔案）。
3. `npm test` 已重新完整執行兩次（build 前後各一次），逐行核對輸出文字（不只看 exit code）：僅剩 1 項已知失敗（`T-86`，與 T-001 無關，另開票 `docs/tickets/T-003-EXTEND_GAME斷言失敗.md` 追蹤），其餘全過；build 產出正常，`index.html` 較前版 +41,422 bytes（+2.36%），`card_editor.html` +16,384 bytes（+4.65%）。**檔案已準備好一份要 commit 的清單與訊息草稿，尚未執行 `git commit`。**

---

## 1. 版本號決定與依據

- **新版本號：v2.53.0-S45**
  - `X.Y.Z` 的 `Y`（次版本）升級：T-001 是全新機制（新股抽籤），依規則「新機制升 Y」。
  - `S<sprint>`：任務單 `docs/tickets/T-001-新股抽籤.md` 第 6 行明寫「目標版本：S45（版本號由 release-manager 決定）」，且 `package.json` 的 `test:ui` 已掛 `tests/s45test.js`（S1 engine-engineer 建檔時已用此檔名），與任務單的 S45 互相印證，不是我自己臆測接續 S44 之後的假設，是任務單本身已指定。
- **改動的版本號位置**（用 Grep 找齊，逐一確認）：
  | 位置 | 性質 | 處置 |
  |---|---|---|
  | `package.json` 第 3 行 `"version"` | 源頭 | 已改 `2.52.0` → `2.53.0` |
  | `src/engine/core/engineCore.js` 第 91 行 `ns.BUILD.ver` | 源頭（顯示於系統訊息、開局畫面、多人房間版本比對） | 已改 `"v2.52.0-S44"` → `"v2.53.0-S45"`，日期同步改今天 `2026-09-11` |
  | `index.html` / `dist/index.html` / `card_editor.html` | build 產物（`build/bundle.js` 從上述源頭重新產生，不手改） | 已跑 `npm run build` 重新產生，確認新版號已寫入 |
- **追加處置（製作人裁示後）**：`manual/rulebook.html`（封面 `v2.32.3-S25d`、頁尾 `v2.24.0-S19`）與 `manual/quickstart.html`（封面 `v2.32.3-S25d`、頁尾 `v2.32.3-S25d`）原判斷為超出 T-001 範圍、留待製作人決定（見原「未預期發現 1」）。製作人已於對話中明確裁示「更新為本次發布的正式版本號 v2.53.0-S45」，已執行：
  | 檔案 | 位置 | 舊值 | 新值 |
  |---|---|---|---|
  | `manual/rulebook.html` | 第 8 行（封面 tag） | `v2.32.3-S25d` | `v2.53.0-S45` |
  | `manual/rulebook.html` | 第 469 行（頁尾） | `v2.24.0-S19` | `v2.53.0-S45` |
  | `manual/quickstart.html` | 第 9 行（封面） | `v2.32.3-S25d` | `v2.53.0-S45` |
  | `manual/quickstart.html` | 第 94 行（頁尾） | `v2.32.3-S25d` | `v2.53.0-S45` |
  用 `Grep` 對兩檔全文搜尋 `v2\.\d+\.\d+(-S\d+[a-z]?)?` 確認無遺漏，命中皆已改為 `v2.53.0-S45`。頁尾日期（`2026-08-30`）不在製作人「版本標籤」指示範圍內，維持原樣未動（純日期字串，非版本號）。改動前已確認 git 工作區狀態（`git status`），這兩檔本來就因 T-001 內容更新處於 modified 狀態，本次版本標籤更新疊加在既有改動上，不需另外備份（整個 sprint 尚未 commit，git 本身即可回復）。純文字置換未動任何 HTML 標籤結構，已用 Node 腳本核對 `<html>`／`</html>`、`<body>`／`</body>` 各 1 開 1 合，結構完整；未涉及 engine／ui 程式邏輯，不需重跑 `npm test` 全套（manual/ 不在任何測試涵蓋範圍內，`npm test` 不讀取此目錄）。

## 2. Changelog

- 檔案：`docs/FinFlow_S45變更說明_新股抽籤_v2.53.0.md`
- 找既有慣例的過程：`docs/CHANGELOG_S*.md` 系列在 S24（`v2.31.0`）之後就沒有再新增；接手的是 `docs/FinFlow_S25變更說明_...md` 到 `docs/FinFlow_S34變更說明_...md`（`v2.32.0`–`v2.42.0`）這個命名與格式；S35–S44 期間這個慣例又中斷，changelog 內容改成只寫在 git commit message 裡（用 `git log` 核對過 S35–S44 十次 commit，皆未新增對應 changelog 檔）。因為 CLAUDE.md 第 6 節明文規定「changelog 寫入 `docs/`」是最高規範，優先於近期中斷的習慣，本次選擇**恢復寫檔案**，格式完全比照最近一份範例（`FinFlow_S34變更說明...md`）的章節結構（版本資訊／一句話摘要／分節說明／測試結果表／動到的檔案表）。
- 內容摘要（章節）：①機制總覽（申購／抽籤／結算）②電腦與真人雙路徑 ③多人同步 ④平衡影響摘要（引用 `docs/balance/T-001-balance.md` 數字）⑤過程中修正的問題（T-68、code-reviewer 兩項 Major）⑥已知遺留問題（T-002／T-003，不擋本次發布）⑦測試結果 ⑧動到的檔案清單。內容全部整理自任務單、ADR、各角色回報與 QA／code-reviewer 報告，未自行補寫或臆測功能描述。

## 3. 測試證據（重新實測，逐行核對輸出文字）

### 3.1 版本號變更前（確認出發點乾淨）
```
$ npm test   （完整跑一次，483 行輸出）
test:engine → {"errors":0,"warnings":3}／{"games":1000,"NaN":0,"Infinity":0,"invalidGames":0,"invalidReasons":{},"assetLedgerMismatch":0}
test:ui → runtests.js 首行 {"pass":96,"total":97}
grep "❌" 全檔命中僅 1 筆：
  ❌ T-86 S14b 回合上限與延長（EXTEND_GAME） :: 續攤不得重算超過一位玩家的現金（發薪只該發給接回的那一位）
```
（T-68 未再出現，確認 `docs/reports/T-001-ui-engineer-fix-T68.md` 的修復已在工作區生效。）

### 3.2 版本號變更＋`npm run build` 後
```
$ npm run build
內容包 11 個／卡片 750 張／職業 20／引擎 op 123 種／程式寫死 id 150 個
{"errors":0,"warnings":3}
[FinFlow Bundle] Build successful! Written to index.html and dist/index.html
[FinFlow Bundle] assets/ copied to dist/ (320 dream images)
[FinFlow Bundle] card_editor.html rebuilt from src/data (11 packs, 123 ops)
```
`grep -n "v2.53.0-S45" index.html` → 命中 `728:ns.BUILD = { ver:"v2.53.0-S45", date:"2026-09-11" };`（`dist/index.html` 同步命中）。

### 3.3 版本號變更後，完整 `npm test` 再跑一次（確認版號改動未引入新失敗）
```
$ npm test > npmtest_final.log 2>&1; echo "EXITCODE:$?"
EXITCODE:0
```
`grep -n "❌\|\"fail\":[1-9]"` 全檔（483 行）僅 1 筆命中，與 3.1 完全相同的那一則 T-86，未新增任何失敗。`s45test.js` 兩段（S1 18 項含破產防呆 ⑤d、S2 UI 5 項）與 `tests/editortest.js`（13 項，含 `IPO_POOL` 編輯）皆 `fail:0／pageErrors:0`，逐行輸出見 `docs/FinFlow_S45變更說明_新股抽籤_v2.53.0.md` 第 7 節摘錄；完整 log 存於本機 scratchpad（未入版控）。

## 4. Build 結果

| 檔案 | 前版（`git show HEAD:`） | 本次 | 差異 |
|---|---|---|---|
| `index.html` | 1,754,183 bytes | 1,795,605 bytes | **+41,422 bytes（+2.36%）** |
| `card_editor.html` | 352,262 bytes | 368,646 bytes | **+16,384 bytes（+4.65%）** |
| `dist/index.html`（gitignore，不進版控） | — | 1,795,605 bytes | 與 `index.html` 一致 |

差異來源與 T-001 內容量級相符（新增 35 張 `IPO_POOL` 卡片、21 個新參數、約 700 行新增程式碼、卡片工坊新增欄位與說明文字）。

## 5. 發版前檢查清單

| 項目 | 結果 |
|---|---|
| 全部測試通過（重跑，附輸出） | ✅ 見上方第 3 節；唯一剩餘失敗 `T-86` 與 T-001 無關、已有獨立追蹤票 `docs/tickets/T-003-EXTEND_GAME斷言失敗.md`，製作人已於 2026-09-10 裁示「開新票，不擋 T-001 收尾」 |
| 版本號在所有位置一致 | ✅ `package.json`／`engineCore.js`／`index.html`／`dist/index.html` 四處皆為 `2.53.0`／`v2.53.0-S45`；`card_editor.html` 本身不顯示版本字串（工坊頁面無此欄位，非遺漏） |
| changelog 已寫 | ✅ `docs/FinFlow_S45變更說明_新股抽籤_v2.53.0.md` |
| 舊存檔載入測試通過 | ✅ `tests/s45test.js` ⑨（`ns.replay` 重放，config 無 `ipoLottery` 時不觸發、逐位元一致）；`tests/qa-ipo-exploratory-test.js` 邊界⑦（真的 `delete cfgOld.ipoLottery`，非只是設 0）15 輪不觸發，兩者本次皆隨 `npm test`／獨立執行重新驗證通過 |
| 沒有殘留的『文案待補』或 TODO 佔位 | ✅ 已用 Grep 掃過本次改動的 `manual/rulebook.html`、`manual/quickstart.html`、`src/editor/cardEditor.html`，無命中 |
| 備份檔（`*.backup.*`）未被納入 build | ✅ `build/bundle.js` 只讀寫死列出的檔案清單（`SCRIPTS_ORDER`／`PACKS_ORDER`／`shell_template.html`／`styles.css`／`cardEditor.html`），不做目錄掃描，不可能誤收 `*.backup.*`；另用 `grep -c "backup" index.html` 確認為 0；且 `.gitignore` 第 19–20 行已排除 `*.backup.*`／`*.backup2.*`，本次相關的 9 個備份檔（`manual/*.backup.20260910`、`defaultParams.json.backup.20260910`、`v10.json.backup.20260910`、`engineCore.js.backup.202609{06,07}`、`syncAdapter.js.backup.202609{07,10}`、`uiViews.js.backup.20260910`）均不在 git 追蹤範圍內 |

全部打勾，可交付。

## 6. 準備要 commit 的檔案清單（尚未執行 `git add`／`git commit`）

### 修改（tracked，含本次 build 產物）
```
manual/quickstart.html
manual/rulebook.html
package.json
src/data/config/defaultParams.json
src/data/packs/v10.json
src/editor/cardEditor.html
src/engine/core/engineCore.js
src/engine/reducer/applyAction.js
src/network/syncAdapter.js
src/ui/uiCore.js
src/ui/uiViews.js
tests/editortest.js
index.html          （npm run build 產物，本次起保留變更）
card_editor.html    （npm run build 產物，本次起保留變更）
```
（`dist/index.html` 由 `.gitignore` 排除，不進 commit，屬正常現象。）

### 新增（untracked → 本次一併納入）
```
tests/s45test.js
tests/qa-ipo-exploratory-test.js
tests/qa-ipo-resolution-test.js
tests/qa-ipo-showoffer-test.js
docs/adr/ADR-001-新股抽籤.md
docs/balance/T-001-balance.md
docs/qa/T-001-qa-report.md
docs/reports/T-001-balance-designer-S3.md
docs/reports/T-001-code-reviewer-final.md
docs/reports/T-001-content-writer-fix-fee-text.md
docs/reports/T-001-content-writer-quickstart.md
docs/reports/T-001-content-writer-S4.md
docs/reports/T-001-engine-engineer-fix-bankrupt.md
docs/reports/T-001-engine-engineer-fix-T68.md
docs/reports/T-001-engine-engineer-S0.md
docs/reports/T-001-engine-engineer-S1.md
docs/reports/T-001-network-engineer-S5.md
docs/reports/T-001-ui-engineer-fix-T68.md
docs/reports/T-001-ui-engineer-S2.md
docs/tickets/T-001-新股抽籤.md
docs/tickets/T-001/dispatch.md
docs/tickets/T-002-測試斷言吞錯誤碼.md
docs/tickets/T-003-EXTEND_GAME斷言失敗.md
docs/FinFlow_S45變更說明_新股抽籤_v2.53.0.md   （本次新增的 changelog）
docs/reports/T-001-release-manager.md          （本檔）
scratch/ipo-mp-sync-test.js                    （S5 network-engineer 網路同步驗證腳本；製作人裁示保留進版控，原地留在 scratch/，不移進 tests/）
```

### 刻意排除、不建議這次 commit（列出請你與製作人確認）
```
.claude/
CLAUDE.md                       （根目錄，非 src/ 內版本，疑為本機新增，非 T-001 產出）
Claude outputs/
FinFlow_*.patch（根目錄 11 個檔）
FinFlow_外商管顧極限勝率實戰手冊.md、FinFlow_全20職業勝率天梯與實戰破解手冊.md、
  FinFlow_測試差異分析與除錯工程實踐指南.md、FinFlow_除錯與測試完整報告.md（根目錄）
FinFlow_Gemini對齊Claude覆驗結論與S42修復工程建議_2026-09-06.md
_s26_backup/
s35_delivery/
scratch/ 下除 ipo-mp-sync-test.js 以外的其餘 12 個檔案（與 T-001 無關，見「未預期發現」）
docs/FinFlow_S33提案_三門技能數值與高階兌現_討論稿.md
```
（`scratch/ipo-mp-sync-test.js` 本身已改列入上方「新增」清單，經製作人裁示保留進版控、原地留在 `scratch/`。）

## 7. 建議的 commit 訊息草稿（繁體中文，含版本號與任務單編號）

```
T-001：新股抽籤（市場雙檔公開申購）v2.53.0-S45

一局隨機開 1–2 次新股申購，全場玩家（含非回合真人、電腦玩家）可申購
小資／股王兩檔，中籤率＝r÷預期價差率（越好賺越難抽）。中籤當下自動
賣出，實現價差或破發損失；電腦玩家依保留現金水位決定是否申購。

- 引擎：E.ipoRoll（雜湊決定論排程與抽籤）、IPO_SUBSCRIBE/IPO_DECLINE
  （比照 JOIN/DECLINE_SYNDICATE，全場非回合可回應）、結算接在 S39
  集資之後、破產者先退款再清算
- 介面：IPO_ANNOUNCE 決策卡、交易所「新股申購中」列、淨值面板申購
  預扣款、卡片工坊 IPO_POOL 可編輯
- 多人：申購/結算全走雜湊不吃主亂數流，經真實網路路徑驗證兩端逐
  位元一致
- 內容：IPO_POOL 新增 35 張虛構公司卡（小資 20／股王 15），規則書
  新增 §8.10
- 平衡（3種子×500局 A/B對照）：全局節奏無明顯位移，三種電腦性格
  自由率變化在 ±1pp 內，機制本身符合稀有博弈點綴定位（詳見
  docs/balance/T-001-balance.md）
- 修正 code-reviewer 兩項 Major：IPO_SUBSCRIBE 補破產防呆
  （已畢業玩家可申購為製作人裁示的既定行為）；規則書手續費文案
  修正為固定金額（20 元／50 元），不再誤植為百分比
- 修正 T-68：IPO_POOL 屬展示用牌堆，排除於「沒小孩不該有小孩帳單」
  關鍵字掃描之外
- 已知遺留、另開票追蹤、不擋本次發布：T-002（runtests.js 斷言失敗
  不影響 exit code）、T-003（既有的 T-86 EXTEND_GAME 斷言失敗，與
  本次改動無關）
- 製作人裁示一併處理：規則書／快速上手指南版本標籤同步更新為
  v2.53.0-S45（原分別停留在 v2.32.3-S25d／v2.24.0-S19，已落後
  10+ 版）；保留 scratch/ipo-mp-sync-test.js（S5 network-engineer
  網路同步驗證腳本）進版控，原地留在 scratch/

任務單：docs/tickets/T-001-新股抽籤.md
ADR：docs/adr/ADR-001-新股抽籤.md
QA：docs/qa/T-001-qa-report.md（有條件通過，2 項 Major 已解決）
Code Review：docs/reports/T-001-code-reviewer-final.md（複審通過）
Changelog：docs/FinFlow_S45變更說明_新股抽籤_v2.53.0.md

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
```

## 8. 未預期發現

1. **（已處理）`manual/rulebook.html`／`manual/quickstart.html` 的版本標籤長期未跟著發版遞增**（原分別停在 `v2.32.3-S25d`／`v2.24.0-S19`／`v2.32.3-S25d`／`v2.32.3-S25d`，已經落後 main 分支 10+ 個版本）。這不是本次 T-001 造成，content-writer 在 S4 報告已經記錄同一件事但判斷不在自己權限內。**製作人已於對話中明確裁示更新為 `v2.53.0-S45`，已執行**，見第 1 節「追加處置」表格。
2. **Changelog 慣例本身在 S35–S44 期間中斷過**（改成只寫 commit message，未寫 `docs/` 檔案），本次依 CLAUDE.md 第 6 節明文規定「changelog 寫入 `docs/`」的最高規範，主動恢復寫檔案慣例。這代表本次 changelog 檔案格式是接續 S34 那一版的樣式，中間 S35–S44 那十版的內容目前完全沒有對應的 `docs/` changelog 檔（只存在於各自的 commit message），這不是本次任務要補的缺口，僅供製作人知悉。
3. **（已處理）`scratch/` 目錄混雜了本次 T-001 相關與完全無關的內容**：`scratch/ipo-mp-sync-test.js`（2026-09-10，network-engineer S5 的一次性網路同步驗證腳本）與另外 12 個檔案（`grid_search_consultant.js`、`simulate_all_20_professions.js` 等，時間戳 2026-09-05／06，內容看名稱像是另一個管顧職業平衡分析、與 T-001 無關）混在同一個未追蹤目錄。**製作人已明確裁示保留 `ipo-mp-sync-test.js` 進版控、原地留在 `scratch/`（不移進 `tests/`）**，已改列入第 6 節「新增」清單；其餘 12 個與 T-001 無關的檔案維持排除。
4. **`docs/templates/ADR.md` 與 `docs/FinFlow_S33提案_三門技能數值與高階兌現_討論稿.md` 未列入本次 commit 清單**：前者看起來是通用的 ADR 撰寫範本（非 T-001 特定內容，時間戳 2026-09-07，早於 T-001 任務單的 2026-09-10），後者是 S33（已於多版本前上線）的討論稿、非本次 sprint 產出。兩者都不在你訊息裡明確列出的「這次 sprint 新建的文件」清單中，我判斷不屬於 T-001 合法變更範圍，**沒有納入**，如果判斷有誤請指正。
5. **`.claude/hooks/check-forbidden.sh` 對 `src/engine/core/engineCore.js` 第 3 行規則說明註解的誤報**：本次編輯 `package.json`／`engineCore.js` 與新建 changelog 檔時都各觸發一次同一則誤報（命中的是描述「鐵律一」的註解文字本身，不是真的呼叫 `Date.now()`／`Math.random()`），這是 S0～QA 六份以上報告已經重複記錄過的既有 hook 誤判，本次沒有進一步處理（不在 release-manager 權限範圍，且不影響任何檔案實際寫入結果，已逐一確認 Edit／Write 都回報成功）。

## 9. 需要製作人決定的事

1. ~~是否要一併修正 `manual/rulebook.html`／`manual/quickstart.html` 的版本標籤~~ **已由製作人裁示並執行**（更新為 `v2.53.0-S45`，見第 1 節）。
2. ~~`scratch/ipo-mp-sync-test.js` 是否要保留進版控~~ **已由製作人裁示並執行**（保留、原地留在 `scratch/`，已列入第 6 節「新增」清單）。
3. **確認本回報第 6 節「準備要 commit 的檔案清單」與排除清單是否同意**，同意後由製作人執行 `git add` 與 `git commit`（依任務指示，release-manager 本次不執行 `git add`／`git commit`／`git push`）。
4. **push 與 GitHub Pages 部署**：本次任務範圍明確只到 build 為止，push 與部署需要製作人另外明確同意，不在本次回報範圍內請示。
