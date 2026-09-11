# T-003 T-86／S14b EXTEND_GAME 斷言失敗 — engine-engineer 回報

- 執行者：engine-engineer（Claude Code）
- 日期：2026-09-11

## 結論（受阻，依票內驗收條件 6 停下待 architect 確認）

根因已定位在 `E.beginTurn` 內與 T-001 新股（IPO）機制共用的「保底補開」段落
（`src/engine/reducer/applyAction.js:4262-4270`，緊接在票內 3.2 節第 3 點標示的
`applyAction.js:4245-4260` 之後、屬於同一個 T-001／ADR-001 IPO 功能區塊），依票內驗收條件 6
明確要求「修改前需知會 architect」，**本次未做任何實質修改**，已將除錯用的暫時性
`console.log` 與因此重建的 `index.html`／`card_editor.html` 全部還原到 git HEAD 狀態
（`git diff --stat HEAD -- src/engine/ index.html card_editor.html` 為空）。

`npm test`／`node tests/runtests.js` 目前結果仍與修改前相同：96/97 通過，T-86 為唯一失敗項，
與拿到票時的起始狀態一致，未引入任何新增 FAIL。

## 變更檔案清單

**無永久性變更。** 過程中對以下檔案做過「除錯用暫時修改 → 已還原」，最終與 HEAD 逐位元相同：
- `src/engine/core/engineCore.js`（暫時在 `ledger.post` 加一行受 `globalThis.__T86_DEBUG` 旗標保護的
  `console.log`，除錯用，已還原，未提交）
- `src/engine/reducer/applyAction.js`（暫時在 `E.beginTurn` 開頭加一行同旗標保護的
  `console.log`，除錯用，已還原，未提交）
- `index.html`／`card_editor.html`／`dist/index.html`（因上述除錯改動觸發 `npm run build` 重新產生，
  已用 `git checkout` 還原前兩者；`dist/index.html` 屬 `.gitignore` 忽略的建置產物，不影響版控狀態）
- `tests/_t86_debug_tmp.js`、`tests/_t86_debug_tmp2.js`（暫時性除錯腳本，跑完已刪除，未提交）

`git diff --stat HEAD -- src/engine/ index.html card_editor.html` 執行結果為空，確認工作區與
HEAD 一致，未留下任何改動。

## 根因說明（具體，附證據）

### 定位過程
1. 先用未修改的 `index.html`（HEAD 版本）跑 `node tests/runtests.js` 重現失敗：
   ```
   {"pass":96,"total":97}
     ❌ T-86 S14b 回合上限與延長（EXTEND_GAME） :: 續攤不得重算超過一位玩家的現金（發薪只該發給接回的那一位）
   ```
2. 依票內建議，在 `ledger.post`（`engineCore.js`）與 `E.beginTurn`（`applyAction.js`）加上受
   `globalThis.__T86_DEBUG` 旗標保護的臨時 log，`npm run build` 後用 Playwright 直接在頁面內重放
   T-86 情境 (b) 的建局／續攤序列（與 `uiViews.js:1608-1621` 完全相同的呼叫），只在
   `E.apply(S2,{type:"EXTEND_GAME",...})` 前後開關旗標，避免其他測項的 log 干擾。
3. 實測輸出（`[T86]` 為標記，非提交碼）：
   ```
   [T86][beginTurn] activePlayerIdx=0 p.id=0 turn=100
   [T86][ledger.post] playerId=1 delta=-38.19 summary=新股申購：桌遊出版工作室（虛構） turn=100
   [T86][ledger.post] playerId=0 delta=11 summary=發薪日結算 turn=100
   ```
   可見「接回那一輪的當事人」是 `p.id=0`（player A），但 `playerId=1`（NPC player B）也在
   同一次 `E.beginTurn` 呼叫內被過帳了一筆新股申購款 `-38.19`。
4. 進一步印出 `S2.ipo` 狀態確認觸發路徑：
   ```json
   "ipoScheduleBefore": { "schedule": [16, 43], "fired": [false, false], "pending": null }
   "idxDue0": -1,          // 第 1 輪時還沒到期
   "idxDueAtEnd": 0,       // 續攤前 turnNumber 已被測試直接推到 maxTurns+1，schedule[0]=16 早已過期未開
   "ipoStateAfter_pending": {
     "id": "IPO1", "fromId": 0, "openedTurn": 100,
     "subs": { "1": ["SMALL"] }   // NPC player 1 在這次 beginTurn 內自動申購了 SMALL 檔
   }
   ```

### 根因
1. `src/ui/uiViews.js:1608-1609` 的 T-86 測試情境 (b) 為了模擬「時間到結束」，用
   `S2.turnNumber=S2.config.maxTurns+1` **直接跳輪次**，不經過正常的
   `endTurn → beginTurn` 逐輪流程，因此 `mkGame` 建局時排定的 IPO 排程
   `S.ipo.schedule=[16,43]`（`fired:[false,false]`）在跳過的第 2～99 輪期間，
   **從未被任何一次 `E.beginTurn` 檢查過**，是否該開盤（正常玩法下 `MARKET` 格觸發或
   T-001 的保底邏輯，每輪 `beginTurn` 都會 check 一次，不會累積成這麼大的落差）。
2. `EXTEND_GAME` 續攤時呼叫 `E.beginTurn(S)`（`applyAction.js:1305`），這是續攤唯一會執行到的
   共用回合起始邏輯。`E.beginTurn` 內 T-001（ADR-001 D5-2）「保底：排定輪次過了
   `ipoGraceTurns` 都没人踩到 MARKET 格觸發，在輪首由他開啟公告」這段
   （`applyAction.js:4262-4270`）判斷 `S.ipo.schedule[idxG]+graceT < S.turnNumber`
   （`16+3=19 < 100`，成立）且 `p===E.alive(S)[0]`（p 是續攤接回的 player 0，成立），
   於是呼叫 `E.openIpo(S,p)`。
3. `E.openIpo`（`applyAction.js:4640-4651`）**同步**呼叫 `E.ipoPollNPC(S)`
   （`applyAction.js:4653-4679`），這個函式會遍歷所有符合條件的電腦玩家，只要現金／保留款
   條件夠就直接 `ledger.post` 扣款申購——這正是本例讓 `playerId=1`（NPC）現金被動到的地方。

**簡言之：根因不是票內假說列的 `E.settleSyndicate`／`E.settleIpo`（既有 pending 結算），
而是同一個 `E.beginTurn` 函式內、緊鄰在票內標示範圍（`4245-4260`）之後的
T-001 IPO「保底補開」段落（`4262-4270`）連帶觸發的 `E.openIpo → E.ipoPollNPC`
NPC 自動申購邏輯。** 這段邏輯本質上也是「多位玩家共用的回合起始流程」，且是
T-001／ADR-001 D5-2 明確設計的一部分（避免 IPO 排程永遠沒人踩到而卡住），
修改它（不論是「EXTEND_GAME 續攤時跳過保底開盤」或「保底開盤時不讓 NPC 同步申購」
或「調整判斷條件」）都會動到 T-001 剛驗收上線的 IPO 機制在**所有**回合起始時的行為，
不只是 EXTEND_GAME 專屬的程式碼路徑。依票內驗收條件 6，**這正是「根因牽涉到 `E.beginTurn`
內與 S39 集資／T-001 新股結算共用的段落」的情況，本次停下不動手，回報等待轉 architect 確認**。

### 附帶排除的假說（票內 3.2 節列出的其餘 3 個）
- **`ns.modules.onTurnStart(S,p)`／`onPayday` hook**：實測 log 顯示每輪只有 `payday` 對 `p.id`
  本人過帳（例如 `turn=1` 只有 `playerId=0` 的「發薪日結算」），沒有觀察到這兩個 hook
  對非當前玩家產生現金副作用，予以排除。
- **`S.pendingSyndicate` 集資結算**：實測 `pendingSyndicate` 在整個情境 (b) 過程中皆為
  `null`（見上方 log `"pendingSyndicate": null`），未觸發 `E.settleSyndicate`，予以排除。
- **`S.ipo.pending` 既有結算（`E.settleIpo`）**：實測續攤呼叫 `E.beginTurn` 前
  `ipo.pending` 為 `null`（見 `"ipoPending": null`），所以走的不是「結算既有 pending」
  這條路，而是「保底邏輯開出一個全新的 pending 並同步讓 NPC 申購」——與票內假說 3
  的方向一致（都在 T-001 IPO 這一段），但具體觸發函式不同（`E.openIpo`／`E.ipoPollNPC`
  而非 `E.settleIpo`），特此更正供 architect 參考。
- **測試斷言本身寫法有誤（票內 3.2 節第 4 點，`p.cash=X` 後 `ledger.recompute` 陷阱）**：
  複查 `uiViews.js:1611/1619`，斷言只是單純讀 `z.cash`，沒有手動竄改欄位，排除此類陷阱。
  但斷言的**建局方式**（情境 (b) 用直接推 `turnNumber` 模擬「時間到」，跳過中間所有
  `beginTurn` 檢查）確實是誘發本問題的必要條件之一——這點留給 architect 判斷是否要一併
  檢討測試建局方式，還是只修 engine 行為。

## 測試證據

除錯前後的完整測項比對（用 `node tests/runtests.js` 對照 HEAD 版本 `index.html`，
除錯用暫時修改已全數還原，不影響最終比對結果）：

```
$ node tests/runtests.js
{"pass":96,"total":97}
  ❌ T-86 S14b 回合上限與延長（EXTEND_GAME） :: 續攤不得重算超過一位玩家的現金（發薪只該發給接回的那一位）
```

除錯階段（暫時性、已還原）的關鍵中介輸出已整理在上方「根因說明」段落，逐字引用如上。

因未做任何實質修改，本次未執行「相同 seed／action 序列重放兩次比對」（驗收條件 4 適用於
「根因確認是 engine 邏輯錯誤且已修正」之後，本票目前狀態是「已定位、待 architect 裁決」，
尚未進入修正階段）。

## 未預期發現

1. **`.claude/hooks/check-forbidden.sh` 誤報（pre-existing，與本次改動無關）**：
   此 PostToolUse hook 用 `grep -RnE 'Math\.random|Date\.now|new Date\(|localStorage|document\.|window\.'`
   掃整個 `src/engine/`，會誤命中 `src/engine/core/engineCore.js:3` 的**檔頭註解**
   （`鐵律一：引擎不讀寫 DOM、不使用 Date.now() / 未播種的 Math.random()`）——這行只是文件說明，
   不是實際呼叫。用 `git show HEAD:src/engine/core/engineCore.js` 確認此註解在 HEAD
   即已存在，與本次任何操作無關，純粹是 hook 的規則沒有排除註解文字或
   `.claude/hooks/forbidden-allowlist.txt` 尚未收錄這一行。本次除錯過程中每次
   Edit／Write 都會觸發這則誤報，不影響實際檔案內容（已逐一確認還原後內容與 HEAD
   一致），未列入任何實質變更，僅在此提醒——若之後有人要在 `src/engine/` 動刀，
   會一直看到這個誤報，建議日後把這行加進 allowlist（不在本票範圍內，未動手）。
2. **測試建局方式本身放大了問題**：`mkGame(8602)` 之後直接改 `S2.turnNumber`
   跳過 97 輪，讓原本「每輪都會 check 一次」的 IPO 保底邏輯累積成單次大跳躍觸發，
   這在真人正常遊玩（每輪都跑 `endTurn→beginTurn`）下未必會以同樣方式重現——不代表
   `E.beginTurn` 這段邏輯在正常對局中完全沒有「NPC 在別人回合開盤時現金被動到」的可能
   （只要「IPO 剛好在某人的 `beginTurn` 才被保底邏輯打開」，NPC 申購本來就會發生在
   當前回合玩家以外的人身上），但用測試的極端跳輪次手法把它放大成了 100% 必現。
   這點也留給 architect 判斷：這是否本來就是 T-001 IPO 保底機制的既有已知行為
   （NPC 可能在任何人回合起始被動申購），只是測試斷言「續攤只能動當事人一人」
   與這個既有行為衝突。

## 需要其他角色或製作人決定的事

依票內驗收條件 6，本票在此打住，需要製作人轉 architect 確認以下幾個問題後才能繼續：

1. **這是否算「涉及共用結算段落」**：我定位到的根因是 `applyAction.js:4262-4270`
   （T-001 IPO 保底補開，呼叫 `E.openIpo`→`E.ipoPollNPC`），比票內明確列出的
   `4245-4260`（`E.settleSyndicate`／`E.settleIpo`）晚了兩行、屬於同一個 IPO 功能區塊但
   不是同一個 if 分支。請 architect 確認這是否落在「共用結算段落」的認定範圍內
   （我判斷是，因為同樣是 `E.beginTurn` 內對多玩家有現金副作用、且是 T-001 剛驗收的邏輯）。
2. **修法方向**：若確認要修，可能的方向包括（僅列選項，未評估優劣，交給 architect／製作人裁決）：
   - (a) `EXTEND_GAME` 續攤呼叫 `E.beginTurn` 時，用某種旗標跳過本輪的 IPO 保底補開檢查
     （但這樣會讓 `EXTEND_GAME` 的回合起始行為與正常 `beginTurn` 不一致，需評估是否可接受）。
   - (b) `E.openIpo` 開盤當下不要同步跑 `E.ipoPollNPC`，改成排到下一次真正輪到 NPC 時才申購
     （影響所有正常對局的 IPO 開盤時序，範圍更大，需要重跑 `tests/s45test.js` 全面驗證）。
   - (c) 認定這其實是既有設計下的合理行為（NPC 本來就可能在別人回合起始被動申購），
     改測試斷言本身（例如把 (b) 情境的建局方式換成真的逐輪跑過 `beginTurn`，
     或放寬斷言為「只有當事人／因保底 IPO 開盤而被動申購的 NPC 可以變動」），
     但這需要先確認「續攤只讓當事人現金變動」這個產品需求本身是否仍然成立
     （若正常對局中 NPC 本來就可能在任何人回合被 IPO 保底邏輯動到現金，這個測試假設可能從一開始就不完全成立）。
3. 若 architect 裁定方向 (a) 或 (b)，需要再次確認 `tests/s39test.js`、`tests/s45test.js`
   （票內驗收條件 6 要求）全數重跑無新增失敗，這部分我尚未動手，待裁示後再執行。

## 尚未做的事（待裁示後续做）

- 未修改任何 `src/engine/` 檔案（已確認與 HEAD 逐位元一致）。
- 未修改 `tests/`（`uiViews.js` 的 T-86 測項本身也不在 `src/ui/` 修改權限內，
  若最終方向是修正測試斷言，需另外確認這段測試邏輯歸屬——它物理上在
  `src/ui/uiViews.js`，但票內第 5 節已裁示「性質是引擎回歸測試，屬 engine-engineer
  可動的 `tests/` 範圍」，故若裁示為修測試，仍由本人接手）。
- `npm test` 整體 exit code 尚未回到 0（T-86 仍是唯一已知失敗項），有待此票後續裁示並修正後才能達成 T-002／T-003 的最終閉環驗證。
