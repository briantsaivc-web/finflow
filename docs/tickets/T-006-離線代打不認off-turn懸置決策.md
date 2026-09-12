# T-006 多人連線「請電腦代打」判斷不認得「非回合懸置決策」——持卡真人斷線／閒置可讓全桌卡死

- 需求來源：code-reviewer 於 T-004 最終審查發現（Finding M1），獨立於 T-004、既有已久的多人連線缺口，製作人裁示 2026-09-12：開新票追蹤，不擋 T-004 收尾
- 撰寫：pm-planner，2026-09-12
- 嚴重度：**中（既有缺口，非本次新增；一旦命中會讓多人局全桌卡死到當事人回來為止，但命中需要「真人持有非回合懸置決策時剛好斷線／不回應」，機率不算高——不算阻擋性，但不建議無限期擱置）**
- 目標版本：由 architect／release-manager 排入哪個 sprint，pm-planner 不指定

> **文件查證說明**：任務指派時列出的背景文件 `docs/reports/T-004-code-reviewer-final.md` 經 `Glob` 確認**在目前 repo 中找不到**（`docs/reports/` 下實際只有 `T-004-engine-engineer.md`／`T-004-ui-engineer-S3.md`／`T-004-engine-engineer-S4.md`，沒有 code-reviewer 的最終審查回報檔案）。本票的技術根據改為 pm-planner 直接讀碼驗證（見下方「背景與根因」逐行引用，均為本次親自 Grep／Read 核對，非轉述推測），並補充驗證出比原始 Finding M1 摘要更完整的一層根因（見「pm-planner 額外查證」）。若之後找到該份報告，建議核對本票內容有無出入。

## 1. 目標

擴大「其他真人可以強制把某位真人座位交給電腦代打」的判斷與處理邏輯，讓「持有非回合懸置決策（例如 `IPO_ANNOUNCE`／`STOCK_GAIN`）且斷線或不回應」的真人也能被代打解卡，避免全桌因為這一張卡卡死到當事人回來為止。

**具體要擴大的判斦點有兩個（不是一個），需要 network-engineer／architect 共同確認：**

1. `mpForceLeaveWhy` 的「閒置」判斷目前只認「輪到他的回合」這一種閒置。
2. 就算「離線」判斷成功觸發、`PLAYER_LEAVE` 把座位轉成電腦，**懸置中的決策卡本身目前不會被自動解掉**，理論上仍可能繼續卡住全桌直到轉電腦的那個座位輪到自己回合為止。

兩點都要處理才能真正解決「全桌卡死」，只做第一點無法保證真正解除卡死狀態（細節見下方根因第 2、3 點）。

## 2. 背景與根因（本次讀碼逐項核對，附行號，不是轉述推論）

### 2.1 `mpForceLeaveWhy`（`src/network/syncAdapter.js:728-735`）

```js
function mpForceLeaveWhy(seat){
  var S=ui.S; if(!ui.mp.mode || !S || S.over) return null;
  var p=S.players[seat]; if(!p || p.isNPC || p.bankrupt || seat===ui.mp.seat) return null;
  var uid=(ui.mp.seatUid||{})[seat];
  if(uid && !mpOnline(uid)) return "offline";
  if(S.activePlayerIdx===seat && ui.mp._lastActTs && (now()-ui.mp._lastActTs) > ui.MP_IDLE_MS) return "idle";
  return null;
}
```

- 「offline」分支（第 732 行）判斷心跳，**跟輪到誰無關**，理論上真人徹底斷線（連線中斷、App 關掉）時，即使他手上的決策卡不是自己回合觸發的，這一支仍會回傳 `"offline"`，不像 Finding M1 原始描述的「永遠回傳 null」那麼絕對。
- 但「idle」分支（第 733 行）**限定 `S.activePlayerIdx===seat`**——也就是「輪到他，他卻不動」。**如果真人手機／電腦還連著線（心跳正常，沒有觸發 offline），只是人不在螢幕前、放著一張非回合懸置決策卡（`IPO_ANNOUNCE`／`STOCK_GAIN`）不理，因為現在輪到的是別人（電腦或另一位真人），這支永遠不會判定為「idle」，`mpForceLeaveWhy` 回傳 `null`，畫面上不會出現「🤖 請電腦代打」按鈕（渲染呼叫點：`src/network/syncAdapter.js:971`，對每個座位逐一呼叫）。** 這是本票要修的第一個確定缺口：**「連線正常但持有非回合懸置決策不回應」這種閒置狀態完全沒有被偵測到**。

### 2.2 就算偵測到、成功強制代打，決策卡本身也不會被解掉——`PLAYER_LEAVE`（`src/engine/reducer/applyAction.js:1309-1415`）

`case "PLAYER_LEAVE"` 把座位轉成電腦（`lp.isNPC=true`，第 1314 行）之後，逐一對五種「懸置中、等這位真人回應」的狀態做**決定論代答**（等同「這位真人不在，就當他婉拒／棄標」）：

- `S.pendingTrade`（第 1317-1335 行）
- `S.pendingP2P`（第 1336-1359 行）
- `S.pendingAuction`（第 1360-1369 行）
- `S.pendingReferral`（第 1370-1394 行）
- `S.pendingJV`（第 1395-1411 行）

**但完全沒有對應處理 `S.pendingDecision`／`S.decisionQueue`。** 第 1414 行只呼叫 `E.syncPhase(S)`（`src/engine/core/engineCore.js:1384-1391`），這個函式只是「重新從 `decisionQueue` 算出 `S.pendingDecision` 與 `S.phase`」，**不會移除或代答任何懸置決策**。也就是說：即使代打成功，`decisionQueue` 裡屬於這位（現在已轉電腦的）玩家的那張決策卡仍原封不動地卡在佇列最前面。

### 2.3 這張卡卡在佇列最前面時，全桌實際上動不了

`S.phase==="DECISION"` 期間，幾乎所有回合內動作都會被引擎拒絕（`WRONG_PHASE`，該判斷散佈在 `applyAction.js` 多處，例如第 423、470、518、546、629、819、827、844、864、884、900、1532、1539 行，全部要求 `S.phase==="ROLL"` 或 `"READY_END"` 才放行），包含擲骰、買賣、蓋牌等所有正常回合動作。真正能在 `DECISION` 階段送出的只有 `DECIDE`，而 `DECIDE` 又受 `E.OFF_TURN_CONDITIONAL.DECIDE`（`applyAction.js:119-122`）限制，**只有 `d.playerId===actor.id` 的那個人能解**：

```js
DECIDE: function(S, actor){
  var d = S.pendingDecision;
  return !!(d && d.playerId!==undefined && d.playerId!==null && d.playerId===actor.id);
}
```

代打後那個座位變成 NPC，`mpMayAct`（`syncAdapter.js:620`：`if(p.isNPC) return ui.mp.host;`）代表**只有房主的裝置**能替這個 NPC 送動作。而房主端的 NPC 自動驅動迴圈 `ui.tick`（`src/ui/uiViews.js:734-767`，T-004 剛修好的守門邏輯）第 749-753 行明確寫著：

```js
var curId = E.activePlayer(ui.S).id;
var pd = ui.S.pendingDecision;
if(pd && pd.playerId!==undefined && pd.playerId!==null && pd.playerId!==curId){
  ui._stall=0; ui.render(); return;
}
```

**只有當這張決策卡的擁有者恰好就是「現在輪到的那個人」時，`ui.tick` 才會驅動 NPC 邏輯去解卡。** 代打後的座位如果不是現在輪到的人，`ui.tick` 會安靜地什麼都不做（這是 T-004 為了修「NPC 思考中卡死」故意設計的行為，見 `docs/adr/ADR-001-新股抽籤-T004補充裁決2.md`「修法 B」），直到轉盤轉到那個座位自己的回合為止，NPC 邏輯才會在 `E.activePlayer===` 那位（現轉電腦）玩家時真正解掉這張卡。

**結論：本票原始 Finding M1 描述的「按鈕不出現」只是問題的一半（且僅限「連線正常但閒置不回應」這種情境）；即使按鈕出現、真人也真的斷線觸發了「offline」判定並被代打成功，全桌仍可能要等到那個座位輪到自己回合才會真正解卡，不是代打當下立即解除。** 這比 Finding M1 摘要描述的更深一層，pm-planner 認為修法方向不能只改 `mpForceLeaveWhy` 一處，`PLAYER_LEAVE` 的處理範圍是否要比照另外五種 pending-* 狀態、對 `S.pendingDecision` 也做決定論代答，是本票要請 network-engineer／architect 一併確認的核心問題。

### 2.4 這是既有架構特性，不是本次新增

`S.phase==="DECISION"` 只看 `decisionQueue` 是否有東西（`E.syncPhase`），跟「現在輪到誰」完全無關，這是既有設計（詳見 `docs/tickets/T-005-真人決策卡電腦回合消失.md` 第 17-33 行的完整分析）。`IPO_ANNOUNCE`（T-004 新增）與既有的 `STOCK_GAIN` 都是「觸發時機與被推播者的回合脫鉤」的 forEach 廣播寫法，會產生「真人持有非回合懸置決策」這種狀態；T-004 讓 `IPO_ANNOUNCE`（到期即自動觸發，不需要玩家任何主動行為）也走這條路，實質提高了這種狀態出現的頻率，因此連帶提高了本票描述的多人連線 gap 被實際踩到的機率——但這個 gap 本身（`mpForceLeaveWhy` 與 `PLAYER_LEAVE` 都不認得 `pendingDecision`）在 `STOCK_GAIN` 存在的時候就已經存在，不是 T-004 造成的。

## 3. 建議修法方向（僅供 network-engineer／architect 參考，不代為裁決細節）

code-reviewer 的初步建議：把 `mpForceLeaveWhy` 的判斷條件從「離線 或（輪到他且閒置）」擴大成「離線 或（輪到他且閒置）或（持有非回合懸置決策且閒置／離線）」。

但**具體修法需要 network-engineer／architect 進一步確認**，至少包含以下兩個 pm-planner 沒有能力自行驗證的問題：

1. **判斷邏輯本身要不要也考慮 lockstep 確定性**：`mpForceLeaveWhy` 目前讀的是 `now()`／心跳／`ui.mp._lastActTs` 這些跟真實時間相關的值，本來就不是決定論狀態的一部分（純粹是「要不要顯示這顆按鈕」的本地 UI 判斷，實際送出的還是 `PLAYER_LEAVE` action），但擴大判斷條件後，**每個客戶端各自本地判斷「這位真人是否持有非回合懸置決策」的結果是否會一致**（例如：不同客戶端的 `S.pendingDecision` 是否保證同步、會不會因為訊息到達順序不同而暫時不一致）需要 network-engineer 確認。
2. **`PLAYER_LEAVE` 是否也要對 `S.pendingDecision`／`decisionQueue` 做決定論代答**（見第 2.2、2.3 節）：如果不補這一塊，光擴大 `mpForceLeaveWhy` 的偵測範圍只能讓按鈕正確出現、代打動作能送出，但不保證代打後全桌真的解除卡死（除非剛好那個座位很快就輪到自己回合）。這屬於 engine 層（`applyAction.js`）的修改，需要 architect 確認：比照其他五種 pending-* 的「代答」邏輯，`pendingDecision` 要代答成什麼（例如 `IPO_ANNOUNCE`／`STOCK_GAIN` 各自有沒有一個安全的預設選項，比照 `T-59` 死當重現迴圈用的 `optionId:"skip"`），是否所有 `decisionQueue` 裡可能出現的 `kind` 都有安全的預設選項可以決定論代答，还是需要另外設計。

## 4. 驗收條件（【AI】＝AI 可自驗；【本機】＝需製作人或 qa-tester 本機確認）

1. 【AI】比照本票第 2.1、2.2 節指出的兩處缺口，提出並實作修法（`mpForceLeaveWhy` 擴大判斷＋視第 3 節第 2 點的裁決結果決定是否需要修改 `PLAYER_LEAVE`），修法內容需先經 architect 確認不破壞 lockstep 確定性（第 3 節第 1 點）。
2. 【AI】新增至少一項多人邊界測試，情境需包含：**真人 A 持有非回合懸置決策（`IPO_ANNOUNCE` 或 `STOCK_GAIN`，二者選一即可，不要求都覆蓋）、當下輪到別人（電腦或另一位真人）、A 斷線或閒置超過門檻**，斷言：
   - 其他真人的畫面上會出現「🤖 請電腦代打」按鈕（或等效的可強制代打判斷回傳非 null）
   - 代打送出後，A 的座位轉為電腦，且原本卡住的決策卡在合理時間內（不需要等到轮到 A 自己的回合）被解掉，遊戲能繼續往下走，不維持在 `WRONG_PHASE` 卡死狀態
   - **這是 T-004 的 QA smoke test（`tests/qa-t004-mp-smoke.js`）沒有覆蓋到的邊界情境**（該測試只覆蓋兩位真人都在線、正常應答的 happy path），本票要求補上這個之前沒測過的邊界
3. 【AI】跑 `node tests/runtests.js` 與完整 `npm test`，確認新增測項 PASS，既有全部項目不因本次新增內容新增任何 FAIL，exit code 0
4. 【AI】用相同 seed／action 序列重放兩次，確認結果逐位元一致（不破壞 CLAUDE.md 第 3 節第 1、2 條）
5. 【本機】qa-tester 或製作人在多人連線環境手動重現一次「真人持有非回合懸置決策時斷線」的情境（≥2 真人＋≥1 電腦局，讓一位真人在非自己回合收到 `IPO_ANNOUNCE` 或 `STOCK_GAIN` 決策卡後直接關頁），確認其他真人能看到並成功送出代打，且代打後遊戲確實能繼續（不是卡在原地等那個座位輪到自己回合）

## 5. 建議分派角色

- **network-engineer** 為主：`mpForceLeaveWhy`／`PLAYER_LEAVE` 的呼叫端 UI 邏輯（`syncAdapter.js`）是其專屬範圍。
- 若第 3 節第 2 點裁決結果需要修改 `PLAYER_LEAVE`（`applyAction.js`，engine 層），**需要 architect 先確認修法方向**（这属于跨 engine／network 的介面變動，且涉及 lockstep 風險評估），必要時再協調 engine-engineer 一起處理该段落——pm-planner 不代为决定要不要跨角色，留给 architect 判断分工。
- code-reviewer 本身只能读码分析、没有能力做多人连线实测，本票第 3 节列出的两个待确认问题，都需要 network-engineer／architect 实际验证或裁决，不是 pm-planner 能代为拍板的细节。

## 6. 交叉影響

| 項目 | 觸及 | 說明 |
|---|---|---|
| T-004（新股公告通知不足） | 本票起因 | T-004 讓 `IPO_ANNOUNCE` 也走「forEach 廣播給全場真人、不管現在輪到誰」的模式（比照既有 `STOCK_GAIN`），實質提高了「真人持有非回合懸置決策」這個狀態出現的頻率，因此連帶提高了本票描述的既有多人連線 gap 被實際踩到的機率。**本票不是 T-004 的缺陷，是 T-004 讓既有缺陷更容易被踩到**，T-004 本身已依其任務單驗收條件完成收尾（見 `docs/reports/T-004-engine-engineer-S4.md`），不需要回頭修改。 |
| T-005（真人決策卡電腦回合消失） | 同一個問題家族的另一半 | 兩者都源自「懸置決策與回合脫鉤」這個既有架構特性（`S.phase==="DECISION"` 只看 `decisionQueue`、跟 `S.activePlayerIdx` 無關）：**T-005 處理的是「單機局／電腦回合中，UI 渲染／驅動邏輯本身有沒有正確顯示與解卡這張卡」**（`ui.renderCenter`／`ui.tick`／`T-59`，T-004 已修好，T-005 是幫既有 `STOCK_GAIN` 補回歸測試）；**本票處理的是「多人局裡，持卡真人本人斷線／不回應時，其他玩家能不能把這個卡住的狀態解開」**（`mpForceLeaveWhy`／`PLAYER_LEAVE`）。兩票修的是不同層——T-005 假設「持卡人正常在線、只是介面沒顯示對」；本票假設「持卡人根本不在線或不回應」。兩票沒有直接的程式碼衝突，但**執行順序建議本票排在 T-005 之後**：T-005 驗證的三處 UI 修法（渲染順序、`ui.tick` 守門、`T-59` 測試）目前的行為正是本票第 2.3 節引用的依據，若 T-005 執行過程中發現這三處修法與 ADR 補充裁決 2 描述有出入，本票的根因分析（尤其第 2.3 節引用的 `uiViews.js:749-753`）需要重新核對。 |
| `src/network/syncAdapter.js`（`mpForceLeaveWhy`／`mpMayAct`／代打按鈕渲染） | 本票主要修改範圍 | 見第 2.1、5 節 |
| `src/engine/reducer/applyAction.js`（`case "PLAYER_LEAVE"`） | 視第 3 節第 2 點裁決結果，可能需要一併修改 | 見第 2.2、2.3、5 節 |
| `tests/qa-t004-mp-smoke.js` | 現有多人 happy-path smoke test，未覆蓋本票情境 | 本票驗收條件 2 要求補的邊界情境正是這份既有測試沒覆蓋到的部分，不要求修改這份既有測試本身，另外新增測試即可 |

## 7. 風險

- **這是既有問題，不是本次新增。** 優先度可以讓製作人自行評估，不算阻擋性（命中需要「真人持有非回合懸置決策時剛好斷線／長時間不回應」這個組合條件，機率不算高），但也不建議無限期擱置——目前完全沒有測試覆蓋這個多人邊界（見驗收條件 2），且 T-004 已經提高了觸發前提（真人持有非回合懸置決策）出現的頻率。
- pm-planner 第 2.2、2.3 節的額外查證（`PLAYER_LEAVE` 未處理 `pendingDecision`）是本次讀碼發現、非原始 Finding M1 摘要提到的內容，**需要 network-engineer／architect 重新核實**，不排除有 pm-planner 沒看到的其他既有機制（例如某處已經有針對 `pendingDecision` 的 timeout 或代答邏輯，只是本次沒找到），若核實後發現本票第 2.2、2.3 節的分析有誤，請在回報中明確更正，不要求本票的問題定義是最終正確版本。
- 修法若涉及擴大 `PLAYER_LEAVE` 的處理範圍（engine 層），必須先過 architect 的 lockstep 風險評估（CLAUDE.md 第 3 節第 7 條），pm-planner 不代為裁決是否安全。

## 8. 素材需求

無（純技術修復與測試補完，不涉及卡片文案、圖示、教學文字、規則書段落）。

## 9. 需要製作人決定的事

1. **本票要不要排優先序**：目前建議「非阻擋性，但不建議無限期擱置」，具體排入哪個 sprint 由製作人／architect 決定。
2. **第 3 節第 2 點的修法方向**（`PLAYER_LEAVE` 是否要對 `pendingDecision` 也做決定論代答，代答成什麼）屬於架構層級決策，需要 architect 先評估、必要時請製作人裁示「懸置決策在代打後應該視為玩家做了什麼選擇」這個產品規則問題（例如：`IPO_ANNOUNCE` 代答成「不申購」、`STOCK_GAIN` 代答成什麼，需要逐一盤點 `decisionQueue` 可能出現的所有 `kind` 是否都有合理的預設答案）。

## 10. 回報格式

執行者完成本票後，回報需包含：
- 修改檔案清單與 diff 摘要（`src/network/syncAdapter.js`，視裁決結果可能包含 `src/engine/reducer/applyAction.js`）
- 新增測試的完整輸出（`node tests/runtests.js`／`npm test`），需包含 exit code
- 對第 3 節兩個待確認問題（lockstep 風險、`PLAYER_LEAVE` 是否需要一併修改）的實際裁決結果與理由
- 對本票第 2.2、2.3 節額外查證的核實結果（確認無誤，或指出落差）
- 回報路徑：`docs/reports/T-006-<角色>.md`

## 11. 預估工作量

半個到一個工作天（AI 一個 session）：`mpForceLeaveWhy` 擴大判斷（若只做這一處）約半個 session；若第 3 節第 2 點裁決結果需要一併修改 `PLAYER_LEAVE`（engine 層）＋新增決定論代答邏輯，建議拆成兩個子任務——子任務一（network-engineer，`syncAdapter.js` 判斷邏輯擴大＋按鈕渲染）與子任務二（architect 先裁決＋engine-engineer 視裁決結果修改 `PLAYER_LEAVE`）**必須序列**（子任務二的修法方向依賴子任務一暴露出的行為與 architect 的 lockstep 裁決，不能並行）；多人邊界測試（驗收條件 2）建議跟在對應修法後面各自補，不要等兩個子任務都完成才一次補齊，以免測試範圍過大難以定位失敗原因。
