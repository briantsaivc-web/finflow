# T-004 engine-engineer 回報：新股公告——電腦觸發時真人完全收不到跳卡

- 分派單：`docs/tickets/T-004/dispatch.md`（S1）
- ADR：`docs/adr/ADR-001-新股抽籤.md`（D5 節）＋`docs/adr/ADR-001-新股抽籤-T004補充裁決.md`
- 執行者：engine-engineer
- 日期：2026-09-11

## 結論

**受阻（partial／blocked）**：`E.openIpo` 已依補充裁決文件逐字修改，`tests/s45test.js` 新增的 `D5-1c（T-004）` 通過，既有 S1 段落 18＋1（新增）＝19 項全數 PASS，D5-1／D5-1b 無回歸。但完整 `npm test` 目前**不是** exit code 0：改動依設計正確地讓 `IPO_ANNOUNCE` 可以懸置給「非當前回合的真人」，這揭露了兩個既有測試（都不在我可改範圍內）原本沒被涵蓋到的情境，各自出現新增 FAIL，需要 architect 裁決下一步（細節見下方「需要其他角色或製作人決定的事」），我沒有自行擴大範圍去動 `src/ui/`。

## 變更檔案清單

| 檔案 | 變更 | 備份 |
|---|---|---|
| `src/engine/reducer/applyAction.js` | `E.openIpo` 最後一行，從「只推給觸發者（且限真人）」改成「開盤當下 `S.players.forEach` 同步推給全場還在場、沒破產的真人」，逐字採用補充裁決文件的程式碼。1 行刪除、8 行新增（含 4 行註解）。 | `applyAction.js.backup.20260911` |
| `tests/s45test.js` | 在 D5-1b 之後新增 `D5-1c（T-004）` 測項（42 行），只新增不改既有。 | `tests/s45test.js.backup.20260911` |

`git diff --stat`：
```
 src/engine/reducer/applyAction.js |  9 ++++++++-
 tests/s45test.js                  | 42 +++++++++++++++++++++++++++++++++++++++
 2 files changed, 50 insertions(+), 1 deletion(-)
```

完整 diff 已逐段核對，內容與補充裁決文件「具體改法」段落完全一致。

## 測試證據

### 1. `node tests/s45test.js`（S1 段落，我負責的部分）

```
OK   D5-1：真人踩到 MARKET 格且新股到期 → 不抽市場卡、改推 IPO_ANNOUNCE 決策  MARKET 格觸發成功，決策可正常 ACK 掉
OK   D5-1b：電腦踩到 MARKET 格且新股到期 → 直接 ACK，不佔用 decisionQueue  電腦踩格：直接處理、不卡決策佇列
OK   D5-1c（T-004）：電腦觸發開盤 → 場上所有真人（不只觸發者）都收到 IPO_ANNOUNCE，且互不干擾  電腦觸發後，2 位真人各自收到卡、互不干擾、依序解卡成功
OK   整合：8 個種子全電腦局，ipoLottery=1 全程跑完，無 NaN、無帳本殘留、gate 同款不變式成立  8 個種子全部跑完，累積結算 14 檔，無 NaN、無帳本殘留
{"pass":19,"fail":0,"pageErrors":0}
```
S1 段落原本 18 項全數維持 PASS，新增第 19 項也 PASS，**單真人局與雙真人局的驗證都在這一項裡完成**：
- 單真人局收到卡：混合局 `mk(20,false)` + `S.players[1].isNPC=false` 湊出 player0／player1 真人、player2／player3 電腦；電腦（player2）觸發 `E.openIpo` 後，斷言 player0、player1 各剛好收到一筆 `IPO_ANNOUNCE`，player2、player3 完全沒有——直接證明原本製作人回報的「電腦觸發、真人收不到卡」bug 已修掉。
- 雙真人局各自收卡驗證：斷言 FIFO 順序（player0 先、player1 後）、player1 不能代答 player0 的卡（`wrong.rejected===true`，實際命中既有 `NOT_YOUR_TURN` 守衛，見下方說明）、player0 解卡後 player1 的卡 `decisionId` 不變、仍在佇列裡，之後 `pendingDecision` 正確換到 player1，player1 也能正常解掉。

**一個小修正（過程中發現，已在測試裡改掉，不影響結論）**：原本我照票面描述預期「代答別人的卡」會命中 `NOT_YOUR_DECISION`，實測發現因為 player1 當時不是當前回合玩家，實際先命中的是 `applyAction.js:234-236` 的 `NOT_YOUR_TURN`（`DECIDE` 的 off-turn 條件要求 `d.playerId===actor.id` 才放行）；只有當前回合玩家去代答別人的卡才会命中 switch 內的 `NOT_YOUR_DECISION`。兩層守衛都是既有機制、都沒被我的改動動到，測試已改成只斷言「一定被拒」，不鎖死是哪一種 reject 碼，並在註解寫清楚原因。

### 2. `node tests/s45test.js`（S2 段落，ui-engineer 的既有測項）—— 新增 2 項 FAIL

```
OK   決策卡 IPO_ANNOUNCE：兩檔並排顯示申購價／參考價／價差／中籤率；...
FAIL 申購小資檔：送出 IPO_SUBSCRIBE、決策卡關閉、淨值面板出現「申購預扣款」、不留一句看不懂的「決定：sub_small」 :: 決策卡應該已經關閉
FAIL 都不要：送出 IPO_DECLINE、決策卡關閉、不扣現金 :: 決策卡應該已經關閉
OK   交易所「📢 新股申購中」列：...
OK   訊息欄／POP：...
{"pass":3,"fail":2,"pageErrors":0}
```
已用 `git stash` 驗證：改動前這 5 項全數 PASS（`{"pass":5,"fail":0,"pageErrors":0}`）。

根因：S2 段落的 `runS2Page` 用的四人局 fixture（`tests/s45test.js:477`）是
```js
const four=["我","小美","槓桿哥","風投弟"].map((n,i)=>({name:n,isNPC:i>=2, ...}));
```
註解寫「0 號真人……其餘電腦」，但 `isNPC:i>=2` 實際上讓 index 0**與** index 1 都是 `isNPC:false`（真人），只有 index 2、3 才是電腦——這與註解描述不符。舊版 `E.openIpo` 只會推卡給「觸發者本人」（測試都是手動呼叫 `E.openIpo(S,S.players[0])`），所以 player1 是不是 NPC 從未被觸及，這個 fixture 的落差一直沒有暴露。改成「推給全場真人」之後，player1（fixture 裡意外的第二個真人）也會收到一張 `IPO_ANNOUNCE`；這兩項測試只解掉 player0 的卡就斷言「決策卡應該已經關閉」，但佇列裡還留著 player1 的卡，`S2.pendingDecision.kind` 仍是 `IPO_ANNOUNCE`，因此斷言失敗。

這個 fixture 在 `src/ui/uiViews.js` 以外的 `tests/s45test.js` S2 段落裡（S2 由 ui-engineer 負責），依分派單「`tests/s45test.js`（僅新增測項，不改既有）」我不能動它，見下方「需要其他角色或製作人決定的事」。

### 3. `node tests/runtests.js`（引擎不變式 selftest，`src/ui/uiViews.js` 內建）—— 新增 1 項 FAIL

```
{"pass":96,"total":97}
  ❌ T-59 引擎不變式：待決策一定屬於當前玩家（有真人在場也不會卡住） :: 有真人在場時不得卡住：電腦回合連 END_TURN 都被拒（phase=DECISION，待決策 IPO_ANNOUNCE 屬於 P0）
```
已用 `git stash` 驗證：改動前 `{"pass":97,"total":97}`，全數 PASS。

根因：`T-59` 測項（`src/ui/uiViews.js:5464-5552`）的 (b) 段「死當重現」模擬一個「P0 真人＋P1／P2 電腦」的局，驅動迴圈裡：
- 當 `cur=E.activePlayer(S2)` 是真人（`!cur.isNPC`）時，才會處理 `S2.pendingDecision && S2.pendingDecision.playerId===cur.id` 的 `DECIDE`；
- 當 `cur` 是電腦時，只會嘗試 `ns.npc.nextAction` 或 `END_TURN`，**完全沒有處理「pendingDecision 屬於 P0（真人），但現在輪到電腦」這個情況**。

這正是本次改動之後會出現的合法情境：電腦觸發 `openIpo`，`IPO_ANNOUNCE` 推給 P0（真人），但當下輪到的是別的電腦玩家。真實 UI（`uiViews.js` 的 NPC 自動回合驅動）在 `S.phase==="DECISION"` 時會整桌暫停、等真人在自己畫面上解卡（ADR 補充裁決文件「lockstep 風險評估」已明確分析並認定這是既有、已上線的 `STOCK_GAIN` 同款行為，不是新風險）；但 `T-59` 這段測試迴圈本身沒有模擬「真人可以在非自己回合解掉自己的懸置決策」這條路徑，於是卡死在「電腦回合連 END_TURN 都被拒」。

`STOCK_GAIN`（`contentNpcSim.js:103-116`）用的是完全相同的「`S.players.forEach` 推給所有真人，不管現在輪到誰」寫法，理論上有同樣的風險，但因為 `T-59` 的測試局裡真人 P0 從頭到尾沒有主動買股票（`costBasis>0` 的前提不成立），從未觸發過 `STOCK_GAIN`，所以這個測試迴圈的缺口一直沒被踩到。IPO 排程是輪次到期就會觸發（不需要真人做任何動作），在 8 個種子、4000 步的範圍內命中率高很多，所以這次被我的改動直接踩中。

**這不是我這次改動邏輯錯誤，而是它把一個「既有測試模擬迴圈的既有缺口」從低機率（依賴真人主動買股）變成高機率（IPO 到期即觸發）。** 我沒有能力也沒有權限判斷「該補測試迴圈」還是「該重新評估設計」，`src/ui/uiViews.js` 也不在我的可改範圍內，所以在此停下，回報 architect。

### 4. `npm test`

```
npm run test:engine && npm run test:ui
```
- `test:engine`（`build` + `contentcheck` + `extract` + `gate.js`）：全綠，`{"errors":0,"warnings":3}`（3 個既有 WARN 與本次改動無關）、`{"games":1000,"NaN":0,"Infinity":0,"invalidGames":0,"invalidReasons":{},"assetLedgerMismatch":0}`。
- `test:ui`：第一支 `tests/runtests.js` 就出現上述 T-59 FAIL（`{"pass":96,"total":97}`），因為指令鏈用 `&&`，後面 `s17test.js…s45test.js…editortest.js` 沒有機會執行。

**最終 `npm test` exit code：1（非 0）。**

跑完測試後已用 `git checkout -- index.html card_editor.html` 還原建置產物，目前工作區只有 `src/engine/reducer/applyAction.js` 與 `tests/s45test.js` 兩個檔案有異動（`git status --short` 確認過）。

### 自我檢查清單（CLAUDE.md 第 3 節）
- 沒有用到 `Math.random`、`Date.now`、`new Date`、`window`、`document`、`localStorage`——改動只有 `S.players.forEach` 讀 state 內既有欄位（`isNPC`、`bankrupt`），純函數、無外部依賴。
- 沒有直接改 `player.cash` 等餘額欄位——這次改動完全不碰任何金流／帳本，只改「要不要推決策卡」。
- 沒有寫死數字——沒有新增任何數值參數。
- 舊存檔載入：`E.openIpo` 的觸發條件（`E.ipoDue`）與資料結構都沒變，只改了跳卡對象；`s45test.js` 的「⑨ 舊存檔／關閉時不觸發」一項本次仍 PASS。

## 未預期發現

1. **`tests/s45test.js` S2 段落的 `four` fixture（第 477 行）本身有既有落差**：註解寫「0 號真人……其餘電腦」，程式碼卻是 `isNPC:i>=2`（player0、player1 都是真人）。這個落差在舊版 `E.openIpo`（只推給觸發者）下完全不會被踩到，這次改動後才暴露成 2 項 FAIL。這個檔案的 S2 段落屬於 ui-engineer 的既有測項，依分派單我不能動。
2. **`src/ui/uiViews.js` 的 `T-59`（引擎不變式 selftest）的死當重現模擬迴圈（(b) 段，約 5500-5546 行）沒有模擬「真人在非自己回合解掉自己的懸置決策」這條路徑**，只在「當前玩家剛好是那個真人」時才會嘗試 `DECIDE`。這個缺口理論上對既有的 `STOCK_GAIN`（同樣用 `S.players.forEach` 對所有真人推卡，不管現在輪到誰）也成立，只是機率低到目前測試種子範圍內從沒踩到。這次改動讓 `IPO_ANNOUNCE` 的觸發不依賴真人任何主動行為（到期即觸發），命中率大幅提高，直接暴露了這個既有缺口。這個檔案不在我的可改範圍（`src/ui/`）。
3. architect 補充裁決文件已提到、且裁示本次不用修的「交易所面板『已表態 X／Y』分母把電腦玩家也算進去」——已知悉，沒有動它。

## 需要其他角色或製作人決定的事

這是本次的核心受阻點，需要 architect 裁決，我沒有自行判斷或擴大範圍去修：

1. **`T-59` 的死當重現模擬迴圈是否需要補上「真人可以在非自己回合解掉自己的懸置決策」這條路徑？** 如果需要，這是 `src/ui/uiViews.js` 的改動，超出我的角色範圍，需要指派 ui-engineer 或 architect 親自處理；也需要一併確認：真實 UI（NPC 自動回合驅動邏輯）是否真的如 ADR 補充裁決文件所述、在 `S.phase==="DECISION"` 時會正確暫停等真人在自己畫面解卡（這件事我沒有能力驗證，因為那是 UI 層行為，不是我能跑的引擎測試）。
2. **`tests/s45test.js` S2 段落的 `four` fixture 要不要順便修正**（`isNPC:i>=2` → 註解說的「只有 0 號真人」語意，可能是 `i>=1`）？如果修，這也是 S2 段落既有測項的建局方式，依分派單我不能動，需要 ui-engineer 或 architect 拍板後由對應角色執行。
3. **裁決結果出來、`src/ui/uiViews.js` 與/或 S2 fixture 修好之後，需要我重新跑一次完整 `npm test` 確認 exit code 0**——這部分我隨時可以接手，只是要先等上面兩點的裁決與（若需要）ui-engineer 的配合。

在裁決前，我的兩個檔案改動（`E.openIpo` 本體、`D5-1c（T-004）` 測項）本身已完整驗證通過（單真人局、雙真人局、D5-1／D5-1b 無回歸、19/19 全綠），可以視為 S1 範圍內「完成」；卡住的是整個 `npm test` 尚未綠燈，需要範圍外的協作才能收尾。
