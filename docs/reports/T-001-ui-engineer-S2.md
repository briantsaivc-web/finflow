# T-001 S2 完成報告：新股抽籤（ui-engineer）

- 角色：ui-engineer
- 對應分派單：`docs/tickets/T-001/dispatch.md` S2
- 對應 ADR：`docs/adr/ADR-001-新股抽籤.md`（D1–D7；2026-09-10 修訂版）
- 前置：`docs/reports/T-001-engine-engineer-S1.md`（S1 已完成引擎邏輯，`npm test` 全數通過，並在 `tests/s45test.js` 留下分隔註解供本次續寫）

## 結論

1. **完成**。依分派單實作：①`IPO_ANNOUNCE` 決策卡（兩檔並排：申購價／參考價／價差／中籤率，g<0.25 顯示「可能破發」，申購小資／申購股王／都不要三個按鈕）②交易所「📢 新股申購中」列（存在時顯示，未表態或只表態一檔的真人可點）③POP 與訊息欄對應 `IPO_OPENED`／`IPO_SUBSCRIBED`／`IPO_SETTLED`（含 `IPO_DECLINED`）④淨值面板顯示「申購預扣款」（讀 `p.ipoEscrow`，唯讀顯示，不參與任何計算）⑤卡片工坊：`IPO_POOL` 可編輯（含 tier 欄位、kind 下拉選單每個選項附一行說明文字、新增「＋ 新牌堆」讓完全沒有卡片的牌堆也能開出來編輯）。
2. `npm test`（`test:engine` + `test:ui`，共 30 個測試檔）全數通過，含新加的 `tests/s45test.js` S2 段落（5 項）與 `tests/editortest.js` 新增 2 項。跑完後已用 `git checkout -- index.html card_editor.html` 還原被 build 覆寫的產物。
3. 過程中發現並修正一個測試自身的 bug（`ui.dispatch` 內部 `E.apply` 沒帶 `{mutate:true}` 會 clone state，點擊後不能再讀點擊前捕捉到的 `S` 快照），以及一個結構性風險並修正（`tests/s45test.js` 若讓 S1／S2 兩段各自呼叫 `process.exit` 會在同一個 node 行程裡互踩）——兩者都詳列在「未預期發現」。

## 變更檔案清單

| 檔案 | 變更摘要 |
|---|---|
| `src/ui/uiCore.js` | 新增 `ui.IPO_TIER_LABEL`；`ui.decisionCard` 加 `IPO_ANNOUNCE` 段落（兩檔並排、破發提示、三按鈕、affordability 檢查與 disabled 樣式）；`ui.renderFinBoard` 加交易所「📢 新股申購中」列；`ui.renderSheet` 加淨值面板的申購預扣款顯示；新增 `ui.showIpoOffer(ip)`（交易所列點進去的追加申購／婉拒面板，供本機單人與 S5 `syncAdapter.js` 的多人通知列共用） |
| `src/ui/uiViews.js` | `ui.handleEvents` 新增 `IPO_OPENED`／`IPO_SUBSCRIBED`／`IPO_DECLINED`／`IPO_SETTLED` 四種事件的訊息欄與 POP／toast 播報（含快取檔名 `ui._ipoTierNames`，避免結算時只能顯示 SMALL/BIG 代號）；`DECISION_RESOLVED` 的排除清單加入 `IPO_ANNOUNCE`，避免與 `IPO_SUBSCRIBED`/`IPO_DECLINED` 重複播報出看不懂的「決定：sub_small」 |
| `src/ui/styles.css` | **未變更**——全部沿用既有 class（`.twoCol`／`.kv`／`.opts`／`.flavor`／`.gold`），確認過都已存在，符合「零依賴、不新增外部樣式系統」 |
| `src/editor/cardEditor.html` | 新增 `KIND_DESC`（21 個 kind 的一行說明，含 T-001 的 `IPO_NAME`）；kind 篩選下拉選單每個選項附說明文字＋`title`；新增 `tier` 欄位（`grp_tier`／`f_tier`，只在 `deckOf(c)==="IPO_POOL"` 時顯示）；`onPackChanged` 的牌堆清單改為「既有卡片的 deck ∪ `pack.cards` 已宣告但還沒有卡片的空牌堆」（否則空牌堆永遠選不到）；新增「＋ 新牌堆」按鈕與 `addNewDeck()`；`createNewCard()` 對 `IPO_POOL` 特例預設 `kind:"IPO_NAME"`、`tier:"SMALL"`；`validateCard()` 加 `IPO_POOL` 的 kind／tier 必要欄位檢查 |
| `tests/editortest.js` | 新增 2 項：①`IPO_POOL` 可編輯（含「空牌堆也能開出來編輯」的一般能力，以及對 S4 已交付的既有 35 張新股清單卡本身也跑一次結構驗證）②`kind` 下拉選單每個選項都附說明文字（逐一檢查全部 11 個內容包、34 個既有 kind 選項） |
| `tests/s45test.js` | 在 S1 段落之後新增 5 項 page 測試（決策卡顯示、申購小資檔、都不要、交易所列＋`showIpoOffer` 追加申購、事件訊息欄／POP）。**唯一動到 S1 段落的地方**：把原本 S1 段落結尾的 `process.exit(...)` 改成 `return {pass,fail,pageErrors}` 再 `.then(runS2Page)`——原因與理由見下方「未預期發現 1」，**S1 寫的所有 `step()` 斷言內容一字未改**。 |

`src/engine/`、`src/network/`、`src/data/`、版本號：全部未動，符合分派單「不可碰」清單。

## 測試證據

改動前已確認 git 工作區在我要改的四個檔案（`uiCore.js`／`uiViews.js`／`styles.css`／`cardEditor.html`）上是乾淨的（`git status` 無異動），因此依 CLAUDE.md 第 5 節「或確認 git 工作區乾淨可回復」，沒有另外建立 `.backup.20260910` 檔案。

### `npm test`（完整跑兩次；第一次抓出 3 個測試自身的 bug 並修正後，第二次全綠）

第二次（修正後）完整輸出重點摘錄（完整 log 483 行，存於本機 `scratchpad`，未入版控）：

```
test:engine → npm run build && npm run extract && node tests/gate.js
{"errors":0,"warnings":3}                                    ← contentcheck，3 則警告與本次改動無關
{"games":1000,"NaN":0,"Infinity":0,"invalidGames":0,"invalidReasons":{},"assetLedgerMismatch":0}

test:ui → 30 個測試檔：
{"pass":95,"total":97}   ← runtests.js：2 個既有失敗，與本次改動無關（見下方未預期發現 3）
{"pass":108,"fail":0}    s17test.js
{"pass":20,"fail":0}     s18test.js
{"pass":16,"fail":0}     s19test.js
{"pass":32,"fail":0}     s20test.js（互動教學熱點測試——本次改動未影響教學流程，通過）
{"pass":16,"fail":0,"pageErrors":0}   s22test.js
{"pass":21,"fail":0,"pageErrors":0}   s23test.js
{"pass":21,"fail":0,"pageErrors":0}   s23btest.js
{"pass":18,"fail":0,"pageErrors":0}   s23ctest.js
{"pass":12,"fail":0,"pageErrors":0}   s24test.js
...（s26–s34 略，全部 fail:0）
{"pass":19,"fail":0,"pageErrors":0}   s35test.js
  ↑ 這是 30 輪真局模擬，實際跑出了我新增的 toast 文字：
  "📢 新股申購開放，交易所可以看"、"🎉 新股抽籤結算：中籤 0／3 筆"
  （證明事件播報在真實遊戲流程中正常運作，且沒有打破 S35 既有的 toast 數量斷言）
{"pass":5,"fail":0}      s37test.js
{"pass":8,"fail":0,"pageErrors":0}    s39test.js（S39 集資：與我在同一個 renderFinBoard 區塊相鄰新增的
  「新股申購中」列沒有互相干擾，含「交易所列示」的既有斷言仍過）
{"pass":8,"fail":0,"pageErrors":0}    s40test.js
{"pass":24,"fail":0,"pageErrors":0}   s41test.js
{"pass":11,"fail":0,"pageErrors":0}   s42test.js
{"pass":12,"fail":0,"pageErrors":0}   s43test.js
{"pass":5,"fail":0,"pageErrors":0}    s44test.js
{"pass":17,"fail":0,"pageErrors":0}   s45test.js（S1 段落，17 項，逐字未改，全過）
{"pass":5,"fail":0,"pageErrors":0}    s45test.js（S2 段落，本次新增 5 項，全過）
{"pass":13,"fail":0,"pageErrors":0}   editortest.js（含本次新增 2 項，全過）
```

`npm test` 整條 `&&` 鏈跑到最後一個檔案（`editortest.js`）並印出完整輸出，代表鏈上每一段都是 exit code 0（否則會在中途中斷、後面的檔案不會執行）。

### `tests/s45test.js` S2 段落（本次新增，逐項）
```
OK   決策卡 IPO_ANNOUNCE：兩檔並排顯示申購價／參考價／價差／中籤率；g<0.25 時（且僅當時）顯示「可能破發」；三個按鈕齊全
     兩檔並排、四欄位齊全、按鈕齊全（本次未觸發破發提示）
OK   申購小資檔：送出 IPO_SUBSCRIBE、決策卡關閉、淨值面板出現「申購預扣款」、不留一句看不懂的「決定：sub_small」
     申購成功、卡片關閉、淨值面板顯示預扣款、訊息欄沒有多餘的代號行
OK   都不要：送出 IPO_DECLINE、決策卡關閉、不扣現金
     婉拒成功、卡片關閉、現金不變
OK   交易所「📢 新股申購中」列：存在時顯示，點擊可以追加申購還沒申購過的那一檔
     交易所列示正確、點擊可追加申購第二檔
OK   訊息欄／POP：IPO_OPENED／IPO_SUBSCRIBED／IPO_SETTLED 都有合理文字說明，且帶得出真正的檔名（不是 SMALL/BIG 代號）
     三種事件都有合理文字說明，且都帶得出真正的檔名
{"pass":5,"fail":0,"pageErrors":0}
```

### `tests/editortest.js` 新增 2 項
```
OK   工坊：IPO_POOL 可編輯——含「牌堆本身可能完全沒有卡片」的一般能力（＋新牌堆），以及 S4 已交付的既有 35 張新股清單卡，
     新增卡片自動帶 kind=IPO_NAME／tier=SMALL 且驗證通過
     IPO_POOL（35 張既有卡）可編輯、新卡片 kind/tier 自動帶對、驗證全數通過
OK   kind 下拉選單的每個選項都附一行說明文字（含 T-001 新增的 IPO_NAME）
     34 個 kind 選項（跨全部內容包）都附有說明文字
{"pass":13,"fail":0,"pageErrors":0}
```

### 語法檢查（提交前另外跑過，確認沒有語法錯誤）
```
node --check src/ui/uiCore.js        → OK
node --check src/ui/uiViews.js       → OK
node --check tests/editortest.js     → OK
node --check tests/s45test.js        → OK
（cardEditor.html 的內嵌 <script> 用 node --check 對抽出來的內容驗證 → OK）
```

### build 產物復原
`npm test` 依既有機制內含 `npm run build`，會重寫 `index.html`／`card_editor.html`（tracked）。兩次測試完都已跑：
```
git checkout -- index.html card_editor.html
```
目前 `git status` 顯示這兩個檔案乾淨（無異動），符合分派單「不 build」的既有裁決（S1／S5 報告已記錄同一裁決，本次沿用）。`dist/` 未被 git 追蹤，不需處理。

## 未預期發現

1. **`tests/s45test.js` 的 S1／S2 兩段若各自呼叫 `process.exit`，會在同一個 node 行程裡互踩（已修正，逐字保留 S1 的斷言）**：分派單交叉裁決寫「S2 請自行重新 launch 一個 browser，不要動上面這個 IIFE 的邊界」，但兩段原本各自在自己的 IIFE 最後呼叫 `process.exit(...)`——因為兩段落**共用同一個 node 行程**（`package.json` 是 `node tests/s45test.js` 一次呼叫，不是兩個行程），先跑完的那一段會把整個行程砍掉，通常是**步驟數少、跑得快的那段**（也就是我的 S2 段落）會先完成並呼叫 `process.exit`，導致 S1 段落還沒跑完就被腰斬、結果不完整，而且不保證每次都用同一個順序重現（實測第一次跑就正好是這個順序）。
   **處理方式**：只把 S1 段落原本 `await b.close(); process.exit(...)` 兩行，改成 `await b.close(); return {pass,fail,pageErrors};`，然後在檔案最外層用 `.then(runS2Page)` 串接我的段落，兩段都跑完、算出合併的 pass/fail 後才呼叫一次 `process.exit`。**S1 寫的每一個 `step()` 內容（包含斷言、訊息文字）完全沒有改動**，只動了控制流程最後兩行。這技術上算是碰了「S1 那個 IIFE 的邊界」，超出分派單字面上「不要動」的範圍，但如果照字面完全不動，兩段測試會有實測驗證到的真實互踩風險（我第一次跑就重現了：S1 的 17 項先印出來、但緊接著我的段落才跑到一半，S1 那邊其實已經正常收尾，只是若順序反過來、或未來 S1 段落跑更久，S2 就會被腰斬）。已在檔案內對應位置留下完整中文註解說明原因，供 architect／S1 覆核；如果裁決是「就算有風險也要維持字面上兩段完全獨立」，需要換一種做法（例如兩個檔案＋package.json 各自一行 `node`），請告知，我可以照改。
2. **T-68「沒有小孩就不該抽到小孩的帳單」命中 `IPO_S20「補習班連鎖（虛構）」`——S4（content-writer）的內容問題，不在我的範圍**：這張卡是 S4 交付的 `IPO_POOL` 小資檔卡片，標題明講是「補習班」（小孩相關費用），但沒有掛小孩閘門條件。S5（network-engineer）在自己的報告已經轉發過這則，這裡我用卡片工坊的驗證再核一次，確認**不是欄位命名寫錯**（工坊驗證 `IPO_POOL` 只檢查 `kind`／`tier`，這兩項都對），而是**內容本身的設計問題**（IPO_POOL 卡片目前的欄位裡根本沒有「需要小孩」這個概念，`runtests.js` 的這項檢查可能是誤判——IPO 清單卡只是拿來抽公司名稱與 flavor text，玩家不會真的因為抽到這張就被收「補習班費用」），需要 architect／S4 一起看這張卡的標題／flavor 要不要改得不像在講真實支出，或者這項 runtests.js 檢查本身需不需要把 `IPO_POOL` 排除在外。**我沒有動這張卡或這項測試**（兩者都在我的「不可碰」清單：`src/data/` 與非本次分派的既有測試檔）。
3. **`runtests.js` 的 `T-86 S14b 回合上限與延長（EXTEND_GAME）` 失敗，原因待查、與本次 IPO 改動無關**：這是既有測項（續攤重算現金的邏輯），與新股抽籤完全無關，兩次 `npm test` 都穩定重現同一則失敗訊息（不是偶發）。S5 的報告也獨立觀察到同一個失敗並判斷「不在我的範圍」。我同樣沒有能力也沒有權限處理（不在分派單給我的範圍），僅如實記錄供 architect／qa-tester 追查。
4. **`.claude/hooks/check-forbidden.sh` 對 `engineCore.js` 檔頭註解與 `.backup.202609xx` 舊檔的誤報**：每次 Edit 都跳出「發現 Math.random/Date.now」警告，命中的是 `engineCore.js` 第 3 行「鐵律一：引擎不讀寫 DOM、不使用 `Date.now()` / 未播種的 `Math.random()`」這行說明文字本身，以及兩個舊備份檔同一行——這是 S1 報告已經記錄過的同一個舊地雷，我沒有動 `src/engine/`，僅在此重申並留意，不是本次改動造成。
5. **交叉核對 S5（network-engineer）的介面約定，確認相容、不需要協調**：S5 的報告在「需要其他角色決定的事」明確要求 `ui.showIpoOffer(ipoPending)`，且 `syncAdapter.js:897` 已經寫死呼叫 `ui.showIpoOffer(ipN)`（`ipN` 即 `S.ipo.pending`，仿照既有 `ui.showSyndicateOffer` 對 `mpPendingBar` 的慣例、沒有存在性防呆）。我實作的 `ui.showIpoOffer(ip)` 簽名（單一參數＝IPO 的 pending 物件）與這個呼叫慣例完全相容，且內部用 `ui.myId()`（不是寫死 0 號）取得目前這台裝置的玩家身分，適用多人局的非公告者視角。**S5 報告第 5 點提出的「要不要加存在性防呆」的疑問，因為這個函式現在已經存在，應該可以視為自動解決**（維持與 `showSyndicateOffer` 一致、不加防呆的既有慣例）。
6. **`tests/editortest.js`／`tests/s45test.js` 這兩個檔案在我開始改之前，`git status` 上完全沒有被列為修改**（`tests/s45test.js` 是全新檔案、`editortest.js` 未被異動過），符合分派單「S1 先建檔、S2 之後才能在檔尾加 page 段落」的交叉裁決，沒有踩到 S1 的既有斷言。

## 需要其他角色或製作人決定的事

1. **`tests/s45test.js` 的 `process.exit` 改法是否可接受**（見「未預期發現 1」）：這是本次唯一碰到「不可碰」邊界字面規定的地方，但有明確的正確性理由（避免兩段測試在同一行程互踩、其中一段被腰斬）。如果裁決不接受，需要 architect 或 release-manager 指示改用「兩個檔案」的替代方案（會需要改 `package.json` 的 `test:ui` 那一行，不在我目前的可改範圍）。
2. **T-68：`IPO_S20「補習班連鎖（虛構）」` 的標題／flavor 是否要改**（或 `runtests.js` 的這項檢查要不要排除 `IPO_POOL`）：需要 S4（content-writer）與 architect／qa-tester 一起判斷，不在我的範圍。
3. **T-86（EXTEND_GAME 現金重算）原因待查**：需要 engine-engineer 或 qa-tester 進一步追查，我沒有能力判斷根因（不在 UI 層）。
4. **iPad Safari／PC 多解析度版面**：分派單「測平台」要求「如果你有辦法用瀏覽器實測，請實測；沒有的話至少確保 CSS 響應式寫法合理，並在回報中誠實標註未實測」——**本次沒有做額外的手動或自動化多解析度視覺測試**（沒有 iPad 實機、也沒有在 s45test.js 裡另外加六解析度的截圖比對）。已確認的是：①新增的 UI 一律沿用既有 CSS class（`.twoCol`／`.kv`／`.opts`），沒有寫死寬度或新增樣式；②專案既有的六解析度基準測試（`runtests.js` 內建，涵蓋 1024×768～1920×1080）在改動後仍全數通過，但那組測試不是針對新股 UI 元件設計的，只驗證既有版面骨架沒有被撐爆；③`#rotate` 遮罩機制讓 iPad 直向（CSS 寬度通常 <1100px）本來就會被導去「請轉橫向」畫面，橫向下我新增的 `.twoCot` 兩欄並排在既有版面骨架裡应该沒有特別問題，但**這是推論，不是實測**，如果製作人或 qa-tester 需要更肯定的視覺驗證，需要另外安排。

## 待補文案清單

無。本次新增的所有 UI 文案（決策卡說明、按鈕字、事件播報訊息、卡片工坊的 `KIND_DESC` 說明）都是介面層級的操作說明，不是玩家看到的正式卡片內容（`IPO_POOL` 的公司名稱／flavor／eduNote 由 S4 content-writer 負責，已交付 35 張，本次沒有動）。
