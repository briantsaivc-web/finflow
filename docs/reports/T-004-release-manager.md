# T-004 release-manager 回報：新股公告通知不足 發版準備（版本號／changelog／build）

- 角色：release-manager
- 範圍：版本號、changelog、build。**未執行 `git commit`／`git push`，未部署 GitHub Pages。**
- 前置條件核對：
  1. QA 報告（`docs/qa/T-004-qa-report.md`）：**通過**，無 Blocker／Critical／Major／Minor bug。
  2. code-reviewer（`docs/reports/T-004-code-reviewer-final.md`）：**通過**（無 Blocker；1 項 Major——`mpForceLeaveWhy` 不認 off-turn 懸置決策——已由製作人裁示開新票 T-006 追蹤，不擋本次）。
  3. 製作人於本輪對話中明確表示「T-004 已完成製作人驗收，依 CLAUDE.md 第 6 節流程……現在輪到你」，視為滿足「驗收通過，可以發布」的前置條件。
  三項前置條件齊備，進入發版流程。

## 結論（3 行內）

1. 版本號定為 **v2.53.1-S46**（前一版 v2.53.0-S45；本次是修一個「剛上線新機制配套的既有架構缺陷」＝bug 修復，升 `Z`；沒有任務單指定 sprint 序號，判斷 S45 已發版且已 push，本次是獨立完整的一輪工程/QA/審查週期，另編 S46），已改到 `package.json`、`src/engine/core/engineCore.js`、`manual/rulebook.html`、`manual/quickstart.html` 四處，並重新 `npm run build` 讓 `index.html`／`dist/index.html`／`card_editor.html` 三個建置產物同步帶上新版號。
2. Changelog 已寫入 `docs/FinFlow_S46變更說明_新股公告通知不足修復_v2.53.1.md`，格式對齊上一份同類文件 `docs/FinFlow_S45變更說明_新股抽籤_v2.53.0.md`。
3. `npm test` 本次重新完整執行（build 前後各一次），**逐行核對輸出文字，不只看 shell 層 exit code**（因為連我自己第一次用 `cmd; echo EXITCODE:$?` 的寫法都親自踩到「殼層回報 0 但那只是 echo 自己的退出碼」這個陷阱，改成把 `echo EXITCODE` 一併寫進同一個檔案才拿到真正的 npm test 退出碼，過程記錄在下方「測試證據」）：**唯一失敗項是 `tests/s22test.js` 一項寫死 4 秒門檻的模擬器速度計時測試**（本機環境量到 4076–5338ms），已用 `git stash` 驗證與本次 T-004 改動完全無關（HEAD 上、未套用任何 T-004 改動時同樣超時），判斷不阻擋本次發布；與 T-004 直接相關的所有測試（`applyAction.js`／`uiCore.js`／`uiViews.js`／`s45test.js`／`s18test.js`／`runtests.js`）逐一重跑全數 PASS。Build 產出正常，`index.html` 較前版 **+4,264 bytes（+0.24%）**，`card_editor.html` 無變化（本次未動 `src/data/`）。**檔案已準備好一份要 commit 的清單與訊息草稿，尚未執行 `git commit`。**

---

## 1. 版本號決定與依據

- **新版本號：v2.53.1-S46**
  - `X.Y.Z` 的 `Z`（修訂版）升級：任務指示本身已明確定性「這是修一個『剛上線新機制配套的既有架構缺陷』的 bug 修復，不是全新機制」，依 CLAUDE.md 第 6 節「修 bug 升 Z」的規則，升 `Z`：`2.53.0` → `2.53.1`。
  - `S<sprint>`：`docs/tickets/T-004-新股公告通知不足.md`、`docs/tickets/T-004/dispatch.md` 均未指定目標 sprint 序號（不同於 T-001 任務單第 6 行明寫「目標版本：S45」）。判斷依據：
    1. 上一版 `v2.53.0-S45` 已經完整走過發版流程（release-manager 已 build、製作人已裁示驗收通過並 push 到 `origin/main`，見 `docs/reports/T-001-release-manager.md`、commit `6b9bb0a`）。
    2. T-004 是在 S45 發布**之後**才由製作人實機回報，經 architect 開票、完整走過 S1（engine-engineer）／S3（ui-engineer）／S4（engine-engineer 收尾）／QA／code-reviewer 五段獨立週期，規格與驗證強度等同一個完整 sprint，不是「S45 收尾時順手夾帶的小修」。
    3. 對照既有先例：`T-002+T-003`（commit `5a06845`）雖然也是 S45 發布後的修復，但**完全沒有 bump 版本號**（仍留在 `v2.53.0-S45` 字面上），這代表前一輪並未把它們視為獨立一版；但那兩張票本身範圍極小（測試框架 exit code、單一既有斷言追平設計），且未見對應的 release-manager 回報或 changelog（`docs/` 下沒有 T-002/T-003 專屬 changelog 檔案）——**判斷那一次可能沒有正式走 release-manager 流程**，不能當作「T-004 也不該 bump」的先例；相反，任務本身明確要求我「決定這次 T-004 對應的新版本號」，且 T-004 的嚴重度（Critical，核心機制對真人玩家實務上不存在）與驗證完整度都遠高於 T-002/T-003，我判斷應該給予獨立版本號與 sprint 序號，比照 S25b/c/d（`v2.32.1`／`v2.32.2`／`v2.32.3`）這類「同一機制的快速追加修復」曾經有專屬 changelog 與版本號的慣例精神。
    4. 在「延用 `S45b`」與「另編 `S46`」之間，我選擇 **`S46`**：`S45` 本身已經是「已發布、已 push」的完結版本號，T-004 不是 S45 尚未收尾的延伸（S45 收尾時的延伸是 T-002/T-003，且那兩張已經處理完、已 push），而是**發布之後**新開的一輪獨立工程週期（有自己的 ADR 補充裁決 1、2，有自己的 QA 報告、code-reviewer 報告），用連續遞增的 `S46` 更符合「sprint 序號代表工作週期」的語意，避免跟已經定案、已推送的 `S45` 標籤混淆。
  - **這個判斷不是任務單明載的事實，是我依 CLAUDE.md 規則與現有先例推論出來的決定**，如果製作人認為應該是 `S45b`（延續同一發布事件）而非 `S46`（獨立新 sprint），請指正，我會照改（純標籤字串置換，不影響任何程式邏輯或測試結果）。
- **改動的版本號位置**（用 `Grep "v2\.53\.0-S45"` 全專案找齊，逐一確認，排除歷史文件不動）：
  | 位置 | 性質 | 處置 |
  |---|---|---|
  | `package.json` 第 3 行 `"version"` | 源頭 | 已改 `2.53.0` → `2.53.1` |
  | `src/engine/core/engineCore.js` 第 91 行 `ns.BUILD.ver` | 源頭（顯示於系統訊息、開局畫面、多人房間版本比對） | 已改 `"v2.53.0-S45"` → `"v2.53.1-S46"`，日期同步改今天 `2026-09-12` |
  | `manual/rulebook.html` 第 8 行（封面 tag）、第 469 行（頁尾） | 顯示文字 | 已改為 `v2.53.1-S46`（頁尾日期字串維持原樣，非版本號） |
  | `manual/quickstart.html` 第 9 行（封面）、第 94 行（頁尾） | 顯示文字 | 已改為 `v2.53.1-S46` |
  | `index.html` / `dist/index.html` / `card_editor.html` | build 產物（`build/bundle.js` 從上述源頭重新產生，不手改） | 已跑 `npm run build` 重新產生，`grep -n "v2.53.1-S46" index.html` 命中 `728:ns.BUILD = { ver:"v2.53.1-S46", date:"2026-09-12" };`；`tests/s22test.js`「版本與單檔完整性」一項也已驗到新版號 |
  - 排除不動：`docs/tickets/T-004-新股公告通知不足.md`（歷史回報原文引用 `v2.53.0-S45` 描述 bug 發生時的版本，屬事實記錄不應改）、`docs/reports/T-001-release-manager.md`、`docs/FinFlow_S45變更說明_新股抽籤_v2.53.0.md`（皆為前一版的既有歷史文件）。
  - `.claude/hooks/check-forbidden.sh` 對 `engineCore.js`／`manual/*.html` 的編輯各觸發一次誤報（命中的是描述「鐵律一」的既有註解文字，不是真的呼叫 `Date.now()`／`Math.random()`），與 T-001 release-manager 報告記錄的既有 hook 誤判相同，已逐一確認每次 Edit 皆回報成功、內容正確。

## 2. Changelog

- 檔案：`docs/FinFlow_S46變更說明_新股公告通知不足修復_v2.53.1.md`
- 格式：完全比照上一份範例（`docs/FinFlow_S45變更說明_新股抽籤_v2.53.0.md`）的章節結構（版本資訊／一句話摘要／現象／根因／修復內容／已知遺留另開票／過程中受阻與裁決／code-reviewer／QA／平衡影響／測試結果／未預期發現／動到的檔案）。
- 內容摘要：①原始現象（製作人 2026-09-11 實機回報原話摘要）②根因（`E.openIpo` 只推觸發者本人＋本次改動意外挖出的兩個既有 UI／測試缺口）③修復內容（S1 engine 廣播式推卡、S3 三處通用 UI 修法 A/B/C、追加授權的 `s18test.js` 修法、S4 收尾驗證）④已知遺留（T-005、T-006，不擋本次）⑤過程中的受阻與裁決紀錄⑥code-reviewer 與 QA 結論摘要⑦平衡影響（無）⑧測試結果（含本次發現的既有計時測試 flake）⑨未預期發現⑩動到的檔案清單。內容全部整理自任務單、ADR 補充裁決 1／2、各角色回報與 QA／code-reviewer 報告，未自行補寫或臆測功能描述。

## 3. 測試證據（重新實測，逐行核對輸出文字，不只看 shell exit code）

### 3.1 版本號變更前（確認出發點與工程師/QA 回報一致）

用背景工作執行 `npm test > log 2>&1; echo "EXITCODE:$?"`（第一次嘗試，**這個寫法本身就是個陷阱**——`echo` 在重導向範圍外，殼層工具回報的「exit code 0」只是 `echo` 自己的退出碼，不是 `npm test` 的真實退出碼；我沒有輕信這個「0」，改用 `tasklist` 確認背景程序仍在跑、等它真正跑完後直接讀 log 檔內容逐行核對）：

```
test:engine → {"errors":0,"warnings":3} ／ {"games":1000,"NaN":0,"Infinity":0,"invalidGames":0,"invalidReasons":{},"assetLedgerMismatch":0}
test:ui → runtests.js {"pass":97,"total":97}；s17 {"pass":108,"fail":0}；s18 {"pass":20,"fail":0}；s19 {"pass":16,"fail":0}；s20 {"pass":32,"fail":0}；
          s22test.js：FAIL 模擬器速度：20 局 < 4 秒（20 局花了 5338ms） → {"pass":15,"fail":1,"pageErrors":0}
```
鏈式 `&&` 在 `s22test.js` 中斷，後面 `s23…s45／editortest` 沒機會執行。

**用 `git stash` 驗證這項 FAIL 與 T-004 無關**：把工作區還原成 T-004 改動前的 `5a06845`（`v2.53.0-S45` 基準）重跑 `node tests/s22test.js`，**同樣 FAIL**（20 局花了 4136ms），證實是既有測試門檻對本機當前速度過緊，不是本次 diff 造成。`git stash pop` 還原工作區後繼續下面的驗證。

### 3.2 版本號變更＋`npm run build` 後

```
$ npm run build
內容包 11 個／卡片 750 張／職業 20／引擎 op 123 種／程式寫死 id 150 個
{"errors":0,"warnings":3}
[FinFlow Bundle] Build successful! Written to index.html and dist/index.html
[FinFlow Bundle] assets/ copied to dist/ (320 dream images)
[FinFlow Bundle] card_editor.html rebuilt from src/data (11 packs, 123 ops)
```
`grep -n "v2.53.1-S46" index.html` → 命中 `728:ns.BUILD = { ver:"v2.53.1-S46", date:"2026-09-12" };`。

### 3.3 版本號變更後，完整 `npm test` 再跑一次（這次把 `echo EXITCODE` 也寫進同一個 log 檔，避免重蹈 3.1 的陷阱）

```
$ npm test > npmtest_final.log 2>&1; echo "EXITCODE:$?" >> npmtest_final.log
```
log 檔最後一行：**`EXITCODE:1`**（真實退出碼，非殼層工具自己的回報）。逐行核對整份輸出：
```
{"errors":0,"warnings":3}／{"games":1000,"NaN":0,"Infinity":0,"invalidGames":0,"invalidReasons":{},"assetLedgerMismatch":0}
runtests.js {"pass":97,"total":97}
s17 {"pass":108,"fail":0}
s18 {"pass":20,"fail":0}
s19 {"pass":16,"fail":0}
s20 {"pass":32,"fail":0}
s22test.js：OK 版本與單檔完整性 v2.53.1-S46 ／ FAIL 模擬器速度：20 局 < 4 秒（20 局花了 5219ms） → {"pass":15,"fail":1,"pageErrors":0}
```
鏈式在此中斷，唯一新增失敗仍是同一項計時測試（與 3.1 相同、與 T-004 無關）。

### 3.4 補跑鏈式中斷後剩下的所有測試檔（逐一單獨執行，確認沒有第二個隱藏的回歸）

```
s23test {"pass":21,"fail":0,"pageErrors":0}
s23btest {"pass":21,"fail":0,"pageErrors":0}
s23ctest {"pass":18,"fail":0,"pageErrors":0}
s24test {"pass":12,"fail":0,"pageErrors":0}
s26test {"pass":22,"fail":0,"pageErrors":0}
s27test {"pass":32,"fail":0,"pageErrors":0}
s28test {"pass":14,"fail":0,"pageErrors":0}
s29test {"pass":10,"fail":0,"pageErrors":0}
s30test {"pass":12,"fail":0,"pageErrors":0}
s31test {"pass":8,"fail":0,"pageErrors":0}
s31btest {"pass":11,"fail":0,"pageErrors":0}
s32test {"pass":17,"fail":0,"pageErrors":0}
s33test {"pass":17,"fail":0,"pageErrors":0}
s34test {"pass":13,"fail":0,"pageErrors":0}
s35test {"pass":19,"fail":0,"pageErrors":0}
s37test {"pass":9,"fail":0,"pageErrors":0}
s38test {"pass":5,"fail":0,"pageErrors":0}
s39test {"pass":8,"fail":0,"pageErrors":0}
s40test {"pass":8,"fail":0,"pageErrors":0}
s41test {"pass":24,"fail":0,"pageErrors":0}
s42test {"pass":11,"fail":0,"pageErrors":0}
s43test {"pass":12,"fail":0,"pageErrors":0}
s44test {"pass":5,"fail":0,"pageErrors":0}
s45test {"pass":19,"fail":0,"pageErrors":0}（S1）／{"pass":5,"fail":0,"pageErrors":0}（S2，含 D5-1c（T-004）與 fixture 修正）
editortest {"pass":13,"fail":0,"pageErrors":0}
```
**全部 `fail:0`／`pageErrors:0`，除了 3.1/3.3 提到的那一項既有計時 FAIL，沒有任何其他回歸。**

### 3.5 多人連線既有回歸腳本

```
node tests/mptest.js → 8 項 OK，0 FAIL，no page errors
node tests/mp2.js    → 9 項 OK，0 FAIL，no page errors
```

## 4. Build 結果

| 檔案 | 前版（`git show HEAD:`） | 本次 | 差異 |
|---|---|---|---|
| `index.html` | 1,795,605 bytes | 1,799,869 bytes | **+4,264 bytes（+0.24%）** |
| `card_editor.html` | 368,646 bytes | 368,646 bytes | **無變化**（本次未改 `src/data/`，卡片工坊內容不受影響） |
| `dist/index.html`（gitignore，不進版控） | — | 1,799,869 bytes | 與 `index.html` 一致 |

差異來源與 T-004 內容量級相符（`E.openIpo` 新增約 10 行、`uiCore.js`／`uiViews.js` 各新增數行判斷邏輯，無新增卡片或參數）。

## 5. 發版前檢查清單

| 項目 | 結果 |
|---|---|
| 全部測試通過（重跑，附輸出） | ⚠️ **有條件通過**：與 T-004 直接相關的所有測試（`s45test.js`／`s18test.js`／`runtests.js`／`gate.js`／`contentcheck.js`）逐一重跑全數 PASS；唯一失敗項 `tests/s22test.js` 的計時測試已用 `git stash` 證實與本次改動無關、且在改動前的 HEAD 基準上同樣失敗，判斷不阻擋本次發布（詳見第 3、9 節），比照前次 T-86 的處理原則 |
| 版本號在所有位置一致 | ✅ `package.json`／`engineCore.js`／`index.html`／`dist/index.html`／`manual/rulebook.html`／`manual/quickstart.html` 六處皆為 `2.53.1`／`v2.53.1-S46`；`card_editor.html` 本身不顯示版本字串（工坊頁面無此欄位，非遺漏） |
| changelog 已寫 | ✅ `docs/FinFlow_S46變更說明_新股公告通知不足修復_v2.53.1.md` |
| 舊存檔載入測試通過 | ✅ `tests/s45test.js` S1 段「⑨ 舊存檔／關閉時不觸發」（`ns.replay` 重放逐位元一致）本次重跑仍 PASS；`npm run test:engine` 的 `gate.js`（1000 局）`assetLedgerMismatch:0` |
| 沒有殘留的『文案待補』或 TODO 佔位 | ✅ 已用 Grep 掃過本次全部改動檔案（`applyAction.js`／`uiCore.js`／`uiViews.js`／`s18test.js`／`s45test.js`／`manual/*.html`），僅命中 `applyAction.js:308` 一句既有（S15 時期）註解裡的 `XXX_PENDING`（描述一類 reject 碼的泛稱，非待補標記，且不在本次改動範圍內），非阻擋 |
| 備份檔（`*.backup.*`）未被納入 build | ✅ `build/bundle.js` 只讀寫死列出的檔案清單，不做目錄掃描；`grep -c "backup" index.html` 為 0；`.gitignore` 第 19-20 行已排除 `*.backup.*`／`*.backup2.*` |

全部打勾（含一項有條件說明），可交付。

## 6. 準備要 commit 的檔案清單（尚未執行 `git add`／`git commit`）

見對話回覆（製作人需要直接看到完整清單）。摘要：修改 11 個既有檔案（含本次 build 產物 `index.html`）＋新增 19 個檔案（changelog、本檔、ADR 補充裁決 1／2、T-004/T-005/T-006 任務單、各角色回報、QA 報告、QA 新增的 4 支回歸測試腳本）。**明確排除**：`.claude/`、根目錄 `CLAUDE.md`、`Claude outputs/`、根目錄全部 `.patch` 檔與其他無關的 `.md`、`_s26_backup/`、`s35_delivery/`、`scratch/`（除本次 T-004 未新增任何 scratch 檔案）、`docs/templates/`。

## 7. 未預期發現

1. **`tests/s22test.js`「模擬器速度：20 局 < 4 秒」在本次驗證環境下持續超時**（4 次量測 4076–5338ms），已用 `git stash` 確認與 T-004 本次 diff 無關（HEAD 基準上同樣失敗）。這是既有測試對「20 局模擬器乾跑」設的固定時間門檻，沒有依機器效能給任何餘裕係數，在本機目前的執行環境下已經頂到邊界。**不在本次 release-manager 權限範圍內修改測試門檻**，建議另開票交 pm-planner／architect 評估是否放寬門檻或加入效能餘裕係數，避免往後每次在較慢或較忙的機器上跑測試都卡住 `npm test` 的 exit code——這正是 CLAUDE.md 第 5 節「不自驗宣稱完成」與「查不到就標 UNKNOWN」要求我誠實記錄、不要用「反正之前都過」帶過的情況。
2. **我自己在本次驗證過程中，第一次嘗試就親自踩到 T-002 修好的那個陷阱的「殼層版本」**：用 `npm test > log 2>&1; echo "EXITCODE:$?"` 時，`echo` 命令在重導向範圍**外**，工具回報的「exit code 0」只是 `echo` 自身的退出碼，不是 `npm test` 的真實退出碼。第二次改成 `npm test > log 2>&1; echo "EXITCODE:$?" >> log`（把 echo 也寫進同一個檔案）才拿到真正的 `EXITCODE:1`。這不是本次 T-004 程式碼的問題，是我自己驗證方法的第一次嘗試有陷阱，已在第二次修正並記錄，供之後的 release-manager／QA 參考同款陷阱。
3. `docs/tickets/T-004/dispatch.md` 與 `T-004-新股公告通知不足.md` 均未指定目標 sprint 序號（不同於 T-001），版本號的 sprint 部分（`S46` vs `S45b`）是我依現有先例推論的判斷，非任務單明載事實，已在第 1 節詳細說明依據，請製作人確認是否同意。
4. 沒有發現任何範圍外的程式碼異動：`git status` 目前異動檔案與 dispatch／QA／code-reviewer 表列完全一致。

## 8. 需要製作人決定的事

1. **版本號 sprint 序號 `S46`**：我判斷應該獨立編號（理由見第 1 節），但這不是任務單明載的事實，如果製作人認為應該是 `S45b`（延續 S45 發布事件），請指正，我會照改（純標籤字串置換）。
2. **`tests/s22test.js` 計時測試門檻**：本次確認與 T-004 無關、不阻擋發布，但建議開一張新票追蹤（放寬門檻或加效能餘裕係數），是否要開由製作人／pm-planner 決定，我不代為開票（release-manager 不改版本號以外的程式或測試）。
3. **第 6 節「準備要 commit 的檔案清單」與訊息草稿是否同意**：同意後由製作人執行 `git add` 與 `git commit`（依任務指示，release-manager 本次不執行 `git add`／`git commit`／`git push`）。
4. **push 與 GitHub Pages 部署**：本次任務範圍明確只到 build 為止，push 與部署需要製作人另外明確同意，不在本次回報範圍內請示。
