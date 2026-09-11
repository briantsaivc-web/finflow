# T-001 S0 查證報告：記帳題 UI 能否處理 eduTags:["ipo"] 的 ASSET 分錄

- 角色：engine-engineer
- 範圍：只讀（依分派單，本次未修改任何 `src/` 檔案）
- 對應分派單：`docs/tickets/T-001/dispatch.md` S0
- 對應 ADR：`docs/adr/ADR-001-新股抽籤.md` D4

## 結論（3 行內）
1. **可以直接支援**，不需要把「申購」分錄加進 DENY，也不需要為此改記帳 UI 程式碼——不觸發 ADR D4 備案，不需要 architect 停下來決定。
2. 記帳題的**產生邏輯其實在 `src/engine/reducer/applyAction.js` 的 `E.buildBookkeeping`（引擎層），不在 `src/ui/`**；`src/ui/uiCore.js` 的 `ui.renderBookkeeping` 只是把已經算好的 `S.bookkeeping.tasks` 畫出來，兩者都不依賴 `refId` 格式，所以複合字串 `ipoId|tier|playerId` 不會造成查無資產、顯示空白或報錯。
3. 有一個**S1 實作時必須注意的地雷**（不是 UI 的問題，是引擎觸發時機的問題）：非申購發起人以外的玩家用 `IPO_SUBSCRIBE`（非回合動作）申購時，若沒有呼叫 `E.markOffTurnLedger(p)`，該筆分錄永遠不會被記帳題掃到（見下方「未預期發現」）。

## 檔案路徑清單（讀過的檔案，佐證用）
- `docs/tickets/T-001/dispatch.md`
- `docs/adr/ADR-001-新股抽籤.md`
- `src/engine/reducer/applyAction.js`（讀取範圍：340-417、1195-1441、4060-4180）
- `src/engine/core/engineCore.js`（讀取範圍：30-110）
- `src/ui/uiCore.js`（讀取範圍：1-100、4080-4166）
- `src/ui/uiViews.js`（讀取範圍：1130-1210；並用 Grep 掃過全檔 `eduTags`／`bookkeeping` 出現處，多數是測試檔內的 `ledger.post(...,{eduTags:["setup"]})` 測試樁，與記帳題產生邏輯無關）
- `src/ui/tutorial.js`（Grep 命中處）

## 逐項查證（對應問題 1–4）

### 1. 記帳題怎麼從分錄產生？有沒有白名單／黑名單？
產生邏輯在 `E.buildBookkeeping(S,p)`（`applyAction.js:4137-4165`），不在 `src/ui/`：
```js
// applyAction.js:4139
var DENY = ["valuation","dividend","event-end","inflation","rate","cashflow","bookkeeping"];
...
if(en.eduTags && en.eduTags.some(function(t){ return DENY.indexOf(t)>=0; })) return;
```
這是一個**黑名單**（DENY），依 `en.eduTags` 過濾。`"ipo"` 不在 DENY 裡，所以 IPO 分錄會通過過濾，進入出題流程。
`src/ui/uiCore.js:4080` 的 `ui.renderBookkeeping` 只讀 `S.bookkeeping.tasks` 裡的 `t.label / t.amount / t.hint`，沒有另一層過濾。

### 2. 題目文字會不會套不上、選項會不會沒有對應？
`buildBookkeeping` 對每個非 CASH 的 posting 產生一個 task（`applyAction.js:4155-4162`）：
```js
en.postings.forEach(function(q,qi){
  if(q.account==="CASH") return;
  var key=en.entryId+"#"+qi;
  tasks.push({ key:key, label:en.summary+" — "+q.label, amount:q.delta, account:q.account,
    entryId:en.entryId, group:grp,
    hint:ns.content.byId[en.cardId||""]&&ns.content.byId[en.cardId].eduNote || null,
    done:!!doneMap[key] });
});
```
`ASSET` 分錄對應到 `E.bkGroupOf(en)`（`applyAction.js:4086-4101`）：只看 `postings` 裡出現哪些 `account`（`ASSET`/`LIABILITY`/`EXPENSE`/`INCOME_*`），不看 `refId`、不看 `eduTags`。
- 申購（`CASH −`／`ASSET +P`）→ `has.ASSET && assetDelta>0 && !has.LIABILITY` → 分類為 `"buyCash"`（現金買資產），文案「錢變成東西：現金減少、資產增加，淨值不變」，語意合理。
- 沒中／中籤（`ASSET −P`／`CASH +…`）→ `assetDelta<0` → 分類為 `"realize"`（資產變現），文案「賣掉東西：資產減少、現金增加」，大致貼切（雖然不是真的賣出，但帳目形狀相同）。

答題選項是固定四顆按鈕 `["asset","liab","income","expense"]`（`uiCore.js:4088`），對應 `ledger.QUADRANT`（`engineCore.js:41`）：`ASSET→"asset"`。IPO 分錄的帳戶類型是標準的 `ASSET`，選項裡本來就有，**不會出現「沒有對應選項」的狀況**。

題目文字模板是通用的（`en.summary+" — "+q.label`），不會因為是 IPO 分錄而套不上——只要 S1 在 `ledger.post` 呼叫時給 `summary` 一個合理的字串（例如「新股申購」），畫面就會正常顯示。這件事屬於 S1 的實作細節，不是 UI 要改的地方。

### 3. 記帳 UI 是否依賴 refId 格式反查資產？複合字串會不會查不到？
追過三個相關函式，**沒有任何一處讀取 `q.refId` 或 `en` 的 refId 去查 `p.assets[]`**：
- `E.buildBookkeeping`（`applyAction.js:4137-4165`）：task 物件裡完全沒有塞 `refId`。
- `ui.renderBookkeeping`（`uiCore.js:4080-4114`）：只讀 `t.label/t.amount/t.hint`。
- `CLASSIFY_ENTRY` 的 reducer（`applyAction.js:347-401`）：只讀 `t.account`（轉成 `trueQ` 比對）與 `t.entryId`（做同筆分錄的整組判定），一樣不碰 `refId`。

`ledger.recompute`（`engineCore.js:61-82`）計算 `totalAssets` 時也是直接加總所有 `ASSET` posting 的 `delta`，**不檢查 refId 是否登記在 `p.assets[]`**，這與 ADR D2 的說明一致（申購分錄會被自動加總進 `totalAssets`，`p.ipoEscrow` 不可再疊加）。

結論：複合字串 `ipoId|tier|playerId` 對記帳題 UI 完全不會造成錯誤或空白，因為記帳題路徑根本不解析 refId。

### 4. 結論分類
**可以直接支援。** 不需要加進 DENY，也不需要改 `ui.renderBookkeeping` 或 `E.buildBookkeeping`。不觸發 ADR D4「備案」（那個備案是針對 `gate.js` 的 `assetLedgerMismatch`，architect 已另外查證為安全，與本次記帳題查證是兩件事）。

若真的要改，唯一可能會改的檔案是 `src/engine/reducer/applyAction.js` 的 `E.buildBookkeeping`（把 `"ipo"` 相關 tag 加進 `DENY` 陣列），但依查證結果**沒有必要**，見下方「未預期發現」的討論。

## 未預期發現
1. **記帳題產生邏輯的實際位置與任務描述不同**：任務描述稱其為「`src/ui/` 裡記帳題的渲染邏輯」，但實際上出題（filter／分組／建立 task）的邏輯在 `src/engine/reducer/applyAction.js` 的 `E.buildBookkeeping`，`src/ui/` 只負責畫面渲染與送出 `CLASSIFY_ENTRY` action。這不影響本次結論，但提醒 S1：如果要調整記帳題「是否出題」的邏輯，要改的是 `applyAction.js`，不是 `src/ui/`（雖然這仍在 engine-engineer 的範圍內，S1 分派單本來就包含 `applyAction.js`）。

2. **`E.markOffTurnLedger` 沒呼叫會讓分錄永遠不出題**（S1 實作時要注意，不是本次要改的東西）：`buildBookkeeping` 只掃「本輪分錄」或「標記過 `offTurn` 的分錄」（`applyAction.js:4148`：`if(en.turnNumber!==S.turnNumber && !en.offTurn) return;`）。由於 `IPO_SUBSCRIBE` 依 D3 列在 `E.OFF_TURN_RESPOND`，非公告觸發者（多數玩家）申購時是在別人的回合動作，若 S1 忘記在 `ledger.post` 之後呼叫 `E.markOffTurnLedger(p)`（比照 `REPAY_LOAN`＝`applyAction.js:1418`、`TAKE_LOAN`＝`applyAction.js:1439` 的既有寫法），該玩家的申購分錄會**永遠**不會出現在記帳題裡（不是延遲，是永久跳過，因為 `turnNumber` 之後只會愈差愈遠）。建議寫進 S1 的實作檢查清單。

3. **設計面的小疑慮（非阻塞，供 architect／S1 參考）**：`buildBookkeeping` 的既有設計原則是「只讓玩家分類自己主動決策產生的分錄；股利／事件回復等被動變動不列入」（`applyAction.js:4150` 註解），`dividend`／`event-end` 因此進了 DENY。ADR D4 讓「申購」「沒中」「中籤」三種分錄都共用 `eduTags:["ipo"]`；其中「申購」是玩家主動決策，理應出題；但「沒中」「中籤」是抽籤結果的自動結算（`E.settleIpo` 在 `E.beginTurn` 內觸發），性質上比較接近「被動變動」，和 `dividend` 的排除理由類似。目前查證結果是：即使不排除，UI 不會出錯（如結論所述），只是可能會讓玩家對「沒中／中籤退補款」這種非自己主動觸發的帳也要記帳分類，是否符合遊戲體驗設計意圖，建議 S1／architect 在實作前再確認一次（若要排除，做法是幫這兩種結算分錄多加一個 DENY 已有的 tag，或在 `DENY` 陣列新增一個新 tag 並只用在這兩種分錄上，`eduTags` 可以是陣列、不衝突）。這不影響 S0 的核心結論，僅供決策參考。

## UNKNOWN 項目
無。本次查證的四個問題都在既有程式碼中找到明確依據，沒有需要標記 UNKNOWN 的地方。

## 需要其他角色配合的事
- 無需 architect 現在介入（未觸發 D4 備案）。
- 提醒 S1（可能是我自己接下來要做）：實作 `IPO_SUBSCRIBE` 時務必呼叫 `E.markOffTurnLedger(p)`（非申購發起人申購時），並考慮上述「未預期發現 3」的設計疑慮，若要排除「沒中／中籤」分錄出題，需要在 `DENY` 陣列或 `eduTags` 設計上多做一步。
