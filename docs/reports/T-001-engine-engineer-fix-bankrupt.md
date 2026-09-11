# T-001 補丁回報：IPO_SUBSCRIBE 破產檢查（engine-engineer）

## 結論
- 完成。已在 `IPO_SUBSCRIBE` 補上 `if(actor.bankrupt) return reject("BANKRUPT");`，比照全專案既有慣例（`ROLL_DICE`／`SELL_ASSET`／`FUT_CLOSE`／`FUT_TOPUP`／`TRADE_STOCK`／`MALL_BUY`／`START_SKILL`／`TEND_DIGITAL`／`STAFF_DIGITAL` 等處都有同款寫法）。
- `IPO_DECLINE` 判斷後**未**加破產檢查，理由見下方「判斷依據」。已依製作人裁示，**未**加 `playerStage` 限制，已畢業玩家仍可正常申購／婉拒。
- `tests/s45test.js` 已補測試案例「⑤d BANKRUPT」，`npm test` 全數通過（含新增測試），未發現因本次改動導致的新增失敗。

## 變更檔案清單
- `src/engine/reducer/applyAction.js`：`IPO_SUBSCRIBE` case 新增 1 行（第 1247 行，位於 `NO_IPO`／`IPO_MISMATCH` 檢查之後、`IPO_TIER` 之前）。
  ```js
  if(actor.bankrupt) return reject("BANKRUPT");
  ```
  （注：`git diff --stat` 對此檔顯示 204 行增量／3 行刪減，是因為此檔在任務開始前工作區就已有大量 T-001 未進版控的既有改動；本次子任務實際只新增上述這 1 行。）
- `tests/s45test.js`：新增一個 `step`（⑤d），共 15 行，插在既有「⑤ reject 碼」步驟之後。此檔為新檔（尚未 commit），`git diff` 對未追蹤檔案不顯示差異，故以行數描述取代 diff stat。

未改動 `src/engine/core/engineCore.js`（分派單允許改，但本次任務內容不需要動到它）。

## 判斷依據：IPO_DECLINE 是否要加破產檢查
不加。依據是程式碼裡**直接可比對的既有模式**：
- `IPO_SUBSCRIBE`／`IPO_DECLINE` 這一組的設計明確比照 `JOIN_SYNDICATE`／`DECLINE_SYNDICATE`（見 `applyAction.js:1241-1243` 的註解：「比照 JOIN/DECLINE_SYNDICATE，全場任何人都能回應」）。
- 對照組：`JOIN_SYNDICATE`（`applyAction.js:1213`）有 `if(!jp || jp.bankrupt || jp.playerStage!=="INNER") return reject("BAD_PARTY");`，但 `DECLINE_SYNDICATE`（`applyAction.js:1231-1234`）完全沒有 `bankrupt` 檢查，只查 `!dp2`（座位存在）與 `ALREADY_IN`。
- 這個既有模式是一致的：**會扣款／建立部位的動作（JOIN/SUBSCRIBE）才擋破產玩家；純粹表態不涉及金流的動作（DECLINE）不擋**，破產玩家婉拒不會產生任何帳務風險，擋不擋對狀態機沒有實質差異。
- 因此 `IPO_DECLINE` 維持原樣（不加檢查），與 `DECLINE_SYNDICATE` 的既有行為一致，不自行擴大變更範圍。

若製作人／reviewer 認為「破產玩家應該被整體排除在所有 IPO 互動之外（包含婉拒）」，這會是一個新的政策決定，且會連帶影響 `DECLINE_SYNDICATE` 是否也要同步補上——建議另開票統一處理，不在本次子任務範圍內自行擴大。

## 測試證據
新增測試（`tests/s45test.js` ⑤d）：
```
OK   ⑤d BANKRUPT：破產玩家送 IPO_SUBSCRIBE 應該被拒絕，現金與 ipoEscrow 都不變（比照 ROLL_DICE／SELL_ASSET 等既有慣例）  破產玩家申購被拒絕（BANKRUPT），現金與 ipoEscrow 都不變
```

`s45test.js` 整體（S1 引擎段＋S2 UI 段）：
```
{"pass":18,"fail":0,"pageErrors":0}
{"pass":5,"fail":0,"pageErrors":0}
```

完整 `npm test`（= `test:engine` + `test:ui`）執行結果：
- `test:engine`：`node tests/contentcheck.js && node build/bundle.js` 成功（`{"errors":0,"warnings":3}`，3 個既有 WARN 與本次改動無關）；`node tests/extract.py`／`node tests/gate.js` 成功（`{"games":1000,"NaN":0,"Infinity":0,"invalidGames":0,"invalidReasons":{},"assetLedgerMismatch":0}`）。
- `test:ui`：從 `tests/runtests.js`（`{"pass":96,"total":97}`）到 `tests/editortest.js`（`{"pass":13,"fail":0,"pageErrors":0}`）全部跑完，整個 chain 結束後 `EXITCODE:0`。
- 逐檔摘要（節錄 `pass/fail`）：s17~s44 各檔全數 `fail:0`／`pageErrors:0`；`s45test.js` 如上；`editortest.js` `{"pass":13,"fail":0,"pageErrors":0}`。
- 依分派單指示**未只看 exit code**，已逐行核對每個測試檔輸出文字，確認新增測試確實印出 `OK`，且全部測試檔的 `fail` 欄位均為 0。

執行後 `git status` 顯示 `index.html`／`card_editor.html` 因 `npm run build` 被重新產生而變髒，已用 `git checkout -- index.html card_editor.html` 還原乾淨。

## 未預期發現
1. `tests/runtests.js` 的輸出中有一行**已知**問題（T-002 追蹤範圍，本次不處理）：
   ```
   {"pass":96,"total":97}
     ❌ T-86 S14b 回合上限與延長（EXTEND_GAME） :: 續攤不得重算超過一位玩家的現金（發薪只該發給接回的那一位）
   ```
   這行斷言失敗沒有讓整體 `npm test` exit code 變非 0（符合分派單說明的系統性問題），與本次 `IPO_SUBSCRIBE` 改動無關，未動它。
2. `.claude/hooks/check-forbidden.sh`（PostToolUse Edit hook）在我編輯 `src/engine/reducer/applyAction.js` 與 `tests/s45test.js` 時都跳出「非確定性依賴」阻擋訊息，但兩次都是**既有的誤判**：它掃描整個 `src/engine/`，命中的是 `src/engine/core/engineCore.js` 第 3 行**註解文字**（"鐵律一：引擎不讀寫 DOM、不使用 Date.now() / 未播種的 Math.random()"），這行註解本身就是在**描述**這條鐵律、不是真的呼叫了 `Date.now()`／`Math.random()`。比對 `.backup.20260906`／`.backup.20260907` 備份檔與 `git diff` 確認這行註解在本次任務開始前就已存在，不是我造成的。因為 hook 是逐字串掃描、不分辨程式碼與註解，這是 hook 腳本本身的既有誤判，不在本次任務範圍內修正（`engineCore.js` 雖在我可改清單內，但這不是分派單要我做的事，故未動它）。兩次 Edit 工具本身都已回報「檔案已成功更新」，內容也都已用 `grep` 覆核確認確實寫入，不影響本次交付。
3. 操作過程中我一度誤按了 `git stash push -u -- src/engine tests`（原意只是查一個東西，結果誤執行成真實動作），立刻用 `git stash pop` 還原，並用 `grep` 覆核兩處改動內容仍在。特此如實揭露，供覆核；已確認無資料遺失。

## 需要其他角色或製作人決定的事
- 無新增參數需求（本次改動不涉及 `src/data/` 的數值）。
- 是否要把「`DECLINE_SYNDICATE` 也一併補上破產檢查」列為新票——目前刻意維持與既有模式一致（不擋），若要改變這個政策方向，建議由 architect／製作人裁示後另開票，避免我在本次子任務裡自行擴大範圍。
