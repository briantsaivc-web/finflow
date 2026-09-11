# T-001 ui-engineer 回報：修 T-68（IPO_POOL 撞關鍵字掃描）

## 結論

已在 `src/ui/uiViews.js` 的 `ns.selftest` T-68 掃描迴圈加入一行 `IPO_POOL` 牌堆排除條件（`if(dk==="IPO_POOL") return;`），未動 `src/data/` 卡片內容。
`node tests/_verify_t68.js`（臨時驗證腳本，用完即刪，未留在工作區）直接呼叫 `ns.selftest.run(false)` 取出 T-68 該筆結果，確認 `ok:true`，`detail` 顯示「掃描全牌堆零漏網」。
`npm test` 全套跑完，`test:engine`（build + extract + gate）全過；`test:ui` 中 `runtests.js` 的失敗清單裡**沒有** T-68（另有一項與本任務無關的既有失敗 `T-86`，見下方「未預期發現」）。

## 變更檔案清單

- `src/ui/uiViews.js`：第 6096-6097 行（`Object.keys(ns.content.cards).forEach` 迴圈開頭）新增一行：
  ```js
  if(dk==="IPO_POOL") return; // S4：新股抽籤牌堆跟「有沒有小孩」這個機制無關，不受此掃描規範
  ```
  這是本次的唯一實質改動，其餘 diff 為既有工作區上 S2（IPO 相關 UI，`IPO_OPENED`／`IPO_SUBSCRIBED`／`IPO_DECLINED`／`IPO_SETTLED` 事件處理與 `DECISION_RESOLVED` 的 `IPO_ANNOUNCE` 排除）留下的修改，非本次新增。
- `src/ui/uiViews.js.backup.20260910`：修改前備份（新建）。
- `tests/_verify_t68.js`：驗證用臨時腳本，**驗證後已刪除**，未留在工作區、未提交、未列入 `git status`。

## 測試證據

1. 臨時驗證腳本（`node tests/_verify_t68.js`，用 Playwright 開 `index.html`，呼叫 `ns.selftest.run(false)` 後在 `r.results` 裡找出 name 開頭為 `T-68` 的那一筆，逐字印出）輸出：
   ```
   {"ok":true,"name":"T-68 沒有小孩就不該抽到小孩的帳單","detail":"本次新掛閘門 4 張（LS12）；本來就有 20 張；由教養軸規則擋下 19 張；掃描全牌堆零漏網；還原開關只影響新掛的那一張"}
   ```
   `"ok":true` 明確是布林值而非彙總計數，且 `detail` 文字本身就是「掃描全牌堆零漏網」，可直接證明加了 `IPO_POOL` 排除後掃描迴圈不再誤判 `IPO_S20`。

2. 完整 `npm test`：
   - `test:engine`（`npm run build && npm run extract && node tests/gate.js`）：build 輸出 `內容包 11 個／卡片 750 張／職業 20／引擎 op 123 種／程式寫死 id 150 個` 與 `{"errors":0,"warnings":3}`（3 個既有 WARN 與本任務無關）；extract 輸出 `{"games":1000,"NaN":0,"Infinity":0,"invalidGames":0,"invalidReasons":{},"assetLedgerMismatch":0}`。
   - `test:ui`（`node tests/runtests.js && ...`）：`runtests.js` 輸出首行 `{"pass":96,"total":97}`，其後只列出一筆 `❌`：
     ```
     ❌ T-86 S14b 回合上限與延長（EXTEND_GAME） :: 續攤不得重算超過一位玩家的現金（發薪只該發給接回的那一位）
     ```
     這份「失敗清單」是 `runtests.js` 用 `r.results.filter(x=>!x.ok)` 產生的，T-68 不在其中，代表它 `ok===true`（若仍失敗必定會被列出，如同修改前 QA 報告截到的 `❌ T-68 ...` 那行）。因此本測試證據與第 1 點的臨時腳本逐行輸出互相印證。

## 未預期發現

1. `npm test` 跑完後，`index.html` 與 `card_editor.html`（tracked build 產物）被重新 build 而變成 modified，已依分派單指示用 `git checkout -- index.html card_editor.html` 還原乾淨，未留在工作區。
2. `test:ui` 有一筆既有失敗 `T-86 S14b 回合上限與延長（EXTEND_GAME） :: 續攤不得重算超過一位玩家的現金（發薪只該發給接回的那一位）`，與本次 T-68／IPO_POOL 修改完全無關（本次改動只影響 T-68 的 `dk==="IPO_POOL"` 排除），懷疑是既有回歸缺陷，超出本票範圍，未動。
3. 工作區另外還有非本次修改造成的既存差異：`tests/editortest.js`（modified，65 行新增，非本次改動，git blame 顯示非本次 commit）、以及未追蹤檔案 `tests/qa-ipo-exploratory-test.js`、`tests/qa-ipo-resolution-test.js`、`tests/qa-ipo-showoffer-test.js`、`tests/s45test.js`。這些看起來是 QA 或其他角色先前留下的工作產物，本次任務未碰，僅在確認工作區狀態時觀察到，一併記錄避免被誤認為是本次改動範圍。
4. `src/ui/uiViews.js` 在本次任務開始前已是 modified 狀態（S2 的 IPO 相關 UI 事件處理），與 engine-engineer 回報中提到的一致，已確認本次改動是疊加在該版本之上、不衝突。

## 需要其他角色或製作人決定的事

1. `T-86` 的既有失敗建議另開票交給對應角色（推測是 engine-engineer，因為涉及「發薪只該發給接回的那一位」這種回合結算邏輯，不在 ui-engineer 的可改範圍），本次不處理。
2. 工作區中 `tests/editortest.js` 及數個未追蹤的 `tests/qa-ipo-*.js`／`tests/s45test.js` 檔案的歸屬與去留，建議由 architect 或製作人確認是否為其他進行中任務的暫存產物，本次未變動、未刪除。
