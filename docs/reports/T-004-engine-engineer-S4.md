# T-004 S4 回報（engine-engineer，最終驗收重跑）

- 對應：`docs/tickets/T-004/dispatch.md` S4
- 日期：2026-09-11
- 範圍：無程式改動，僅獨立重新驗證 S1（本人）＋S3（ui-engineer）成果

## 結論（3 行內）

1. **T-004 全部完成，可以收尾（compile 一次 commit）。** 獨立重新跑一次完整 `npm test`，殼層回報 `EXIT_CODE=0`，逐字檢查整份輸出（`grep -n "FAIL\|❌"`、逐一核對每個 `{"pass":N,"fail":0[,...]}"` 區塊）確認**全程沒有任何一行 FAIL、沒有任何非零 `fail`／`pageErrors`**，與 ui-engineer S3 回報宣稱一致。
2. `git status` 確認除了 dispatch 表列的預期檔案外，唯一多出的異動是 `index.html`（`npm test` 內部 `test:engine` 會呼叫 `npm run build`，重新打包時必然產生的建置產物），我嘗試 `git checkout -- index.html` 還原但被系統權限分類器擋下（詳見「未預期發現」），**不是程式邏輯問題**，不影響本次驗收結論。
3. **T-005 現在可以開工**：其前置依賴（T-004 S3 完成＋S4 確認 `npm test` exit 0）已於本次驗證滿足；T-005 票面「背景與根因」段落對 `STOCK_GAIN` 風險與 `E.pushDecision` 盤點的描述與本次驗收結果吻合，沒有發現矛盾。

## 驗證證據

### 1. `git status`（跑 `npm test` 之前）

```
 M "docs/adr/ADR-001-新股抽籤.md"
 M src/engine/reducer/applyAction.js
 M src/ui/uiCore.js
 M src/ui/uiViews.js
 M tests/s18test.js
 M tests/s45test.js
```

對照 dispatch 表列的預期異動檔案：
- `src/engine/reducer/applyAction.js`（S1，本人）✓
- `src/ui/uiCore.js`、`src/ui/uiViews.js`（S3，ui-engineer）✓
- `tests/s45test.js`（S1＋S3 都有段落）、`tests/s18test.js`（S3 追加授權修法）✓
- 沒有 `index.html`／`card_editor.html`／`dist/` 殘留異動 ✓（跑測試前）
- 多出一份 `docs/adr/ADR-001-新股抽籤.md` 的修改，屬於 architect 對 D5 節的既有修訂（dispatch 開頭已註明「ADR（D5 節，2026-09-11 修訂）」），是文件不是程式碼，不在「不可碰」清單範圍內，非本次異常。

### 2. 完整 `npm test`（獨立重新執行，不是分段跑）

用背景工作實際執行 `npm test`（非 `npm run test:engine` 或 `test:ui` 分開跑），殼層本身回報：

```
EXIT_CODE=0
[exited with code 0]
```

逐字掃描完整輸出（約 480 行）：

```
grep -n -i "FAIL\|❌" 全文 → 只命中 JSON 鍵 "fail"（如 "fail":0），沒有任何獨立的 FAIL/❌ 字樣
grep -noE '"fail":[0-9]+' | grep -v '"fail":0'  → 無輸出（沒有任何非零 fail）
grep -noE '"pageErrors":[0-9]+' | grep -v '"pageErrors":0'  → 無輸出（沒有任何非零 pageErrors）
```

關鍵區塊摘錄：

- `test:engine`（build＋extract＋gate）：
  ```
  {"errors":0,"warnings":3}
  {"games":1000,"NaN":0,"Infinity":0,"invalidGames":0,"invalidReasons":{},"assetLedgerMismatch":0}
  ```
  （3 則 warning 是既有、與本票無關的技能／已移除 id 提示，非本次新增）
- `tests/runtests.js`（含 T-59）：`{"pass":97,"total":97}`
- `tests/s18test.js`：`{"pass":20,"fail":0}`（ui-engineer S3 追加授權修法後的驗收數字，與其回報一致）
- `tests/s45test.js`：
  - S1 段落（19 項，含 `D5-1c（T-004）`）：`{"pass":19,"fail":0,"pageErrors":0}`
  - S2 段落（5 項）：`{"pass":5,"fail":0,"pageErrors":0}`
- `tests/editortest.js`（`npm test` 鏈最後一支）：`{"pass":13,"fail":0,"pageErrors":0}`

完整原始輸出已存於本機暫存（`C:\Users\Carrie\AppData\Local\Temp\claude\npm_test_output.log`，非專案內檔案，僅供覆核，不隨本回報提交）。

### 3. `D5-1c（T-004）` 與 `T-59`／`tests/s18test.js` 是否互相打架

三者在同一輪完整 `npm test` 裡同時綠燈，逐一核對：

- `D5-1c（T-004）`（`tests/s45test.js` S1 段落，本人所寫）：
  ```
  OK   D5-1c（T-004）：電腦觸發開盤 → 場上所有真人（不只觸發者）都收到 IPO_ANNOUNCE，且互不干擾  電腦觸發後，2 位真人各自收到卡、互不干擾、依序解卡成功
  ```
  位於 `{"pass":19,"fail":0,"pageErrors":0}` 區塊內，19 項全綠。
- `T-59`（`tests/runtests.js` 內，ui-engineer S3 補的模擬分支）：整份 `runtests.js` 回報 `{"pass":97,"total":97}`，97/97 全綠，沒有單獨列出 FAIL 項。
- `tests/s18test.js`（ui-engineer 追加授權修法）：`{"pass":20,"fail":0}`，與其回報「30 輪：彙總 26/26」等數字一致。

三者分屬不同檔案、不同段落，互不覆寫、互不衝突，符合 dispatch「兩邊皆已用『僅可改的段落』明確切分」的設計。

### 4. 舊存檔／決定論回歸未受影響

`npm test` 完整輸出中，涉及重放決定論的既有項目全數維持綠燈，例如：
- `QA-004 存檔 log 重放：三個種子 30 輪後全狀態（含 auxRngState）逐位元一致，續玩 10 輪動作序列一致`
- `⑨ 舊存檔／關閉時不觸發：S.ipo 全程 null，重放逐位元一致，不產生任何 IPO_* 事件`
- 多處「決定論：同種子同動作序列，重放結果一致」（M8、M9、集資等模組各自都有）

沒有任何一項因本次 S1／S3 改動而新增失敗。

## T-005 是否可以開工的確認

**可以開工。** T-005 票面「前置依賴」明文要求「T-004 S3 完成＋S4 確認 `npm test` exit 0」，本次驗證兩者皆已滿足。另外核對票內「2. 背景與根因」段落的描述：

- 引用的三處根因（`ui.renderCenter` 判斷順序、`ui.tick` 守門、`E.waitingOnHumans` 不認得 `pendingDecision`）與本次 S3 回報、dispatch 補充裁決 2 的描述一致，沒有發現矛盾。
- `STOCK_GAIN`（`contentNpcSim.js:103-116`，`onRoundEnd` forEach 廣播）目前確實**尚未**有專屬回歸測試覆蓋（本次 `npm test` 完整輸出中沒有看到針對「電腦回合中真人因 STOCK_GAIN 收到卡」的獨立斷言），與 T-005 驗收條件 1 要補的內容吻合、不重複。
- pm-planner 的 `E.pushDecision` 全面盤點（票內第 2 節）結論「僅 `STOCK_GAIN` 與 `IPO_ANNOUNCE` 是 forEach 廣播寫法」，我沒有另外重新 Grep 覆核（不在本次 S4 授權範圍），依 T-005 驗收條件 4 要求應由 T-005 執行者自行重新 Grep 或引用覆核，此處僅確認 T-004 S4 與 T-005 的依賴鏈本身沒有斷點。

本次未替 T-005 補任何測試（依 dispatch 明文「不需要現在就去補 STOCK_GAIN 的測試」）。

## 未預期發現

1. **`npm test` 執行後 `index.html` 變成 modified**：`test:engine` 內部會跑 `npm run build`，把目前 `src/` 現況（含尚未 commit 的 S1／S3 改動）重新打包進 `index.html`，這是必然、決定性的建置產物差異，不是我手動編輯的結果，與 ui-engineer S3 回報遇到的情況相同。我嘗試執行 `git checkout -- index.html` 想比照 ui-engineer 的做法還原，但被 Claude Code 的權限分類器擋下（destructive git 指令，系統判定需要人工授權），所以**目前工作區 `index.html` 仍顯示為 modified**，需要由有權限的人（或製作人明確同意後）手動執行 `git checkout -- index.html` 還原，或者在 compile commit 時一併帶入這份已包含 S1／S3 改動的重建版本（兩者皆可，但不應該由我自行判斷選哪個，因為 CLAUDE.md 第 5、6 節規定 build／版本號／commit 相關決定不屬於 engine-engineer 職權，release-manager 才能 build 與 commit）。
2. 沒有發現任何測試互相覆蓋、打架，或 S1／S3 邏輯衝突的情況；ui-engineer 回報內容逐項核對後與本次獨立重跑結果一致，沒有「自驗宣稱與實測不符」的落差。

## 需要其他角色或製作人決定的事

1. **`index.html` 的還原或保留**：請 release-manager 或製作人決定是要 `git checkout -- index.html` 還原成 commit 前狀態（讓 build 產物交由正式 release 流程處理），還是保留這次重建版本一併 commit。這不影響「T-004 全部完成」的結論，純粹是 build 產物的處理方式問題。
2. **收尾 commit**：dispatch 與本票要求的「S1＋S3＋S4」驗收條件均已達成，可以請有 commit 權限的角色（release-manager 或製作人指定）將 `src/engine/reducer/applyAction.js`、`src/ui/uiCore.js`、`src/ui/uiViews.js`、`tests/s18test.js`、`tests/s45test.js` 這五個檔案 compile 成一次 commit；`docs/adr/ADR-001-新股抽籤.md` 的修訂是否一併納入由 architect／製作人決定。
3. **T-005 排程**：確認可以開工，實際何時排入由 pm-planner／architect／製作人決定（本回報不代為決定優先序）。
