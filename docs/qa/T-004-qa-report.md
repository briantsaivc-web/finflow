# T-004 新股公告——電腦觸發時真人完全收不到跳卡：QA 報告

- 角色：qa-tester（獨立驗證，未沿用任何工程師自報結果——全部指令本次重新實測）
- 對照：`docs/tickets/T-004-新股公告通知不足.md`、`docs/tickets/T-004/dispatch.md`（S1/S3/S4/S2）
- 測試日期：2026-09-11
- 新增測試腳本（本次 QA 撰寫，供之後回歸使用，均已跑通）：
  - `tests/qa-t004-singleplayer-repro.js`：重現製作人原始場景（單機、電腦觸發、真人在電腦回合中收卡並解卡），走真實 `ui.renderCenter`／`ui.tick`／按鈕點擊
  - `tests/qa-t004-mp-smoke.js`：2 真人＋2 電腦本地多人連線 smoke test（驗收條件 6），走真實 `ui.dispatch`／`mpSend`／`appendAction`／`onAction` 廣播路徑
  - `tests/qa-t004-resolutions.js`：六種解析度下，電腦回合中真人決策卡的渲染與版面檢查
  - `tests/qa-t004-edgecases.js`：6 項邊界探索測試（超過任務單要求的 5 項）

## 結論

**通過。** 逐條驗收條件全數通過，`npm test` 本次獨立重跑兩次皆 exit code 0、全程零 FAIL；核心情境（電腦觸發、真人在非自己回合收卡且能正常解卡、不卡死、不靜默清空）已用真實 UI 路徑（非純引擎呼叫）重現且驗證修復有效；六解析度、教學、多人連線 smoke test、6 項邊界探索、既有測試交叉檢查均無異常。無 Blocker／Critical／Major／Minor bug。

---

## 驗收條件逐條結果（對照任務單 §4）

| # | 條件摘要 | AI可自驗／本機 | 結果 | 證據 |
|---|---|---|---|---|
| 1 | 依補充裁決文件逐字修改 `E.openIpo` | AI | ✅ 通過 | 讀 `applyAction.js:4639-4657`，與 ADR 補充裁決 1「具體改法」逐字比對一致（`S.players.forEach` 過濾 `isNPC`/`bankrupt` 後 `E.pushDecision`） |
| 2 | `tests/s45test.js` 新增 `D5-1c（T-004）`，覆蓋混合局、電腦觸發、多真人各自收卡且互不干擾 | AI | ✅ 通過 | 讀 `s45test.js:371-408` 全文，非空洞測試：實際斷言 FIFO 順序、`NOT_YOUR_TURN` 代答保護、解卡後另一位的 `decisionId` 不變、兩張都解完後佇列淨空 |
| 3 | `node tests/s45test.js` 全數通過，18＋5 既有斷言不得新增 FAIL | AI | ✅ 通過 | 本次獨立重跑：S1 段落 `{"pass":19,"fail":0,"pageErrors":0}`，S2 段落 `{"pass":5,"fail":0,"pageErrors":0}` |
| 4 | `node tests/runtests.js` 全套沒有波及其他既有測項 | AI | ✅ 通過 | 本次獨立重跑：`{"pass":97,"total":97}`，含 `T-59` 分支 |
| 5 | 相同 seed／action 序列重放兩次，結果逐位元一致 | AI | ✅ 通過（既有覆蓋＋本次交叉驗證） | 既有 `⑨ 舊存檔／關閉時不觸發` 用真正 `ns.replay` 驗證逐位元一致（本次仍 PASS）；`整合：8 個種子全電腦局，ipoLottery=1` 3000 步跑滿 8 個種子無 NaN／無帳本殘留；本次 `qa-t004-mp-smoke.js` 額外交叉驗證：A、B 兩端各自獨立執行同一套開盤邏輯後 `decisionQueue`（含 `decisionId`）逐位元字串相等 |
| 6 | 【人工／qa-tester】2 真人＋2 電腦多人連線 smoke test：電腦觸發、兩位真人各自收卡不卡住、解完能繼續 | 本機（本次由 QA 執行） | ✅ 通過 | `tests/qa-t004-mp-smoke.js` 全 12 項 OK：4 人局（2 真人＋2 電腦自動補位）、電腦(P2)觸發後 P0/P1 各收一筆、A 用真實按鈕解卡並透過廣播同步給 B（B 全程沒有自己動作也正確收到狀態）、B 接著看到自己的卡並解掉、雙端 `decisionQueue` 最終一致、`phase` 正常推進到 `READY_END`，無 page error |
| 7 | 回報路徑齊全（engineer 職責） | — | 不適用（工程師已完成，見 `docs/reports/T-004-*.md`） | — |

補充：dispatch 表列 S3 的三項驗收（97/97、19/19+5/5、`npm test` exit 0）已併入上表第 3/4/6 條驗證；本次亦獨立重跑確認一致。

---

## 交叉檢查（任務指示要求的重點項目）

### 1. `tests/s18test.js` 與 `src/ui/uiViews.js` T-59 兩處新補的測試分支是否真的驗證到位

**兩處都不是空洞測試**，親自讀完邏輯並動手驗證：

- `uiViews.js:5474-5573`（T-59）：(a) 段是「不變式掃描」，跑 6 個種子、全電腦局，逐輪檢查 `decisionQueue` 裡每一張是否都屬於當前玩家（本次修法後這個假設本身已經不成立，但這段測的是「不能違反」的情境，跟 (b) 段互補）；(b) 段是「死當重現」，用真正的 `E.apply` 逐步推進 8 個種子的混合局（1 真人＋2 電腦），新增的分支在偵測到 `pendingDecision` 屬於某位真人且不是當前玩家時，**真的呼叫 `E.apply(S2,{type:"DECIDE",...})`** 模擬那位真人解卡，並斷言不被拒絕（`rD.rejected` 為真才算失敗）。這是會真正驅動狀態機往前走的斷言，不是字串比對或空 try/catch。
- `tests/s18test.js:47-66`：在 30 輪自動驅動迴圈裡插入相同手法，同樣是**真的呼叫 `E.apply` 送出 DECIDE**，且成功後 `continue` 回迴圈頂端、正確呼叫 `ui.render()` 清除殘留 overlay，不是裝飾性程式碼。

兩處已用完整檔案內容核對與程式碼追蹤（非僅比對測試名稱），確認邏輯與 ADR 補充裁決 2「修法 C」逐字一致。

### 2. `git status` 是否仍只有預期檔案異動

本次獨立重新確認兩次（一次在補跑 `npm test` 之前、一次在補跑之後並 `git checkout -- index.html` 還原）：

```
 M "docs/adr/ADR-001-新股抽籤.md"
 M src/engine/reducer/applyAction.js
 M src/ui/uiCore.js
 M src/ui/uiViews.js
 M tests/s18test.js
 M tests/s45test.js
```

與 dispatch 表列的預期異動檔案完全吻合，沒有 `index.html`／`card_editor.html`／`dist/` 殘留（`npm test` 內部會重新 `npm run build`，本次跑完後已用 `git checkout -- index.html` 還原乾淨，與 S4 回報描述的情況一致，本次驗證這個「跑測試會弄髒、需要手動還原」的現象仍然成立，屬既有已知行為非新 bug）。

---

## 完整功能驗證（本次 QA 重點，比一般票更深入）

### 電腦觸發＋真人在電腦回合中收卡（重現製作人原始場景）

`tests/qa-t004-singleplayer-repro.js`：1 真人＋3 電腦局，把回合切到電腦(P1)、強制新股到期，直接呼叫 `E.openIpo(S,P1)`（模擬 MARKET 格觸發／保底觸發的效果），然後**完全用真實 UI 路徑**驗證：

1. `ui.render()` 之後，`#center` 正確顯示 P0（真人）的 IPO 決策卡內容（現金列＋兩檔資訊＋三個按鈕），不是「A 思考中…」——直接證明 `ui.renderCenter` 判斷順序已修正（修法 A 生效）。
2. 只呼叫一次 `ui.tick()`（讓它依自身遞迴機制運作，比照真實 UI 用法），等待 3.5 秒（約 8-9 個 tick 週期）後：沒有出現「⚠ 卡住了」提示、P0 的卡仍完整在佇列裡未被清空——直接證明 `ui.tick` 的守門（修法 B）生效，不會誤判成死當、不會觸發會清空決策佇列的降級處理。
3. 真人用**真的點擊畫面上「都不要」按鈕**（不是直接呼叫引擎函式）解卡成功，`phase` 正確變回 `ROLL`。
4. 解卡後續 `tick`，輪次從 1 推進到 2，遊戲正常往下走，未卡死。

全數 OK，無 page error。這是本票核心 bug 的第一手重現＋修復驗證，不是只信工程師的引擎層單元測試。

### 六種解析度版面檢查

`tests/qa-t004-resolutions.js`：沿用 `s17test.js` 既有的 6 組解析度（1024×768／1180×820／1280×720／1366×768／1440×900／1920×1080），在「電腦回合中、真人有懸置 IPO 決策卡」這個 T-004 新引爆的情境下逐一檢查：`phase===DECISION`、`#center` 正確顯示決策卡（不是「思考中」字樣同時出現）、無水平／垂直捲軸、卡片完整落在可視範圍內、按鈕數量正確（3 顆）。**48 項斷言全數 PASS**，六種解析度下都沒有破版或卡住。

### 教學熱點

既有 `tests/s20test.js`（20 步互動教學走一次，本次完整 `npm test` 重跑仍 `{"pass":32,"fail":0}`）未受影響——`ui.renderCenter` 的改動只是搬動既有分支的判斷順序，教學流程本身不特別觸發 IPO 決策情境，一般 ROLL／LIFE_EVENT／BOOKKEEPING 等既有分支邏輯與位置完全未變，本次確認無回歸。

### 多人連線 smoke test（驗收條件 6，本次 QA 重點）

`tests/qa-t004-mp-smoke.js`：用「local」多人 adapter（同瀏覽器 context、兩個分頁各自代表一位真人，走真實 `mpCreate`／`mpJoinPrompt`／房主開局流程），建立 4 人局（2 真人 A/B＋2 電腦自動補位 P2/P3）：

- 兩端各自獨立計算「電腦(P2)觸發開盤」後的 `decisionQueue`，逐位元字串比對完全相同（座位、種類、`decisionId` 都一致）。
- A（此刻佇列最前面的擁有者）畫面正確顯示自己的決策卡（modal）。
- **重要澄清（非 bug，記錄在下方「未預期發現」）**：B 此刻不是佇列最前面的擁有者，畫面顯示的是 `src/network/syncAdapter.js`（多人連線專屬、T-004 未觸碰的既有覆寫層）產生的「⏳ 等待 P0 做決定中」非阻塞提示，不是 P0 的實際卡片內容——這是既有設計（`mineTurn` 用 `S.pendingDecision.playerId===ui.myId()` 正確判斷擁有權，非用「現在輪到誰」判斷），刻意避免真人看到別人的財務決策卡。
- A 用**真的點擊按鈕**解卡，動作經過真正的 `ui.dispatch → mpSend → appendAction` 廣播路徑。
- B 完全沒有自己做任何動作，純粹透過 `onAction` 廣播同步收到 A 解卡的結果，`pendingDecision` 正確換到 P1（B 自己）的卡，畫面自動從「等待中」切換成 B 自己的實際決策卡（modal）。
- B 用真的點擊按鈕解掉自己的卡，佇列清空，`phase` 正常推進到 `READY_END`。
- A 端也透過廣播同步看到佇列清空，兩端狀態一致，遊戲能繼續往下走。

**12 項斷言全數 PASS，無 page error。** 這是本次 T-004 分派單明確要求、且既有 `mptest.js`／`mp2.js` 未覆蓋到的情境，本次已補齊驗證。

### 原本正常路徑沒有回歸

- 真人自己踩格子觸發開盤：`s45test.js` D5-1 本次仍 PASS。
- 電腦踩格子直接 ACK：D5-1b 本次仍 PASS。
- 電腦自動申購（`E.ipoPollNPC`）：整合測試（8 種子全電腦局）本次仍 PASS，`mp-smoke` 測試中也觀察到 P3（電腦）在開盤當下正常自動申購（`subs` 欄位出現記錄）。

---

## 探索測試：6 項邊界情況（超過任務單要求的最低 5 項）

`tests/qa-t004-edgecases.js`，全數 PASS：

| # | 情境 | 結果 |
|---|---|---|
| 1 | 真人玩家已破產時開盤 | 不推卡給已破產真人，只推給仍在場的真人 |
| 2 | 全部真人都已破產時開盤（極端：0 位可通知對象） | `decisionQueue` 全空，不卡在 `DECISION` phase，遊戲正常繼續，不噴錯 |
| 3 | 連按兩下「都不要」（模擬手殘連點） | 第一次成功、第二次用同一個已失效的 `decisionId` 再送被安全拒絕，不會重複處理／重複扣款 |
| 4 | 同一位真人佇列裡同時有 `IPO_ANNOUNCE` 與其他決策（如 `ACK`） | FIFO 順序正確（先推的先解），互不干擾，各自獨立 |
| 5 | 真人現金為 0（極端貧窮）時開盤 | 仍正常收到通知，可選擇「都不要」，不會因為「反正買不起」就被跳過 |
| 6 | 同一輪兩檔新股窗口同時到期 | 單次 `openIpo` 呼叫只開一檔、只推一筆卡，不會疊加 |

---

## 測試指令與輸出摘要

### `npm test`（本次獨立重跑兩次，均 exit code 0）

```
$ npm test
...
test:engine → {"errors":0,"warnings":3} / {"games":1000,"NaN":0,"Infinity":0,"invalidGames":0,"invalidReasons":{},"assetLedgerMismatch":0}
test:ui → tests/runtests.js {"pass":97,"total":97}
          tests/s17test.js {"pass":108,"fail":0,"pageErrors":0}
          tests/s18test.js {"pass":20,"fail":0}
          ...（s19–s44 全部 fail:0／pageErrors:0）
          tests/s45test.js S1段 {"pass":19,"fail":0,"pageErrors":0}／S2段 {"pass":5,"fail":0,"pageErrors":0}
          tests/editortest.js {"pass":13,"fail":0,"pageErrors":0}
$ echo $?
0
```

逐字掃描全程輸出：`grep -noE '"fail":[0-9]+'` 與 `grep -noE '"pageErrors":[0-9]+'` 均無非零結果；`grep -c "FAIL"` 為 0。3 則既有 WARN 與本票無關（技能無情境卡／已移除代號提示）。

跑完後 `index.html` 成為 build 產物差異（`test:engine` 內部重新 `npm run build` 導致，已知既有現象），已用 `git checkout -- index.html` 還原，`git status` 恢復乾淨。

### 本次新增測試腳本輸出

```
$ node tests/qa-t004-singleplayer-repro.js   → 5/5 OK，無 page error
$ node tests/qa-t004-mp-smoke.js             → 12/12 OK，無 page error
$ node tests/qa-t004-resolutions.js          → 六種解析度 pass=48 fail=0
$ node tests/qa-t004-edgecases.js            → 6/6 OK，無 page error
```

---

## 未預期發現

1. **`src/network/syncAdapter.js` 的多人專屬 `ui.renderCenter` 覆寫層（930-956 行）與 ADR 補充裁決 2 的「未預期發現」描述不完全一致，但不是 bug，反而是好消息**：ADR 補充裁決 2 記錄的既有體驗瑕疵是「多人局裡任何一台裝置只要 `phase===DECISION` 都會用擁有者的資料畫出這張卡……點擊按鈕送出的 playerId 永遠是自己的座位……可能讓真人困惑」。但本次多人 smoke test 實測發現：**真實多人連線下，非擁有者的畫面根本不會顯示擁有者的卡片內容**，而是顯示一則非阻塞的「⏳ 等待 X 做決定中」placeholder（`syncAdapter.js:944-954`，`mineTurn` 用 `S.pendingDecision.playerId===ui.myId()` 正確判斷擁有權，這是 T-91／v2.20.0 就有的既有修復，不在 T-004 S3 修改範圍內）。也就是說，ADR 提到「別人的決策卡出現在我畫面上、我按了沒反應」這個困惑情境，在真正的多人連線路徑下**不會發生**（只有在理論上繞過這層覆寫、直接呼叫 `origCenter()` 才會出現，例如單機模式下 `ui.mp.mode` 為 false 時，但單機模式本來就只有一位真人，不存在「別人的卡」的情境）。建議：這條「未預期發現」可以從待辦清單上移除或降級為「僅理論存在、實務路徑不會踩到」，不需要另開票修。
2. 沒有發現其他偏離任務單／裁決文件描述的地方。所有程式碼改動經逐行核對，均與 ADR 補充裁決 1、2 的「具體改法」逐字一致。

---

## 需要製作人／工程師決定的事

無阻擋性事項。以下為次要、可自行決定是否處理：

1. 交易所面板「已表態 X／Y」分母把電腦玩家也算進去的既有小瑕疵（補充裁決 1 已記錄，本次未重新調查，維持原裁決「不要求本次修」）。
2. 上方「未預期發現」第 1 點：建議把 ADR 補充裁決 2 中「decide() 使用 `ui.myId()` 造成困惑」這條「未預期發現」註記為「多人連線實務路徑已由既有 `syncAdapter.js` 覆寫層規避，僅單機模式下理論存在但不會踩到」，供之後盤點時參考，不要求任何程式異動。

T-004 判定：**通過**，可以進入 release 流程（是否／何時 release 由 release-manager／製作人決定）。
