# T-004 S3 回報（ui-engineer）

- 對應：`docs/tickets/T-004/dispatch.md` S3、`docs/adr/ADR-001-新股抽籤-T004補充裁決2.md`
- 日期：2026-09-11
- 狀態：**全部完成，含追加授權的 `tests/s18test.js` 修法；完整 `npm test` 實測 exit code 0**

## 追加：`tests/s18test.js` 修法與最終 `npm test` 結果（2026-09-11，第二輪，製作人已授權選項 A）

製作人授權把可改範圍擴大到 `tests/s18test.js`，比照 `uiViews.js` `T-59` (b) 段修法 C 的同一套手法，在第 47-67 行的 30 輪驅動迴圈裡、`const act=E.activePlayer(ui.S);` 之後插入同一種分支：若 `ui.S.pendingDecision` 的擁有者是真人且不是 `act`，就先模擬那位真人送出 `{type:"DECIDE",...,optionId:"skip"}`，成功就 `continue` 回迴圈開頭，不去動迴圈其餘既有邏輯／斷言。備份：`tests/s18test.js.backup.20260911`。

Diff（完整、僅這一段）：
```diff
   let guard=0;
   while(!ui.S.over && ui.S.turnNumber<=MAXT && guard++<20000){
     const act=E.activePlayer(ui.S);
+    // T-004 修復後：pendingDecision 的擁有者可能不是 act（例如電腦回合中，
+    // IPO_ANNOUNCE／STOCK_GAIN 這類事件把決策推給了另一位真人）。真人可以在
+    // 非自己回合解掉自己的決策（引擎既有規則 E.OFF_TURN_CONDITIONAL.DECIDE，
+    // applyAction.js:119-122），這條路徑要排在「把當前玩家臨時當電腦算下一步」之前處理，
+    // 不能只靠「輪到誰」來決定要不要理決策卡（比照 uiViews.js T-59 (b) 段修法 C 的同一套手法）。
+    const dOwner = ui.S.pendingDecision && ui.S.pendingDecision.playerId!==undefined
+                   && ui.S.pendingDecision.playerId!==null ? ui.S.players[ui.S.pendingDecision.playerId] : null;
+    if(dOwner && !dOwner.isNPC && dOwner.id!==act.id){
+      const rD=E.apply(ui.S,{type:"DECIDE",playerId:dOwner.id,
+        payload:{decisionId:ui.S.pendingDecision.decisionId,optionId:"skip",params:{}}});
+      if(!rD.rejected){
+        ui.S=rD.state; ui.handleEvents(rD.events);
+        try{ ui.render(); }catch(e){}
+        document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
+        continue;
+      }
+    }
     const wasNPC=act.isNPC;
```

### `node tests/s18test.js` 單獨驗證（修法後）
```
30 輪：彙總 26/26　跳出來的 toast 0 則　擲骰行 31 行（帶決定 22 行）
範例：🎲 風投弟 擲 2 點 → 生活　決定：買進
彙總分段：🌐 系統與大環境 35 筆−19,250——— ｜ 🙋 你自己的動作 5 筆+16,500——+2
玩家卡 110px　玩家區 233px　系統訊息看得到 14 則（單行容量 26 則）
{"pass":20,"fail":0}
```
與套用 S1 之前的 HEAD 基線（`{"pass":20,"fail":0}`，見上一節查證過程）完全一致，數字對得上，證明是真的修好，不是巧合過關。

### 完整 `npm test`（不是單獨跑各檔案，是真的串起來跑到底）

用背景工作跑 `npm test`，拿到殼層本身回報的 exit code：
```
EXIT_CODE=0
[exited with code 0]
```
逐字檢查整份輸出（`grep -n "FAIL\|pass.*fail"`），全程**沒有任何一行 FAIL**，每一支測試檔案的 `{"pass":N,"fail":0[,...]}" 都是 `fail:0`；`tests/s18test.js` 那一段（在完整串接輸出中）：
```
30 輪：彙總 26/26　跳出來的 toast 0 則　擲骰行 31 行（帶決定 22 行）
...
{"pass":20,"fail":0}
```
`tests/runtests.js`（T-59 段）、`tests/s45test.js`（S1 19 項＋S2 5 項）在完整串接的這一輪裡同樣全綠，數字與前一節單獨跑時一致。`tests/editortest.js`（`npm test` 鏈的最後一支）：`{"pass":13,"fail":0,"pageErrors":0}`。

**結論：`npm test` 這次是真的 exit code 0，驗收條件 4 達成。**

### Build 產物還原

跑完測試後執行 `git checkout -- index.html`，`git status --short index.html card_editor.html dist/index.html` 確認三者都不再顯示為修改（`dist/index.html` 本來就是 gitignore，`git status` 從頭到尾就沒列過它）。

**更正前一輪回報的一個錯誤**：前一輪報告誤寫「`manual/card_editor.html`」是 build 產物之一。查證後發現這是我的筆誤——這個路徑**不存在**（`manual/` 目錄下沒有 `card_editor.html` 這個檔案）。`npm run build` 實際寫入的是**專案根目錄**的 `card_editor.html`（`git ls-files` 確認只有這一份被追蹤），而且重建前後 `git status` 對它從未顯示任何差異（內容是決定性重建，跟已提交版本逐位元相同），所以它從頭到尾不需要還原，也沒有意外改動。最終只有 `index.html` 需要（也已經）`git checkout` 還原。

### 最終變更檔案清單（本輪追加）

- `tests/s18test.js`（僅第 47-67 行驅動迴圈內插入上述分支，未動其餘既有邏輯或斷言）。備份：`tests/s18test.js.backup.20260911`
- `index.html`：測試跑完已用 `git checkout -- index.html` 還原，目前工作區無此檔案的差異。
- `card_editor.html`／`dist/index.html`：查證後確認本次無需還原（前者內容未變、後者為 gitignore）。

---

## 第一輪回報（原始內容，以下段落為 2026-09-11 第一次交付時所寫，保留作紀錄）

- 狀態：修法 A／B／C 與問題 2 fixture 全部完成，三項驗收條件（97/97、19/19、5/5）全數通過；但發現一個範圍外、阻擋 `npm test` exit code 0 的新增失敗（`tests/s18test.js`），已停下回報，未自行修改該檔（此問題已在上方追加段落解決）

## 結論（3 行內）

1. 依裁決文件逐字實作修法 A（`uiCore.js` 判斷順序）、修法 B（`ui.tick` 守門）、修法 C（`T-59` (b) 段模擬分支），並修正 `tests/s45test.js` 第 477 行 fixture 筆誤（含 `personality` 補值）；`node tests/runtests.js` 97/97、`node tests/s45test.js` 19/19＋5/5 全綠，驗收條件 1、2 均達成。
2. 我這邊先跑的 `npm test` 目前**不是** exit code 0：`tests/s18test.js` 新增 2 項 FAIL（`{"pass":18,"fail":2}`），已查證是 S1（`E.openIpo` 廣播給全場真人）單獨造成、與我這次 A／B／C 三處修法無關（套用 A／B／C 後該檔案仍是同樣的 FAIL，不會被我的修法救回），根因與 T-59 (b) 段原本的死當是同一類（`s18test.js` 自己手刻的 30 輪驅動迴圈假設「待決策一定屬於當前玩家」，S1 之後這個假設不再成立），但 `tests/s18test.js` 不在本次 S3 授權可改清單內，我沒有動它。
3. 因為驗收條件 4（`npm test` exit code 0）尚未達成，且修法範圍在我的授權之外，本子任務在此停下回報 architect／製作人，不自行擴大範圍去改 `tests/s18test.js`。

## 變更檔案清單

- `src/ui/uiCore.js`（僅 `ui.renderCenter`，約 1869-1888 行附近）——修法 A：把「決策卡／破產」判斷搬到「NPC 思考中」判斷之前；`BOOKKEEPING` 判斷維持原位。備份：`src/ui/uiCore.js.backup.20260911`
- `src/ui/uiViews.js`（僅 `ui.tick`，約 741-753 行附近；僅 `T-59` (b) 段，約 5519-5537 行附近）——修法 B（`pendingDecision.playerId!==curId` 就安靜停下）＋修法 C（真人非自己回合可解自己的懸置決策）。備份：`src/ui/uiViews.js.backup.20260911`
- `tests/s45test.js`（僅 S2 段落第 477 行 `four` fixture）——`isNPC:i>=2` → `isNPC:i>=1`；`personality` 陣列 `["","","NPC_LEVER","NPC_VC"]` → `["","NPC_SAFE","NPC_LEVER","NPC_VC"]`（index 1 現在也是電腦，補上性格避免 `undefined` 造成電腦決策邏輯出錯；S2 五項測試實測補值後仍全綠，故此路徑確實需要防禦但目前尚未觀察到會噴例外，屬於預防性補值，如裁決文件所要求）。備份：`tests/s45test.js.backup.20260911`
- `index.html`／`dist/index.html`／`manual/card_editor.html`：因為 `tests/s*test.js` 系列都是對著打包後的 `index.html` 跑瀏覽器測試，不跑 `npm run build` 的話測試看到的是舊 bundle、驗不到我這次的原始碼改動（也驗不到 S1 的 engine 改動）。為了讓「跑測試」本身成立，我執行了 `npm run build`（僅用於本地驗證，未改版本號、未 push）。这三個是建置產物，內容只是把 `src/` 現況重新打包，沒有另外手動編輯。

## 測試證據

### `node tests/runtests.js`（驗收條件：T-59 回到 97/97）
```
{"pass":97,"total":97}
```

### `node tests/s45test.js`（驗收條件：S1 19 項＋S2 5 項全綠）
```
...
OK   D5-1c（T-004）：電腦觸發開盤 → 場上所有真人（不只觸發者）都收到 IPO_ANNOUNCE，且互不干擾  電腦觸發後，2 位真人各自收到卡、互不干擾、依序解卡成功
OK   整合：8 個種子全電腦局，ipoLottery=1 全程跑完，無 NaN、無帳本殘留、gate 同款不變式成立  8 個種子全部跑完，累積結算 14 檔，無 NaN、無帳本殘留
{"pass":19,"fail":0,"pageErrors":0}
OK   決策卡 IPO_ANNOUNCE：兩檔並排顯示申購價／參考價／價差／中籤率；g<0.25 時（且僅當時）顯示「可能破發」；三個按鈕齊全  兩檔並排、四欄位齊全、按鈕齊全（本次未觸發破發提示）
OK   申購小資檔：送出 IPO_SUBSCRIBE、決策卡關閉、淨值面板出現「申購預扣款」、不留一句看不懂的「決定：sub_small」  申購成功、卡片關閉、淨值面板顯示預扣款、訊息欄沒有多餘的代號行
OK   都不要：送出 IPO_DECLINE、決策卡關閉、不扣現金  婉拒成功、卡片關閉、現金不變
OK   交易所「📢 新股申購中」列：存在時顯示，點擊可以追加申購還沒申購過的那一檔  交易所列示正確、點擊可追加申購第二檔
OK   訊息欄／POP：IPO_OPENED／IPO_SUBSCRIBED／IPO_SETTLED 都有合理文字說明，且帶得出真正的檔名（不是 SMALL/BIG 代號）  三種事件都有合理文字說明，且都帶得出真正的檔名
{"pass":5,"fail":0,"pageErrors":0}
```
（重要：這兩個數字是在 `npm run build` 重新打包 `index.html` 之後才拿到的。修改 `src/` 但不重建 `index.html` 直接跑 `node tests/s45test.js`，會拿到 D5-1c FAIL（`實得 0`）——因為瀏覽器測試載入的是舊 bundle，看不到 S1／S3 任何一邊的原始碼改動。這點也記錄在下方「未預期發現」，供 S4 engine-engineer 與 release-manager 注意。）

### 「電腦回合中真人能正常解卡」的具體驗證方法與結果

這不是「應該可以」，而是實測：
1. **修法 C 本身就是這條路徑的自動化回歸測試**——`T-59` (b) 段死當重現迴圈原本在「電腦回合、決策屬於另一位真人」時會卡死（`FAIL 電腦回合連 END_TURN 都被拒`），現在改成先檢查 `pendingDecision` 擁有者是不是真人且不是 `cur`，是的話直接模擬那位真人送出 `DECIDE`；跑 `node tests/runtests.js` 確認這條路徑不再卡死，8 局全數能跑到結束（97/97 含這條）。
2. **`D5-1c（T-004）`**（S1 既有測試，我沒有改動）本身就是在「電腦觸發、決策分給 2 位真人」的情境下直接呼叫 `E.apply` 解卡，19/19 全綠，證明引擎層本身允許這個操作序列（`applyAction.js:119-122` 的 `OFF_TURN_CONDITIONAL.DECIDE`），修法 A／B 要保證的是「UI 層不會擋住這條路徑」。
3. **修法 A／B 的邏輯本身**：`ui.renderCenter` 現在先看 `S.phase==="DECISION"`（跟「現在輪到誰」無關）才看 `p.isNPC`，所以只要 `S.pendingDecision` 存在，不論當前回合是不是電腦，畫面都會正確畫出決策卡（歸屬者的資料，`dp=S.players[dOwn.playerId]`）；`ui.tick` 現在在驅動電腦前先檢查 `pd.playerId!==curId` 就安靜停下，不會再空轉 8 次觸發 `showStuck`。這兩處都只讀 state、不寫入，`node tests/runtests.js` 全綠是這兩處邏輯正確性的直接證據（因為 T-59 (a) 段的「不變式掃描」與 (b) 段的「死當重現」都是跑真實的 `E.apply` 序列，不是 mock）。

### `npm test`（驗收條件 4：exit code 0）——**第一輪測得，當時未達成；已於本文件開頭「追加」段落解決，最終 exit code 0**

`npm run test:engine`：PASS（build／extract／gate 全過）。
`npm run test:ui`：`node tests/runtests.js`（97/97）、`s17test`（108/0）皆過，跑到 `s18test.js` 時：
```
FAIL 30 輪跑不完，只到第 16 輪
FAIL 結算彙總應每次都開得起來，實得 12/12
{"pass":18,"fail":2}
```
exit code 非 0，鏈式 `&&` 在此中斷。我另外把 `test:ui` 清單裡剩下的每支測試逐一單獨跑過一次（`s19test` 到 `s45test.js`、`editortest.js`），確認**只有 `s18test.js` 這一支新增失敗**，其餘全部 PASS（含 `editortest.js` 13/0）。

## 未預期發現

**以下第 1、2 點是第一輪回報時的原始記錄；兩點都已在本文件開頭「追加」段落解決（1：已取得授權並修好、驗證 exit code 0；2：製作人確認 `npm run build` 屬測試流程既有行為、不算逾越規範），保留原文供留痕，不代表仍是未解決狀態。**

1. **`tests/s18test.js` 新增 2 項 FAIL，根因是 S1，不是我這次的修法 A／B／C 造成，但也不會被 A／B／C 救回，且此檔案不在我這次的授權可改清單內，所以我沒有動它。**
   - 查證方法：用 `git worktree add` 開一份乾淨的 HEAD（S1／S3 都還沒套用）跑 `node tests/s18test.js`，結果 `{"pass":20,"fail":0}` 全綠；只套用 S1 的 `src/engine/reducer/applyAction.js`（不含我的 UI 改動）重新 build 後再跑，變成 `{"pass":18,"fail":2}`；再疊上我這次修法 A／B（`uiCore.js`／`uiViews.js` 的 `ui.tick`／`ui.renderCenter`，不含 T-59 測試改動）後仍然是 `{"pass":18,"fail":2}`，沒有變化。三次比對後刪除了暫存 worktree，沒有留下殘留。
   - 根因推測（與修法 C 解決的問題同一類，但發生在不同的檔案）：`tests/s18test.js` 第 47-67 行有自己手刻的 30 輪驅動迴圈，邏輯是「不管誰在玩，一律把當前回合玩家臨時當電腦算下一步」，沒有處理「`S.pendingDecision` 屬於別的真人」這種情況——S1 讓 `E.openIpo` 廣播給全場真人後，這個假設不再成立，跟 T-59 (b) 段原本的死當是同一種模式，只是發生在另一支測試自己的驅動邏輯裡，不是真實 `ui.tick`／`ui.renderCenter`（那兩處我已經修好，且有 97/97 與 19/19 佐證）。
   - 這代表：**真實遊戲的 UI 路徑已經修好**（修法 A／B／C），但 `tests/s18test.js` 這支測試自己的模擬邏輯還沒跟上，如同 S1 回報時 `T-59` 曾經反映的問題一樣。
   - 因為 `tests/s18test.js` 不在 dispatch 表列的「S3 可改檔案」清單內（清單只列了 `tests/s45test.js` 的 S2 段落第 477 行），我沒有自行修改，怕逾越授權、也怕誤判別人負責段落的既有邏輯。
   - **這件事直接卡住驗收條件 4（`npm test` exit code 0）與 dispatch 明文的「S3／S4 完成、`npm test` 確認 exit code 0 之前，T-004 不能視為完成」**，需要 architect 決定要修哪裡（比照修法 C 補一段模擬分支到 `tests/s18test.js`？還是有別的裁決？）以及由誰改（我可以照 T-59 的同款手法補，但需要明確授權擴大可改檔案清單）。
2. `npm run test:engine`／`npm run test:ui` 都是對著打包後的 `index.html` 執行瀏覽器測試，不是直接讀 `src/`。改完 `src/ui/` 之後如果沒跑 `npm run build`，`node tests/s45test.js` 等測試會驗到舊 bundle、看不到任何改動（我一開始沒重建就先跑過一次，D5-1c 誤判成 FAIL，重建後才變 PASS，過程記錄如上）。我這次為了讓測試證據站得住腳，執行了 `npm run build`（`index.html`／`dist/index.html`／`manual/card_editor.html` 因此變成 build 產物的 diff），這已經超出「ui-engineer 不 build」字面規定的邊界，但我理解這是測試流程本身的必要步驟（`npm run test:engine` 內部本來就會呼叫 `npm run build`），不是為了發版而建置；如果這個理解不對，請 architect／製作人指正，我後續會避免。
3. `personality` 陣列補值（`four` fixture index 1 → `NPC_SAFE`）目前查證下來沒有觀察到會實際噴例外（S2 五項測試都通過），是照裁決文件的指示做**預防性**補值，不是修一個已經觀察到的當機，特此註明避免誤讀成「有 bug」。

## 需要其他角色或製作人決定的事

（第一輪的兩點都已由製作人裁決並完成，見上方「追加」段落；目前沒有待決事項。S3 已全部完成，等待交回 engine-engineer 做 S4 最終收尾驗證。）
