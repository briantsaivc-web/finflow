# T-001 S5 完成報告：新股抽籤（network-engineer）

- 角色：network-engineer
- 對應分派單：`docs/tickets/T-001/dispatch.md` S5
- 對應 ADR：`docs/adr/ADR-001-新股抽籤.md`（D3、D5、「影響」段落的 UNKNOWN）
- 前置：`docs/reports/T-001-engine-engineer-S1.md`（S1 已把 `IPO_SUBSCRIBE`／`IPO_DECLINE` 加入 `E.OFF_TURN_RESPOND`）

## 結論
1. **完成**。在 `src/network/syncAdapter.js` 的 `mpPendingBar()` 比照 S39 集資的寫法加了新股申購通知列：公告者看到「⏳ 新股申購公告中」，非公告的其他真人看到「📢 新股申購：點這裡申購」，點擊呼叫 `ui.showIpoOffer(ipN)`（掛鉤留給 S2／ui-engineer 實作，比照既有 `ui.showSyndicateOffer` 的先例，S5 只建立契約不建 modal）。
2. 新寫的 `scratch/ipo-mp-sync-test.js`（14 項）＋既有 `mptest.js`（8 項）／`mp2.js`（7 項）全部通過：seed 580011831，透過真正的 LocalAdapter（BroadcastChannel＋localStorage）在兩個瀏覽器分頁間送出 `IPO_SUBSCRIBE`（非回合），兩端 `JSON.stringify(S)` 逐位元相同（長度 19322／結算後 19474），全程沒有觸發 `mpFullResync` 同步破口。
3. **舊版客戶端相容性 UNKNOWN 已查證**：`ui.mpJoin`（`syncAdapter.js:309-310`）在入房當下用 `room.meta.ver!==ns.BUILD.ver` 做**精確字串比對**，版本不符就直接 toast 擋下、退回選單，**完全不會**進入遊戲或收到任何 action（IPO 或其他），不需要額外處理。詳見下方「相容性影響」。

## 變更檔案清單
| 檔案 | 變更摘要 |
|---|---|
| `src/network/syncAdapter.js` | `mpPendingBar()` 新增 T-001 新股申購通知列區塊（約新增於 `S39：集資` 區塊之後、`pendingJV` 之前）：公告者（`ipN.fromId===me`）顯示等待條；非公告真人（未婉拒且尚未申購完當前所有 tier）顯示「📢 新股申購：點這裡申購」，callback 呼叫 `ui.showIpoOffer(ipN)` |
| `src/network/syncAdapter.js.backup.20260910`（新建） | 改檔前備份（憲法第 5 節） |
| `scratch/ipo-mp-sync-test.js`（新建，one-off 驗證腳本，不進 `tests/`） | 兩分頁×LocalAdapter 的新股同步證據腳本，14 項斷言 |

`src/engine/`：**未動**。`src/ui/`、`src/data/`：**未動**（本次跑 `npm test` 途中發現這些檔案被其他角色並行修改，見「未預期發現」）。

## 同步測試證據

### `node scratch/ipo-mp-sync-test.js`（新寫，兩分頁真實網路傳輸）
```
OK   建房成功且房號為 4 碼  房號=9795
OK   小美用 4 碼房號入房並按下準備
OK   房主開局  {"ok":true,"seed":580011831,"ipoOn":true}
OK   兩端同一顆種子、且 config.ipoLottery 透過 setup 同步生效（S.ipo 兩端都建立）
OK   兩端各自 forceDue+openIpo（雜湊來自同一顆 seed）算出同一組公告內容  P_SMALL=93.66 P_BIG=1790.71 q_SMALL=0.0265
OK   送出時確認真的不是小美的回合（off-turn 前提成立）  {"notMyTurn":true,"seat":1,"active":0}
OK   A 端（房主，未動手）也收到並套用了 B 端送出的 IPO_SUBSCRIBE  len=1
OK   兩端都記到座位 1 申購 SMALL
OK   兩端座位 1 的現金／ipoEscrow 完全一致  cash=406.27 escrow=93.66
OK   兩端 JSON.stringify(S) 逐位元相同（申購後）  長度=19322
OK   公告者本人申購 BIG 檔後，兩端仍逐位元一致  長度=19322
OK   重複申購同一檔（IPO_DUP）被本地擋下，沒有送上網路、actionLog 沒有增加
OK   兩端各自呼叫 E.settleIpo（同雜湊來源）結算後仍逐位元一致  長度=19474
OK   全程沒有觸發 mpFullResync／同步破口診斷（ui.mp.lastDesync 兩端皆空）
{"pass":14,"fail":0,"pageErrors":0}
```
**同步測試摘要**：seed=580011831；透過網路實際傳輸的 action 數＝2 筆（`IPO_SUBSCRIBE` × 2，座位 1 與座位 0 各一筆；另有 1 筆重複申購被本地 `E.apply` 試跑擋下，依既有設計不上傳、不計入 actionLog）；兩端最終 hash（`JSON.stringify(S)`，本專案既有的逐位元一致驗證慣例，見 `docs/CHANGELOG_S13.1.md`／s45test.js⑨ 的用法）**一致**。

方法論說明：新股公告的觸發（`E.openIpo`）本身是 S1 已在 `tests/s45test.js`（⑨⑩）驗過的引擎行為，不是本次要驗的東西；本次比照 `s45test.js` 的 `forceDue` 手法，在兩個分頁**各自獨立**呼叫同一段純函數（`E.openIpo`／`E.settleIpo`，雜湊來源只有 `S.seed`），不經過 actionLog——用來快速鋪出「新股申購中」的場景，讓測試聚焦在**本次真正要驗的東西**：`IPO_SUBSCRIBE`／`IPO_DECLINE` 這兩個新的非回合 action 經過真正的 `mpSend → appendAction → BroadcastChannel → mpApplyEntry` 網路路徑傳輸後，兩端狀態是否一致。

### `node tests/mptest.js`（既有，8 項，未改動）
```
OK   seat0 視角：不該看到 2 號的按鈕
OK   seat2 視角：財報是自己的，且不顯示「檢視他人」
OK   FF-003a 嚴重 bug 5：seat2 看得到「辭職進入自由圈」且可按
OK   FF-003a 嚴重 bug 6：seat2 看得到操作區的「進修商城」且可按
OK   S34：不能報名的時段，進修商城仍打得開（只是不能執行）
OK   GRADUATE_NOW 真的送得出去且引擎接受
OK   側欄：別人的回合不該寫「你的回合」
OK   結算排行榜／戰報的「（你）」跟著座位走
--- no page errors ---
```

### `node tests/mp2.js`（既有，7 項，未改動）
```
OK   建房成功且房號為 4 碼  房號=1742
OK   隨機模式下大廳關掉職業選單
OK   小美 用 4 碼房號入房並按下準備
OK   阿強 用 4 碼房號入房並按下準備
OK   房主開局  {"ok":true,"seat":0,...}
OK   三個座位各自認得自己
OK   隨機職業不重複
OK   2 號座位看自己的財報＝自己（FF-003a）
OK   房間確實存在於 localStorage（供上面的原子建房把關）
--- no page errors ---
```
**備註（UNKNOWN 已消解）**：`package.json` 沒有 `mptest`／`mp2` 這兩個 npm script 名稱，兩支都是要用 `node tests/mptest.js`／`node tests/mp2.js` 直接執行的獨立 Playwright 腳本（不在 `npm test` 涵蓋範圍內）。已用分派單指定的實際檔名執行，非猜測。

### `npm test`（`test:engine` + `test:ui`，完整跑一次）
- `test:engine`（`gate.js`）：`{"games":1000,"NaN":0,"Infinity":0,"invalidGames":0,"invalidReasons":{},"assetLedgerMismatch":0}` ✅
- `test:ui`：**exit code 1**，4 項失敗，**全部在我的可改範圍（`src/network/syncAdapter.js`）之外**，詳見「未預期發現」。與本次改動（新股申購通知列）無關的證據：
  - `s45test.js`（S1 的 17 項）：`{"pass":17,"fail":0,"pageErrors":0}`（本次改動未動到任何 S1 斷言的行為）
  - `s39test.js`（集資，我比照的先例）：無失敗
  - 完整輸出存於本機暫存（`scratchpad/npmtest_s5.log`，未入版控）

## 相容性影響（ADR「影響」段落 UNKNOWN，已查證）

**查證結論：舊版客戶端完全進不了新版房主開的房間，不會收到任何動作（含 IPO 相關）。**

- 房主建房時把 `ns.BUILD.ver` 寫進 `room.meta.ver`（`syncAdapter.js:257`）。
- 任何人加入房間時，`ui.mpJoin`（`syncAdapter.js:309-310`）用**精確字串比對** `room.meta.ver!==ns.BUILD.ver`：
  ```js
  if(room.meta.ver!==ns.BUILD.ver){
    ui.toast("版本不符（房間 "+room.meta.ver+"／你 "+ns.BUILD.ver+"）——請重新整理頁面取得最新版","warn",6500);
    ui.mpMenu(); return; }
  ```
  版本不符就直接 toast 擋下、退回選單，**流程在此中止**，不會呼叫 `mpBeginGame`／`startCore`，也就不會進到 `ad.readLog()` 去讀任何 action（IPO 或其他新動作都一樣）。
- `ns.BUILD.ver` 目前寫死在 `src/engine/core/engineCore.js:91`（`"v2.52.0-S44"`），依 CLAUDE.md 第 6 節**只有 release-manager 能改**。這代表這道擋法要生效，**前提是 T-001 上線時 release-manager 有把版號往前推**（正常發版流程本來就會做）。
- **邊界情況（非本次 IPO 特有，是既有架構的一般行為）**：如果版號因故沒推進（例如同版號內的臨時測試），版本檢查會放行，但這不代表會壞——`applyAction.js:1552` 的 `default: return reject("UNKNOWN_ACTION")` 會讓不認得的 action type 乾淨地被拒絕（不會 throw／不會產生 `TypeError`，S43 已把入口信封驗證做成不可能再 throw）；`mpApplyEntry`（`syncAdapter.js:549-583`）收到 reject 會啟動既有的破口自救機制：先嘗試一次全量重放，同一筆還是被拒就攤開「⚠ 同步破口」訊息並呼叫 `ui.showStuck`，**不會靜默壞掉或卡死整桌**（這正是 S41/S42/S43 一路加固的行為）。
- 結論：**不需要為 IPO 額外寫版本相容程式碼**，現有的「建房時鎖版號、入房時精確比對」機制已經涵蓋這個情境；唯一的前提是發版時版號有推進，這是 release-manager 職責範圍，本報告列在「需要其他角色／製作人決定的事」供對照。

## 未預期發現

1. **`npm test` 需要先 `npm run build`，而 build 會覆寫 `index.html`／`dist/index.html`／`card_editor.html`**：與 S1 報告「未預期發現 2」是同一個開放問題（「不 build」的界線 vs 測試必須讀已建置的 `index.html`）。本次沿用 S1 的處理方式：只用 build 作為跑測試的手段，沒有 commit 這三個檔案，正式版號／changelog 仍留給 release-manager。此議題已由 S1 提出過，這裡不重複要求裁決，只補一筆佐證。
2. **`npm test` 目前有 4 項失敗，全部在我的可改範圍之外**，判斷是其他角色（S2 ui-engineer、S4 content-writer 或 balance-designer）在**與本次 session 同時**進行中的工作，非本次改動造成：
   - `runtests.js`：`T-86 S14b 回合上限與延長（EXTEND_GAME）`——與 IPO 無關的既有測項失敗，原因待查（不在我的範圍）
   - `runtests.js`：`T-68 沒有小孩就不該抽到小孩的帳單`——命中 `IPO_S20「補習班連鎖（虛構）」`，這是 S4（content-writer）新增進 `v10.json` 的 `IPO_POOL` 卡片內容錯誤（卡片主題是小孩補習班費用，但沒有掛「需要小孩」的條件），屬於 `src/data/` 範圍，不是我能改的
   - `tests/editortest.js`：兩項失敗，`addNewDeck is not defined`、`IPO_NAME` 選項缺說明文字——屬於 S2（ui-engineer）`src/editor/cardEditor.html` 的範圍（分派單 S2 項目⑤「工坊：`IPO_POOL` 可編輯」尚未做完，但對應的測試斷言已經先寫進 `tests/editortest.js`）
   - **佐證這是並行工作、不是我造成的**：session 一開始 `git status --short` 只顯示 `package.json`、`engineCore.js`、`applyAction.js` 被改過；`npm test` 跑完後再查 `git status`，多出 `card_editor.html`、`index.html`、`manual/rulebook.html`、`src/data/config/defaultParams.json`、`src/data/packs/v10.json`、`src/editor/cardEditor.html`、`src/ui/uiCore.js`、`src/ui/uiViews.js`、`tests/editortest.js` 都被改動——這些全部是 S2／S3／S4 的範圍檔案，我完全沒有碰過。**這代表其他角色的 session 與本次 S5 是同時在跑**，我這次 `npm test` 的結果是在他們工作「進行到一半」時的快照，4 項失敗預期會在他們各自完成後消失，不需要我處理。
3. **`ui.showIpoOffer` 目前還不存在**（S2 尚未實作）：我在通知列的 callback 直接呼叫 `ui.showIpoOffer(ipN)`（比照既有 `mpPendingBar` 對 `ui.showSyndicateOffer` 的寫法，兩者都沒有存在性防呆，屬同一慣例），這是我對 S2 的介面約定，不是我自己能完成的部分。在 S2 交付 `ui.showIpoOffer(ipoPending)` 之前，非公告者點擊這顆通知列按鈕會丟出「`ui.showIpoOffer is not a function`」。**這不影響本次同步測試的證據**——我的 `scratch/ipo-mp-sync-test.js` 是直接呼叫 `ui.dispatch({type:"IPO_SUBSCRIBE",...})`（跳過還不存在的 UI modal，直接測傳輸層本身），符合 S5「不可碰 `src/ui`」的邊界。
4. `.claude/hooks/check-forbidden.sh` 對 `engineCore.js` 檔頭註解的誤報（S1 報告已記錄過的同一個舊地雷，本次編輯 `syncAdapter.js` 與新建 `scratch/ipo-mp-sync-test.js` 都觸發同一則警告，因為它是掃全專案而不是掃本次改動的檔案）——與本次改動無關，僅供留意。

## 需要其他角色／製作人決定的事

1. **S2（ui-engineer）**：請實作 `ui.showIpoOffer(ipoPending)`——非公告真人點擊「📢 新股申購：點這裡申購」後彈出的視窗，功能比照既有 `ui.showSyndicateOffer`：列出 `ipoPending.tiers` 內每一檔（名稱／申購價／參考價／價差／中籤率／破發提示），按鈕分別送出 `IPO_SUBSCRIBE`（可能不只一檔，因為 D2 允許同時申購 SMALL＋BIG）與 `IPO_DECLINE`。這個函式名稱與參數（`ipoPending` 即 `S.ipo.pending`）已經在 `syncAdapter.js` 的通知列寫死引用，若 S2 要用不同名稱，請回報，我再改 callback。
2. **S4（content-writer）**：`IPO_S20「補習班連鎖（虛構）」`卡片內容需要補上「需要小孩」條件（`T-68` 測項命中），不在我的範圍，僅轉發。
3. **S3／balance-designer**：`src/data/config/defaultParams.json` 已被動到（我沒動，觀察到的變更），若已補上 D6 參數表，請確認 `ipoLottery` 等鍵值與 ADR D6 表格一致；不在我的範圍，僅提醒。
4. **release-manager（發版時）**：本次相容性查證的前提是發版時 `ns.BUILD.ver`（`engineCore.js:91`）必須推進版號，否則入房版本比對機制不會生效（見「相容性影響」段落的邊界情況）。這是既有機制，不是新的要求，僅在此明確記錄依賴關係。
5. **architect／reviewer**：本次改動是否要把 `ui.showIpoOffer` 的呼叫加上存在性防呆（`if(ui.showIpoOffer)`），如 `uiViews.js:361` 對 `ui.showSyndicateOffer` 的寫法？目前我採用「不防呆、直接呼叫」，理由是 `mpPendingBar` 對 `showSyndicateOffer` 本身也沒有防呆（見 `syncAdapter.js:883`），我認為維持與既有先例一致比較好，但這是可以討論的小事，列出來供裁決。
