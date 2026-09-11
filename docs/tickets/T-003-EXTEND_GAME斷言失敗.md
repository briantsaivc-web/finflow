# T-003 T-86／S14b EXTEND_GAME 斷言失敗（既有問題，與 T-001 無關）

- 需求來源：QA（`docs/qa/T-001-qa-report.md` Bug #2），製作人裁示 2026-09-10：開新票，不擋 T-001 收尾
- 撰寫：pm-planner，2026-09-10
- 嚴重度：Major（QA 分級）；**已用 `git diff HEAD -- src/engine/reducer/applyAction.js` 確認與 T-001 本次改動完全無關**，是 main 分支既有技術債，起始 sprint UNKNOWN（未查 git blame，交由接手工程師確認）

## 1. 目標
修好 `tests/runtests.js`（透過 `ns.selftest.run()`）裡 `T-86 S14b 回合上限與延長（EXTEND_GAME）` 這項既有回歸測試的斷言失敗，讓它恢復通過，且不影響其餘 96 項既有斷言。

## 2. 背景：QA 報告裡的具體記錄

摘自 `docs/qa/T-001-qa-report.md`：

```
❌ T-86 S14b 回合上限與延長（EXTEND_GAME） :: 續攤不得重算超過一位玩家的現金（發薪只該發給接回的那一位）
```

QA 已用 `git diff HEAD -- src/engine/reducer/applyAction.js` 搜尋 `EXTEND_GAME`／`maxTurns`／`payday` 相關變更，確認 T-001 這次的 diff **完全沒有碰到**這段邏輯（唯一命中的一行是 `OFF_TURN_RESPOND` 白名單清單裡原本就有的 `EXTEND_GAME:1`，旁邊被加了 `IPO_SUBSCRIBE:1, IPO_DECLINE:1`，屬於單純新增鍵值，不影響既有邏輯）。判定為既有問題，T-001 開發過程中的兩位工程師（S2、S5）也各自獨立觀察到同一則失敗、得到相同結論。

## 3. 初步線索（供接手工程師不用從零開始查，以下是「線索」不是「診斷結論」）

### 3.1 斷言本體與位置
測試定義在 `src/ui/uiViews.js:1591-1644`（`t("T-86 S14b 回合上限與延長（EXTEND_GAME）", function(){...})`）。失敗的斷言在第 1618-1621 行，情境 (b)「時間到結束的局可以續攤，且接回原本的那一輪」：

```js
// 續攤不是重開：現金水位必須連續（發薪造成的變動只可能在自己那一輪）
var cashA=S2.players.map(function(z){return z.cash;});
assert(cashA.filter(function(c,i){ return c!==+cashB.split("|")[i]; }).length<=1,
  "續攤不得重算超過一位玩家的現金（發薪只該發給接回的那一位）");
```

測試邏輯：`S2=mkGame(8602)`，把 `S2.turnNumber` 直接推到 `maxTurns+1`、呼叫 `E.finishByRanking(S2)` 與 `E.syncPhase(S2)` 讓局以 `MAX_TURNS` 結束，記下此刻全體玩家現金 `cashB`；接著送出 `EXTEND_GAME` action 續攤，再記下全體玩家現金 `cashA`。斷言預期：續攤後**最多只有一位玩家**（接回那一輪的當事人）現金會變動——實際結果是**超過一位**玩家的現金變了。

### 3.2 相關實作：EXTEND_GAME 的 reducer 分支
`src/engine/reducer/applyAction.js:1283-1306`（`case "EXTEND_GAME"`）：續攤成功且原本 `S.over===true` 時（第 1301-1305 行），會執行：
```js
S.over=false; S.winner=null; S.overReason=null;
E.beginTurn(S);
```
`E.beginTurn(S)`（定義於 `applyAction.js:4238`）內部用 `E.activePlayer(S)` 只取**一位**玩家 `p`，理論上只應該對這一位玩家發薪（第 4279-4281 行 `if(E.fixedPaydayOn(S) && !p.bankrupt){ E.payday(S,p); ... }`），`E.payday(S,p)`（定義於 `applyAction.js:1749`）本身的分錄（`ledger.post`）也只寫入傳入的這一位 `p`。**單看這兩段程式碼本身沒有明顯會動到其他玩家現金的地方**，所以真正的根因可能在以下幾個 `E.beginTurn` 內同樣會被跑到、但目前未逐行核對的分支：

1. `ns.modules.onTurnStart(S,p)`（`applyAction.js:4242`，fanout 到 `src/engine/npc/contentNpcSim.js:60`）——需要確認掛在這個 hook 上的各模組實作，是否有任何一個會對「非當前玩家」產生現金副作用（例如跨玩家的利息、分潤、保險理賠、P2P 借貸等）。
2. `E.payday` 內的 `ns.modules.onPayday(S,p)`（`applyAction.js:1775`，fanout 到 `contentNpcSim.js:61`，實作分佈在 `contentNpcSim.js:153`／`215`／`771` 三處）——同樣需要確認這三處實作有沒有觸碰 `p` 以外的玩家。
3. `E.beginTurn` 內另外兩段**明確會遍歷/涉及多位玩家**的結算邏輯：`S.pendingSyndicate` 集資結算（`applyAction.js:4245-4251`，呼叫 `E.settleSyndicate`）與 T-001 新增的 `S.ipo.pending` 新股結算（`applyAction.js:4255-4260`，呼叫 `E.settleIpo`）。**理論上** `mkGame(8602)` 建立的全新測試局不應該帶有 `pendingSyndicate`／`ipo.pending`（因為測試沒有主動觸發過集資或新股），但**尚未實際確認** `mkGame`／`E.newGame` 的初始化路徑是否在某些條件下會預先排一個 pending 狀態。若有，`E.settleSyndicate`／`E.settleIpo` 這類結算函式本質上就是要付錢給多位玩家（集資出資人、抽中新股的申購人），會直接符合「超過一位玩家現金變動」的失敗現象——**這是目前最值得優先排除或確認的假說**。
4. QA 報告「未預期發現 #1」另外指出，`tests/s45test.js:175/178` 曾出現「`p.cash=X` 後接 `ledger.recompute(p)` 是無效寫法（會被蓋回真值）」這種測試手法陷阱。T-86 測試本身（`uiViews.js:1611/1619`）**看起來是直接讀 `z.cash` 沒有手動竄改**，屬於正常讀值，初步判斷不像同一種陷阱，但建議接手時仍順手複查一遍，排除是測試斷言本身寫法有誤、而非 engine 邏輯錯誤的可能性。

### 3.3 建議的第一步排查方式
在本機用 `node tests/runtests.js` 重現失敗後，建議在 `E.beginTurn` 與 `E.payday` 內暫時加中介 `console.log`（僅本機除錯用，**不得提交**），印出每次現金變動是哪個 `p.id`、金額多少、被哪個呼叫點觸發，藉此直接定位是 3.2 節哪一個分支造成的，而不用逐一排除假說。

## 4. 驗收條件（【AI】＝AI 可自驗）
1. 【AI】`node tests/runtests.js`（或修好 T-002 後的 `npm test`）跑出的結果中，`T-86 S14b 回合上限與延長（EXTEND_GAME）` 這一項為 PASS，不再出現於 FAIL 清單
2. 【AI】其餘既有 96 項 `ns.selftest` 斷言（不含 T-86）不因本次修改新增任何一項 FAIL——修改前後各跑一次完整清單比對
3. 【AI】回報中必須明確寫出**根因是什麼**（是 `E.beginTurn`／`E.payday`／`E.settleSyndicate`／`E.settleIpo`／某個 `onTurnStart`／`onPayday` 模組 hook 動到了非預期的玩家，還是測試斷言本身寫法有誤），並附上定位過程的證據（例如加log後的實際輸出、或直接讀程式碼指出具體行號與邏輯錯誤點），不得只寫「修好了」
4. 【AI】若根因確認是 engine 邏輯錯誤：修正後用 `E.newGame` 相同 seed／action 序列重放兩次，確認結果逐位元一致（不破壞 CLAUDE.md 第 3 節第 1、2 條「reducer 純函數」「deterministic replay」）
5. 【AI】若根因確認是測試斷言本身寫法有誤（例如斷言條件寫錯、或測試建局方式意外帶出 pending 集資／新股狀態）：修正測試斷言或建局方式後，仍要能證明**目前的 EXTEND_GAME 實際行為**（續攤只讓當事人現金變動）在 engine 邏輯上是對的，不是「改測試遷就 bug」
6. 【AI】若根因牽涉到 `E.beginTurn` 內與 S39 集資／T-001 新股結算共用的段落（3.2 節第 3 點），修改前需知會 architect，避免破壞剛驗收的 T-001／既有 S39 邏輯；修改後 `tests/s39test.js`、`tests/s45test.js` 都要重跑確認無新增失敗
7. 【AI】AI 對手路徑與人類路徑都要覆蓋（CLAUDE.md 第 3 節第 6 條）：若修改牽涉 `E.beginTurn`／`E.payday` 這類回合流程共用邏輯，除了既有的真人續攤情境，建議也用一個「電腦玩家局中有其他電腦玩家」的情境驗證續攤不會誤動到電腦玩家的現金

## 5. 建議分派角色
**engine-engineer**。依 CLAUDE.md 第 7 節角色職責表，`EXTEND_GAME` 屬於 `src/engine/reducer/applyAction.js` 的回合流程規則邏輯，`E.beginTurn`／`E.payday`／集資與新股結算都在 engine 層，且測試斷言本身（`tests/`、以及 `src/ui/uiViews.js` 裡掛在 `ns.selftest` 下的這段測試，雖然物理位置在 `src/ui/uiViews.js`，但性質是引擎回歸測試）也在 engine-engineer 可動的 `tests/` 範圍內。若最終判斷根因其實出在某個 UI 或 module 層的 hook（3.2 節第 1、2 點），engine-engineer 應先回報 architect 再決定是否需要 ui-engineer 協同，不要自行跨界大改。

## 6. 交叉影響
| 項目 | 觸及 | 說明 |
|---|---|---|
| S39 集資結算 | `E.beginTurn` 內 `S.pendingSyndicate` 分支（`applyAction.js:4245-4251`） | 若根因在此，修改前需確認不影響既有 `tests/s39test.js` |
| T-001 新股結算 | `E.beginTurn` 內 `S.ipo.pending` 分支（`applyAction.js:4255-4260`） | 若根因在此，修改前需確認不影響剛驗收的 `tests/s45test.js`，且要知會 architect（T-001 相關邏輯改動需比照 ADR-001 交叉影響裁決處理） |
| T-002（測試框架 exit code） | 驗收判斷方式 | 兩票互不阻擋，但 T-002 驗收條件 3 依賴本票（T-003）修好；本票驗收可以獨立用 `node tests/runtests.js` 的內部輸出文字判斷通過與否，不需要等 T-002 修好 |
| lockstep 多人同步 | CLAUDE.md 第 3 節第 7 條 | 若修正牽涉現金分錄邏輯的執行順序或範圍變動，需先確認不引入非確定性（時間、浮點順序、物件迭代順序），必要時經 architect 確認 |

## 7. 風險
- 起始 sprint／何時開始失敗：**UNKNOWN**（QA 報告未查 git blame，本票也未查），建議接手工程師先用 `git log -p -- src/ui/uiViews.js` 搜尋這段測試的新增／修改歷史，確認是哪個 sprint 引入，有助於縮小根因範圍。
- 若根因是共用邏輯（S39／T-001 新股結算段落），修正時容易「順手」牽動已驗收功能，需嚴守 CLAUDE.md 第 5 節「只動任務單指定的範圍」，發現需要調整共用邏輯時先回報 architect，不要單方面擴大修改範圍。

## 8. 素材需求
無（純程式除錯與修正，不涉及卡片文案、圖示、教學文字）。

## 9. 預估工作量
1 個工作天內（AI 一個 session）：定位根因可能是最耗時的部分（3.2 節列出至少 4 個待排除的假說），若根因單純（例如 3.2 節第 3 點的 pending 結算誤觸發）預期半天內可修完＋補測試；若牽涉共用邏輯需要 architect 確認，實際工時視 architect 回覆時效而定，不在 pm-planner 掌控範圍內。
