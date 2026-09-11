# T-001 S1 完成報告：新股抽籤（engine-engineer）

- 角色：engine-engineer
- 對應分派單：`docs/tickets/T-001/dispatch.md` S1
- 對應 ADR：`docs/adr/ADR-001-新股抽籤.md`（D1–D6；2026-09-10 修訂版，含 D2 修正與 S0 後製作人裁示）
- 前置：`docs/reports/T-001-engine-engineer-S0.md`（本次已依其提醒處理 `E.markOffTurnLedger` 地雷）

## 結論
1. **完成**。ADR D1–D5 全部實作：`E.ipoRoll`、`S.ipo`／`p.ipoEscrow`、`IPO_SUBSCRIBE`／`IPO_DECLINE`、`E.openIpo`／`E.ipoPollNPC`／`E.settleIpo`／`E.ipoRefundPlayer`、事件 `IPO_OPENED`／`IPO_SUBSCRIBED`／`IPO_DECLINED`／`IPO_SETTLED`、決策 kind `IPO_ANNOUNCE`。
2. `npm test`（`test:engine` + `test:ui`，共 30 個測試區塊）全數通過，新建 `tests/s45test.js` 17 項全過（含 AI 對手路徑與人類路徑）。
3. D6 參數：S3 尚未寫入 `defaultParams.json`，本次全部用 `E.cfg(S,key,dflt)` 的第三參數 fallback（見下方「需要製作人／其他角色配合的事」），未寫死到邏輯裡。

## 變更檔案清單

| 檔案 | 變更摘要 | 行數增減 |
|---|---|---|
| `src/engine/core/engineCore.js` | `E.cfg` 加第三參數 `dflt`（向下相容）；新增 `E.ipoRoll`；`p.ipoEscrow` 唯讀快取欄位；`E.newGame` 內建 `S.ipo` 排程（僅 `ipoLottery===1`） | +43 / −8（`git diff --stat`） |
| `src/engine/reducer/applyAction.js` | `PAYLOAD_SCHEMA`／`OFF_TURN_RESPOND` 加 `IPO_SUBSCRIBE`／`IPO_DECLINE`；新增這兩個 case；`resolveDecision` 加 `IPO_ANNOUNCE`（併入既有 ACK 群組）；`case "MARKET"` 加新股觸發判斷；`E.buildBookkeeping` 的 `DENY` 加 `"ipo-settle"`；`E.beginTurn` 加新股結算＋保底判斷（接在 S39 集資區塊之後）；`E.declareBankrupt` 加 `E.ipoRefundPlayer` 呼叫（在 `p2pLiquidate` 之前）；新增 `E.ipoDue`／`E.ipoIssueTier`／`E.openIpo`／`E.ipoPollNPC`／`E.settleIpo`／`E.ipoRefundPlayer` | +206 / −2（`git diff --stat`） |
| `tests/s45test.js`（新建） | 17 個 `step()`，對應 ADR 驗證方式 ①–⑩ ＋ D2／D5-1 交叉驗證 ＋ 8 種子整合跑局 | 398 行 |
| `package.json` | `test:ui` 只加一行 `node tests/s45test.js`（在 `s44test.js` 之後、`editortest.js` 之前，配合 S2 之後續寫的順序） | +1 / −1（同一行替換） |
| `src/engine/npc/contentNpcSim.js` | **未變更**——`npc.stableRoll` 只是抄寫演算法的參考範本，`E.ipoRoll` 是獨立實作在 `E` 命名空間（ADR D1 明講「新增 `E.ipoRoll`」），沒有需要改到這個檔案的地方 | 0 |

`src/data/`（含 `defaultParams.json`）、`src/ui/`、`src/network/`、版本號：**全部未動**，符合分派單「不可碰」清單。

## 測試證據

### `tests/s45test.js`（新建，直接跑）
```
$ node tests/s45test.js
OK   ① 排程分布：1,000 種子，兩個窗口都落在設定範圍內、第二窗口出現率接近 0.6  win1∈[8,20] win2 rate=0.606 win2∈[25,45]
OK   ② E.ipoRoll 雜湊決定論：同輸入同輸出、不同輸入不同輸出、範圍 [0,1)
OK   ③ 中籤率公式 q=r/g 與上下夾限都驗到  正常 q=0.0732／下限 0.005／上限 0.3
OK   ④ 帳本分錄金額：申購／沒中／中籤三種  本次沒中：驗證沒中分錄
OK   ④b 破發：中籤但 listPrice<P，分錄結構不變、金額如實反映虧損
OK   ⑤ 人類路徑：非回合 IPO_SUBSCRIBE 仍放行，且標 offTurn（S0 地雷已處理）
OK   ⑤ reject 碼：NO_IPO／IPO_MISMATCH／IPO_DUP／IPO_CASH／IPO_TIER 全部命中
OK   ⑥ 電腦玩家路徑（E.ipoPollNPC）：保留水位守住
OK   ⑥b 電腦玩家路徑：水位不夠時 0 人申購
OK   ⑦ 結算順序：集資事件先於 IPO_SETTLED
OK   ⑧ 申購者破產先退款：ipoEscrow 歸零、subs 移除、帳上已退款
OK   ⑨ 舊存檔／關閉時不觸發：S.ipo 全程 null，重放逐位元一致，無 IPO_* 事件
OK   ⑩ 保底觸發：過了 ipoGraceTurns，輪首強制開公告
OK   D2：p.ipoEscrow 不參與 ledger.recompute 的 totalAssets／netWorth 推導
OK   D5-1：真人踩到 MARKET 格 → 不抽市場卡、改推 IPO_ANNOUNCE 決策
OK   D5-1b：電腦踩到 MARKET 格 → 直接處理、不卡決策佇列
OK   整合：8 個種子全電腦局，ipoLottery=1 全程跑完，無 NaN、無帳本殘留
{"pass":17,"fail":0,"pageErrors":0}
```

### `npm test`（`test:engine` + `test:ui`，完整跑一次）
指令與 package.json 一致，無需標 UNKNOWN。完整輸出已存於本機暫存（`scratchpad/npmtest_full.log`，473 行，未入版控），重點摘要：
```
test:engine → node tests/gate.js
{"games":1000,"NaN":0,"Infinity":0,"invalidGames":0,"invalidReasons":{},"assetLedgerMismatch":0}

test:ui → 30 個測試檔全過，包含新加入的 s45test.js：
{"pass":97,"total":97}          runtests.js
{"pass":108,"fail":0}           s17test.js
...（中略，共 30 個區塊）...
{"pass":17,"fail":0,"pageErrors":0}   s45test.js（本次新建）
{"pass":11,"fail":0,"pageErrors":0}   editortest.js
```
全檔 `grep -n "FAIL"` 無命中；30 個 `"fail":N` 統計全部是 `"fail":0`。背景執行的 shell process 以 exit code 0 結束。

## 未預期發現

1. **`E.cfg` 加了第三參數 `dflt`（可選、向下相容）**：分派單建議寫法是 `E.cfg(S,"ipoEvRate",0.03)`，但既有 `E.cfg(S,key)` 只有兩個參數，全專案沒有任何呼叫端用過第三參數。為了不違反「參數資料驅動」又要符合分派單指示的寫法，我把 `E.cfg` 本身加了第三個可選參數（只有在 `S.config[key]===undefined` 時才用 `dflt`），舊的兩參數呼叫行為完全不變。這是對共用核心函式的最小擴充，不是我自己另開一條路——如果 reviewer 認為這一步超出「只改 IPO 相關程式碼」的範圍，請告知，我可以改回「每處都手動 `if(x===undefined) x=...`」的既有慣例寫法（程式碼會變長但功能一樣）。
2. **`npm test` 會連帶重建 `index.html`／`dist/index.html`／`card_editor.html`**：`test:engine` 的 `npm run build` 是既有機制，我沒有另外手動 build。但分派單「不做」清單寫「不 build」，這三個檔案目前在 `git status` 顯示為 modified（build 產物，非我手動編輯）。我沒有 commit 這些檔案，維持在工作區未暫存狀態；正式版號與 changelog 仍由 release-manager 處理。如果這樣仍算違反「不 build」，請指示是否要我想辦法在不重建 `index.html` 的情況下驗證（例如只用 `tests/extract.py` 產生的 `test_engine.js`/`test_content.json` 跑 pure-Node 測試，跳過 Playwright 那一段）——但分派單明確要求我把 `s45test.js` 加進 `test:ui`（Playwright 路徑），而 Playwright 測試必須讀取已建置的 `index.html`，兩者要求似乎互相牽動，煩請 architect／製作人確認這個「不 build」的界線。
3. **`.claude/hooks/check-forbidden.sh` 對既有的檔頭註解誤報**：每次編輯 `engineCore.js` 都會跳出「發現 Math.random/Date.now」的 PostToolUse 警告，命中的其實是第 3 行的說明文字「鐵律一：引擎不讀寫 DOM、不使用 `Date.now()` / 未播種的 `Math.random()`」本身（把違禁字眼寫進說明文字裡），以及兩個舊的 `.backup.20260906`／`.backup.20260907` 檔案裡同一行。這不是我這次改動造成的（改動前後這行註解都在），也確認過 `grep` 全專案 `src/engine/` 沒有真正呼叫 `Math.random`／`Date.now`／`new Date(`／`localStorage`／`document.`／`window.`。因為 `.claude/hooks/forbidden-allowlist.txt` 不在我的可改範圍（分派單只列 `engineCore.js`／`applyAction.js`／`contentNpcSim.js`／`tests/s45test.js`／`package.json`），我沒有動它，只在此如實記錄，請 architect 或有權限的角色評估要不要把這行說明文字改用別的措辭，或把它加進 allowlist。
4. **`src/engine/core/` 目錄下有兩個舊備份檔**：`engineCore.js.backup.20260906`、`engineCore.js.backup.20260907`（不是我這次建立的，`git status` 對這兩個檔案沒有顯示異動，猜測是先前 session 留下、可能被 gitignore 或已經 commit 過）。沒有處理它們，僅供留意。
5. **`E.OFF_TURN_RESPOND` 目前沒有任何測試檔靜態檢查它的完整鍵值清單**（`grep OFF_TURN_RESPOND tests/` 沒有命中），所以加入 `IPO_SUBSCRIBE`／`IPO_DECLINE` 不會撞到既有測試，但也代表這張表未來漏加動作類型不會被自動抓到——這是既有設計，不是本次引入的問題，僅供記錄。
6. **`src/network/syncAdapter.js` 沒有硬寫死的動作類型白名單**（已 grep 確認），推測新動作可以直接透過現有機制轉發，但這屬於 S5（network-engineer）的驗證範圍，我沒有動這個檔案，也沒有能力驗證多人連線層的實際行為，S5 仍需要自行確認並在 `docs/reports/T-001-network-engineer.md`（或對應報告）回報。

## 需要其他角色／製作人決定的事

1. **D6 參數尚未落地**：`src/data/config/defaultParams.json` 目前完全沒有 `ipo*` 開頭的參數（已用 `grep -i ipo` 確認 0 筆），所以 `ns.buildConfig()` 產出的預設 config 裡 `ipoLottery` 是 `undefined`——目前**新局預設關閉**，要靠測試或未來的 UI 手動把 `config.ipoLottery` 設成 1 才會啟用。等 S3 把 D6 表格的參數（`ipoLottery`、`ipoEvRate`、`ipoSmallMin/Max`、`ipoBigMin/Max`、`ipoSpreadMin/Max`、`ipoQMin/Max`、`ipoListLo/Hi`、`ipoFee`／`ipoNoticeFee`、`ipoWin1From/To`、`ipoWin2From/To`、`ipoWin2Chance`、`ipoGraceTurns`、`ipoNpcReserveMonths`）寫進去之後，引擎會自動改吃 registry 的值（`E.cfg` 一律先查 `S.config[key]`，查不到才退回我寫的 fallback），**不需要我再改程式碼**。
2. **上面「未預期發現 1」的 `E.cfg` 第三參數擴充**：請 architect／reviewer 確認這個共用核心函式的擴充方式是否可以接受，或要我改回逐處手動判斷 `undefined` 的既有寫法。
3. **上面「未預期發現 2」的「不 build」界線**：`npm test` 必然會重建 `index.html`，煩請確認這是否算違反分派單「不做：…不 build…」——若不算，此項可以直接結案；若算，需要重新定義 S1 該怎麼在不產生建置產物異動的前提下跑 Playwright 測試。
4. **D7 內容池**：`ns.content.cards.IPO_POOL` 目前不存在（S4 尚未建立 `v10.json` 裡的 `IPO_POOL` 牌堆），`E.ipoIssueTier` 已依 ADR 設計走「池子是空的就用『新股 A／新股 B』兜底」，行為正確（已在測試中間接驗證：所有測試場景 `poolId` 都是 `null`、`name` 都是兜底字串），S4 之後補上牌堆不需要我再改程式。
5. **S2（ui-engineer）續寫 `tests/s45test.js`**：我已經在檔案最後留了明確的分隔註解「===== S1 段落結束，以下保留給 S2 續寫 page 段落 =====」，並在檔頭註解重申「S2 不得修改本檔案上半部的斷言」，供交叉裁決依循。
6. **S5（network-engineer）**：`IPO_SUBSCRIBE`／`IPO_DECLINE` 已加入 `E.OFF_TURN_RESPOND`，多人連線層若有依賴這張表做廣播或權限判斷，應該可以直接吃到；但實際連線行為（含舊版客戶端加入新房的擋法）仍要靠 S5 自行驗證與回報，我沒有能力在 engine 層驗證這件事。
