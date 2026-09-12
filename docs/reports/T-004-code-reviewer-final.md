# T-004 程式審查報告（code-reviewer，唯讀）

- 對應：`docs/tickets/T-004-新股公告通知不足.md`、`docs/tickets/T-004/dispatch.md`
- 日期：2026-09-11
- 備註：此檔案由主對話（Cowork）於 code-reviewer 回報後代為補寫存檔——code-reviewer 當時在對話中回覆了完整審查文字，但未實際執行 Write 落地此檔案，經 pm-planner 處理 T-006 時用 Glob 查證發現缺漏，此處逐字補上原始回覆內容，未做任何增刪。

## 判定：**通過**（無 Blocker；1 項 Major 建議後續追蹤、不阻擋本次 release；其餘為 Minor／Nit）

---

## 審查範圍

`git diff`（工作區未提交異動，對照 HEAD `5a06845`）涉及以下 6 個檔案，與 dispatch／ADR 表列完全一致，無範圍外異動：

- `src/engine/reducer/applyAction.js`（`E.openIpo`，第 4646-4657 行）
- `src/ui/uiCore.js`（`ui.renderCenter`，第 1866-1892 行附近，修法 A）
- `src/ui/uiViews.js`（`ui.tick` 守門，第 741-753 行，修法 B；`T-59` (b) 段模擬分支，第 5519-5541 行附近，修法 C）
- `tests/s18test.js`（30 輪驅動迴圈補同款分支，第 47-66 行）
- `tests/s45test.js`（新增 `D5-1c（T-004）`；S2 段 `four` fixture 第 477 行筆誤修正）
- `docs/adr/ADR-001-新股抽籤.md`（D5 節與修訂記錄更新，文件與程式碼一致）

我已逐行比對這 6 個檔案的實際 diff 與 `ADR-001-新股抽籤-T004補充裁決.md`／`補充裁決2.md` 的「具體改法」段落——**完全逐字一致**，沒有『裁決文件寫一套、實作又做另一套』的落差。

**獨立重跑測試證據**（把 repo 複製一份到 scratchpad 重新 build，未觸碰實際工作區的 `index.html`／`card_editor.html`，`git status -- index.html` 全程乾淨）：
- `node tests/s45test.js` → S1 段 `{"pass":19,"fail":0,"pageErrors":0}`（含 `D5-1c（T-004）` OK）、S2 段 `{"pass":5,"fail":0,"pageErrors":0}`
- `node tests/runtests.js` → `{"pass":97,"total":97}`
- `node tests/s18test.js` → `{"pass":20,"fail":0}`（第一次漏複製 `assets/` 目錄導致誤判 FAIL，補上後確認是環境問題不是程式問題）
- `node tests/editortest.js` → `{"pass":13,"fail":0,"pageErrors":0}`

四項數字與 QA 報告、engine/ui-engineer 自報完全一致，證實所有角色的「自驗宣稱」都經得起獨立重跑。

---

## CLAUDE.md 第 3 節七條逐條核對

| 條款 | 結果 | 依據 |
|---|---|---|
| 1. 狀態只能透過 action 前進／engine 純函數 | ☑ | `E.openIpo` 的新 `forEach` 只讀 state 既有欄位（`q.isNPC`／`q.bankrupt`），不讀時間／DOM／全域變數；uiCore/uiViews 修法只讀 state 做渲染／守門判斷，不寫入 state |
| 2. 隨機數來自 seeded RNG，可重放 | ☑ | `E.pushDecision` 的 `decisionId` 來自 `util.uid(S,"d")`（`S.uidSeq` 遞增計數器，非時間戳，已讀碼確認，`engineCore.js:32`），不涉及 `Math.random()` |
| 3. 複式帳本是唯一真相 | ☑ | 本次改動不碰任何金流／ledger 分錄，`IPO_ANNOUNCE` 只是通知性決策卡 |
| 4. 參數資料驅動 | ☑ | 未新增任何寫死的平衡數字 |
| 5. 向下相容用 feature flag | ☑ | 非新機制，是既有渲染／驅動邏輯的正確性修復；`ipoLottery` 開關與 `S.ipo` 存在性沿用既有 feature flag |
| 6. AI 對手與人類路徑都要測 | ☑ | `D5-1c` 覆蓋「電腦觸發＋多位真人各自收卡」；`T-59`(a) 仍覆蓋 AI 對手路徑不變式掃描；`T-59`(b)／`s18test.js` 補上「電腦回合中真人非回合解卡」這條原本沒被覆蓋的組合路徑 |
| 7. 多人同步不得破壞 lockstep | ☑，但有一個**建議追蹤的既有風險被放大** | `S.players.forEach` 是固定陣列座位序（非 `Object.keys`），`decisionId` 生成器確定性已驗證；已讀碼確認 `src/network/syncAdapter.js`（本次未觸碰）已有對應的 `mpAfter` 守門（第 752-756 行，`pd.playerId` 屬於真人就不代跑），與本次 `ui.tick` 修法 B 是同一套邏輯，證實多人房主端本來就有這層保護。**但**現有 `mpForceLeaveWhy`（`syncAdapter.js:728-735`）判斷「可強制代打」只認「離線」或「輪到他但久未動作」，**不認得「持有一筆非回合懸置決策」**——如果某位真人離線時手上剛好卡著一筆 off-turn 的 `IPO_ANNOUNCE`／`STOCK_GAIN`，其他人無法用既有機制把他代打掉，全桌會安靜卡住（`ui.tick`／`mpAfter` 的守門只是「安靜等」，不會誤報卡住，但也永遠不會被強制代打解套）。這**不是本次 diff 新引入的 bug**（`STOCK_GAIN` 早就有同樣暴露面），但 T-004 把 `IPO_ANNOUNCE` 也納入 forEach 廣播，且 IPO 開盤是「到期必發生、不需要真人主動觸發」的事件，出現頻率遠高於「帳上獲利達門檻」的 `STOCK_GAIN`，等於把這個既有低機率風險的命中率顯著推高。ADR 補充裁決 1 已經預見「頻率變高」並要求 QA 補一次 mp smoke test，QA 也確實補了（`qa-t004-mp-smoke.js`），但測的是「兩位真人都在線、正常應答」的 happy path，**沒有覆蓋「持有 off-turn 決策的真人離線／掉線」這個邊界**。 |

---

## Findings

### Major

**M1｜位置：`src/network/syncAdapter.js:728-735`（`mpForceLeaveWhy`）＋ T-004 造成的暴露面放大，非本次 diff 引入**
- 問題：多人局裡，「可被其他玩家強制代打」的判斷只認「離線」或「輪到他但閒置超時」，不認「手上持有一筆非回合懸置決策（`S.pendingDecision.playerId===他` 但不是當前回合玩家）」。
- 失敗情境：2 真人＋N 電腦局，某位真人 A 因為 T-004 這次修法在非自己回合收到 `IPO_ANNOUNCE`（或既有的 `STOCK_GAIN`），此時 A 斷線／關頁不回來。房主端 `mpAfter`（`syncAdapter.js:752-756`）與其他玩家端的守門都會「安靜等待」，`E.waitingOnHumans` 也不認得 `pendingDecision`；`mpForceLeaveWhy` 因為 A 此刻不是 `activePlayerIdx`（是輪到某個電腦或另一位真人），永遠回傳 `null`，其他真人的「🤖 請電腦代打」按鈕不會出現，遊戲卡死到 A 回來為止。
- 為什麼現在提：這個 gap 在 `STOCK_GAIN` 時代就存在（機率低，靠玩家主動買股票且剛好在門檻附近才會觸發），T-004 讓 `IPO_ANNOUNCE`（到期必發、不需要任何人主動行為）也走同一套廣播模式，實質提高了「真人持有 off-turn 決策」這個狀態出現的頻率，因此連帶提高了這個既有 gap 被踩到的機率。ADR 補充裁決 1 已經明確承認「頻率變高」，只要求 QA 做一次 happy-path smoke test，沒有要求測離線邊界。
- 建議：不要求本次修（不在 T-004 授權範圍、`syncAdapter.js` 屬 network-engineer），但建議開一張後續票，把 `mpForceLeaveWhy` 的判斷擴大成「離線 or（輪到他且閒置）or（持有非回合懸置決策且離線）」，並且請 qa-tester 之後補一項「真人持有 off-turn 決策時斷線」的 mp 邊界測試。這不阻擋本次 release，但建議列入下一輪 sprint 的已知風險追蹤，不要讓它沉默消失。

### Minor

**m1｜位置：`src/engine/reducer/applyAction.js:3642-3646`（`E.enterBankruptcy` 上方註解，S42 既有）**
- 問題：該處註解寫「引擎不變式『待決策一定屬於當前玩家』」，這句話在 T-004 之後不再成立（`STOCK_GAIN`／`IPO_ANNOUNCE` 是明確的例外）。這不是本次 diff 改的檔案位置（本次沒有碰這段），但同一份檔案裡現在同時存在「不變式一定成立」與「兩個刻意打破它的機制」，容易讓下一個讀碼的人誤信舊註解、做出錯誤假設。
- 建議：非阻擋項，但建議這次順手（或另開小票）在該註解補一句「除 STOCK_GAIN／IPO_ANNOUNCE 兩個 forEach 廣播例外」，避免未來考古成本。

**m2｜位置：`docs/adr/ADR-001-新股抽籤-T004補充裁決.md` 第 119 行（既有小瑕疵，非本次程式碼範圍）**
- 交易所面板「已表態 X／Y」分母把電腦玩家也算進去，裁決文件已記錄為「不要求本次修」，我同意這個判斷（不影響正確性／金流），維持 Minor、不需列入本次修復。

### Nit

**n1｜`src/ui/uiViews.js:749`／`tests/s18test.js`／`T-59`(b) 三處幾乎逐字相同的守門邏輯（`pd.playerId!==curId` 判斷）出現三次**（`ui.tick`、`T-59`(b)、`s18test.js`），加上 `syncAdapter.js:752-756` 是第四份近似邏輯。目前用註解互相引用（"比照 uiViews.js T-59 (b) 段修法 C 的同一套手法"）維持住了可讀性，但四處重複同一段「找 pendingDecision 擁有者」的邏輯，未來若這段判斷需要改（例如要支援 M1 建議的離線代打），要記得四處一起改。建議之後有機會抽成共用 helper（例如 `E`／`ui` 上一個 `pendingDecisionOwner(S)`），但不要求本次補，純觀察。

---

## 你要求的重點逐項回覆

1. **`ui.renderCenter` 判斷順序（修法 A）**：已讀碼確認搬動後 `BOOKKEEPING` 分支維持原位置不變（裁決文件已論證 `S.bookkeeping.playerId` 恆等於當前回合真人，不受歸屬不一致影響），搬動範圍精準只動「決策卡／破產」與「NPC 思考中」兩段順序，內部邏輯逐字未變，沒有發現漏掉其他既有情境。

2. **`ui.tick` 守門（修法 B）**：讀碼確認守門條件只排除「`pendingDecision` 存在且屬於非當前回合玩家」這一種組合，不會誤擋任何合法的電腦自動回合推進——因為只要 `pd.playerId===curId`（決策就是當前玩家自己的，含電腦自己的 `BANKRUPTCY`／`CHOOSE_DECK` 等）或 `pd` 不存在，都會正常往下跑進 `nextAction`。我額外檢查了 `pushDecision` 全部呼叫點（54 處），確認除了 `STOCK_GAIN`／`IPO_ANNOUNCE` 兩個刻意 forEach 廣播的例外，其餘全部是推給「當前正在處理的那個 `p`」（多半就是 `E.activePlayer(S)` 本人），且 `E.tickFutCall`／`E.tickDelistWarn` 兩處有明確既有註解保證「只在自己回合開始才跳卡，不推給別人」。因此守門邏輯的前提「off-turn 決策只會是某位真人」在目前程式庫裡成立，不會誤傷其他機制。

3. **`T-59`／`s18test.js` 補的模擬分支**：不是「讓測試過」的權宜之計。兩處都是真的呼叫 `E.apply(S,{type:"DECIDE",...})` 並斷言 `!rejected`，會實際推動狀態機前進（不是字串比對或空 try/catch）；且是先走 `T-59`(a) 的「不變式掃描」與 `D5-1c` 的引擎層直接驗證，證明修法本身邏輯正確之後，才補這兩處「驅動迴圈自己也要跟上新的合法路徑」——這是測試腳手架追趕真實邏輯，不是反過來遷就測試。ui-engineer 的查證方法（`git worktree` 比對 baseline／單獨套用 S1／疊上 A+B）也是紮實的因果排除法，不是拍腦袋。

4. **`STOCK_GAIN` 既有先例**：確認本次三處 UI 修法（`renderCenter`／`ui.tick`／`T-59`）全部用 `S.phase==="DECISION"`、`S.pendingDecision.playerId` 這種通用判斷，**沒有任何地方寫死 `d.kind==="IPO_ANNOUNCE"`**。T-005 要補的 `STOCK_GAIN` 專屬回歸測試，其前提（T-004 修的是通用機制、`STOCK_GAIN` 會一併受益）成立。

5. **邊界情況**：
   - 多位真人同時懸置決策：`D5-1c` 已驗證 FIFO 順序與互不干擾（一人解卡不影響另一人的 `decisionId`）。
   - 真人破產後決策卡清理：讀碼確認 `E.declareBankrupt`（`applyAction.js:3676-3684`，本次未改動）本來就會 `S.decisionQueue.filter(d=>d.playerId!==p.id)` 清掉該玩家所有待決卡（不分 kind），這個既有機制正確涵蓋了「持有 off-turn `IPO_ANNOUNCE` 期間破產」的情況，不需要本次額外處理。
   - 「跳過這一位」降級流程：`ui.showStuck` 本身（`uiViews.js:787-830`）未被本次修改，但修法 B 讓「off-turn 決策」這個情境不再會誤觸發 stall 計數，等於**大幅降低**了「跳過這一位」誤清空真人決策佇列的機率（ADR 補充裁決 2 指出的「比原 bug 更糟」的那個情境）。我沒有發現這次修法對「跳過這一位」按鈕本身的既有行為有任何改動或副作用。

---

## 未預期發現

- `git status` 目前只有前述 6 個檔案異動，與 dispatch／QA／engine S4 回報表列完全一致，沒有發現任何範圍外的程式碼異動。（先前 engine S4 回報提到跑測試後 `index.html` 一度殘留 modified，本次審查時確認該檔案目前已是乾淨狀態，非本次程式審查範圍內的問題。）
- M1（`mpForceLeaveWhy` 不認 off-turn 決策）是本次審查過程中读码發現的既有架構缺口，**不是本次 diff 引入的新 bug**，但因為與這次修法的核心風險點（lockstep／多人暫停頻率）直接相關，依角色檔要求「不做風格吹毛求疵，但正確性與架構風險要講」，故列為 Major 記錄，供之後排入待辦，不影響本次「通過」判定。
- 未審查到的部分：多人連線的實機 smoke test（真人斷線邊界）不在唯讀程式碼審查的能力範圍內（需要實際跑多開瀏覽器/房間），我只做了讀碼分析與既有測試重跑，沒有另外新增或執行任何多人連線的手動測試——這部分留給 M1 建議的後續票由 qa-tester／network-engineer 補測。
</content>
