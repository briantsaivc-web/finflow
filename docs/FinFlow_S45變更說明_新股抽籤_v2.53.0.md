# FinFlow S45 變更說明：新股抽籤（市場雙檔公開申購）

- 版本：**v2.53.0-S45**（前一版 v2.52.0-S44）
- 日期：2026-09-11
- 對應任務單／ADR：`docs/tickets/T-001-新股抽籤.md`、`docs/adr/ADR-001-新股抽籤.md`
- 一句話：一局隨機開 **1–2 次新股申購**，全場玩家（含不是自己回合的真人、電腦玩家）都能申購「小資熱門股」與「股王」兩檔，中籤率＝`r÷預期價差率`——越好賺越難抽，好處會被市場分光。

---

## 1. 機制總覽：申購 → 抽籤 → 結算

一局大約遇到 1–2 次新股申購公告：第 8–20 輪必有一次，第 25–45 輪有 60% 機率再一次（種子雜湊排程，不吃主亂數流，不位移既有存檔／測試）。**第一個踩到市場格的玩家**觸發公告，取代該次市場抽卡；排定輪次後 3 輪內都沒人踩到，下一輪首回合直接保底公告。

公告一次開兩檔：

| 檔別 | 申購價 | 特性 |
|---|---|---|
| 小資熱門股 | 30–150 千元／張 | 門檻低，人人抽得起 |
| 股王 | 800–2,500 千元／張 | 門檻高，只有大戶抽得起 |

每檔的申購價、預期價差率 `g`、參考價（＝申購價×(1+g)）、中籤率（＝`clamp(r÷g, 0.5%, 30%)`，`r`＝3%）全部由種子雜湊產生，同種子＋同動作序列重放逐位元一致。

**申購**：任何玩家（不限自己回合）都可以送出申購，每人每檔限 1 張。按下申購當下預扣：申購價 ＋ 處理費（20 元，固定金額）＋ 中籤通知費（50 元，固定金額，兩者皆不隨申購價高低變動、不退）。帳本分錄：`CASH −(P+0.07)`／`ASSET +P`，淨值面板同步顯示「申購預扣款」。

**抽籤與結算**：結算時點＝公告者下一次回合開始時（且在 S39 集資結算之後）。沒中：`CASH +(P+0.05)`／`ASSET −P`，處理費 20 元不退；中籤：`ASSET −P`／`CASH +`上市價（上市價＝參考價×U(0.8,1.2)，同樣由雜湊產生），中籤但破發時，回收金額低於申購價。公告者中途破產或不在內圈時，比照 S39 集資延後到下一個可結算的回合。

---

## 2. 電腦與真人雙路徑

- **真人**：踩到市場格且新股到期時彈出 `IPO_ANNOUNCE` 決策卡，兩檔並排顯示申購價／參考價／價差／中籤率，價差率 `g<0.25` 時額外顯示「可能破發」提示；三個按鈕（申購小資／申購股王／都不要）。非公告者透過交易所「📢 新股申購中」列或多人通知列申購，不必等自己的回合。
- **電腦玩家**：申購後現金必須仍 ≥ `ipoNpcReserveMonths`（預設 3）× 月總支出才出手；先評估小資檔，再評估股王檔，付不起就不申購。
- 申購者在結算前破產：先退回申購款（處理費照扣），再走既有破產流程，結算不會出現找不到玩家或 NaN。
- 舊存檔（`config` 裡沒有 `ipoLottery`）用 `ns.replay` 重放時不會觸發公告，且與改版前逐位元一致（feature flag 預設值判斷，不影響任何既有存檔）。

---

## 3. 多人同步

公告與抽籤全部走雜湊（不消耗主亂數流 `util.rand`），`E.settleIpo` 以數字排序遍歷申購者，不依賴物件鍵插入順序，維持 lockstep 決定論。`syncAdapter.js` 的多人通知列（`mpPendingBar`）新增新股申購提示：公告者看到等待條，非公告的其他真人看到「📢 新股申購：點這裡申購」，點擊呼叫 `ui.showIpoOffer`。已用真實 `BroadcastChannel`／`localStorage` 兩分頁網路路徑驗證：非回合送出 `IPO_SUBSCRIBE` 後兩端 `JSON.stringify(S)` 逐位元一致（申購後與結算後皆同）。

舊版客戶端相容性：房主建房時把版本字串寫入房間 meta，入房時精確字串比對版本號，版本不符直接擋下、退回選單，不會收到任何新動作（含 IPO 相關）——這代表這次發版把 `ns.BUILD.ver` 推進到 `v2.53.0-S45` 本身就是相容性保護生效的前提。

---

## 4. 平衡影響摘要

依 `docs/balance/T-001-balance.md`（3 種子 × 500 局，`ipoLottery` 開關 A/B 對照，共 6000 局）：

- 全局中位／P90、外圈耗時、畢業人次、跌落率、免費點占比：改版前後幾乎沒有可觀察差異（全局中位 59→59、畢業人次差 −0.37%、跌落率差 −0.2pp）。
- 三種電腦性格（`NPC_SAFE`／`NPC_LEVER`／`NPC_VC`）自由率變化均在 ±1pp 內；淨值中位小幅上升（SAFE +3.7%、LEVER +1.0%、VC +1.5%），符合 `ipoEvRate=0.03` 的小幅正期望值設計，沒有出現某一性格靠新股暴賺的訊號。
- 破產率：SAFE 3.8%→3.4%、LEVER 持平 1.2%、VC 0.1%→0.3%（絕對人數僅 2→4 人，樣本過小，判斷為統計噪音而非系統性位移）。
- 機制本身：99.9% 的局至少開過一次公告，平均每局 1.605 次（落在驗收條件 1.5–1.7 區間）；每局平均申購人次 3.4；中籤率 6.07%（在 `ipoQMin/ipoQMax` 夾限內，偏向下段）；每局中籤人次中位數為 0——符合「稀有博弈點綴」的設計定位，不是穩定收入來源。
- balance-designer 建議本次**不調整** `ipoEvRate` 或其他參數，若未來要調整需另跑一輪對照模擬。

（報告另記錄一項與本次機制無關的既有發現：`tests/simtest.js` v0.2 驗收帶三項指標在改版前後同幅度偏離基準，屬 main 分支既有狀態，非本次引入，未在本次範圍處理。）

---

## 5. 過程中修正的問題

1. **`IPO_S20「補習班連鎖（虛構）」` 撞既有回歸測試 T-68**：`IPO_POOL` 只是抽新股時挑用的公司名稱牌堆、不觸發任何真實支出效果，但標題含關鍵字「補習班」誤撞了「沒有小孩就不該抽到小孩的帳單」的全牌堆掃描。修法：`src/ui/uiViews.js` 的 T-68 掃描迴圈排除 `IPO_POOL` 牌堆（而非逐張改名字，避免以後新增卡片再撞同一組關鍵字）。
2. **code-reviewer Major #1：`IPO_SUBSCRIBE` 缺破產防呆**：真人路徑原本沒有 `actor.bankrupt` 檢查，與電腦玩家路徑（`E.ipoPollNPC` 明確排除破產者）不對稱。已補上 `if(actor.bankrupt) return reject("BANKRUPT");`，比照全專案既有慣例。`IPO_DECLINE`（純表態、不涉金流）維持不擋，比照 `DECLINE_SYNDICATE` 的既有先例。是否限制已畢業（`OUTER`）玩家申購，經製作人裁示**不限制**，已畢業玩家仍可正常申購／婉拒。
3. **code-reviewer Major #2：規則書手續費文案寫成百分比**：`manual/rulebook.html` §8.10 原文把固定金額的處理費／通知費寫成「2%／5%」，與參數設計（`ipoFee`＝20 元、`ipoNoticeFee`＝50 元，皆固定金額不隨申購價變動）不符，股王檔差距達兩個數量級。已改為「處理費 20 元＋中籤通知費 50 元（固定金額，不隨申購價高低變動）」，`manual/quickstart.html` 對應文字同步修正。

上述兩項 Major 修復後，code-reviewer 已完成複審並判定**通過**。

---

## 6. 已知遺留問題（不擋本次發布，另行追蹤）

以下兩項由製作人於 2026-09-10 裁示另開票追蹤，不卡在本次 T-001 收尾：

- **`docs/tickets/T-003-EXTEND_GAME斷言失敗.md`**：`tests/runtests.js` 的既有回歸測項 `T-86 S14b 回合上限與延長（EXTEND_GAME）` 目前仍失敗（本次 release 重新執行 `npm test` 仍可重現）。已用 `git diff` 確認與本次 T-001 改動完全無關（唯一相關的一行只是 `OFF_TURN_RESPOND` 白名單新增鍵值），是 main 分支既有技術債。
- **`docs/tickets/T-002-測試斷言吞錯誤碼.md`**：`tests/runtests.js` 內部斷言失敗目前不會讓 `npm test` 的 shell exit code 變成非 0（本次 release 重新驗證：`npm test` exit code 仍為 0，但內部確實有上述 T-86 這一項 `❌`），容易被誤判為「全過」。本次發版流程已依規範**不只看 exit code**，逐行核對輸出文字後才判定測試結果。

---

## 7. 測試結果

本次 release 前重新完整執行（未沿用工程師回報），逐行核對輸出文字：

| 套件 | 結果 |
|---|---|
| `node tests/contentcheck.js`（含於 build） | `{"errors":0,"warnings":3}`（3 則既有 WARN，與本次改動無關） |
| `npm run test:engine`（gate 1000 局） | `{"games":1000,"NaN":0,"Infinity":0,"invalidGames":0,"invalidReasons":{},"assetLedgerMismatch":0}` |
| `npm run test:ui`（31 個測試檔） | `tests/runtests.js` 首行 `{"pass":96,"total":97}`，僅剩 1 項已知失敗（T-86，見上節，非本次引入）；其餘 30 個測試檔全數 `fail:0／pageErrors:0`，含 `tests/s45test.js`（S1 段 18 項＋S2 段 5 項，含破產防呆新增的 ⑤d）、`tests/editortest.js`（13 項，含 `IPO_POOL` 工坊編輯） |
| `npm test` shell exit code | `0`（已知悉 T-002／T-003 兩項既有問題，見上節） |
| `node tests/mptest.js` | 8/8，no page errors |
| `node tests/mp2.js` | 8/8，no page errors |

其餘多人同步、探索性邊界測試、六解析度版面測試證據詳見 `docs/qa/T-001-qa-report.md`（QA 獨立驗證，未沿用工程師自報結果）。

---

## 8. 動到的檔案

| 檔案 | 改動 |
|---|---|
| `src/engine/core/engineCore.js` | 新增 `E.ipoRoll`（雜湊決定論抽籤）；`p.ipoEscrow` 唯讀快取欄位；`E.newGame` 建立 `S.ipo` 排程；`E.cfg` 加第三參數 `dflt`（向下相容擴充）；版本字串 `v2.53.0-S45` |
| `src/engine/reducer/applyAction.js` | `IPO_SUBSCRIBE`／`IPO_DECLINE`（含破產防呆）；`IPO_ANNOUNCE` 決策；`MARKET` 格觸發判斷；`E.buildBookkeeping` DENY 加 `"ipo-settle"`；`E.beginTurn` 新股結算＋保底；`E.declareBankrupt` 呼叫 `E.ipoRefundPlayer`；新增 `E.ipoDue`／`E.ipoIssueTier`／`E.openIpo`／`E.ipoPollNPC`／`E.settleIpo`／`E.ipoRefundPlayer` |
| `src/data/config/defaultParams.json` | 新增 21 個 `ipo*` 參數（ADR D6 表格全數落地） |
| `src/data/packs/v10.json` | 新增 `IPO_POOL` 牌堆 35 筆（小資 20＋股王 15，虛構公司名，5 筆完整教育點） |
| `src/ui/uiCore.js` | `IPO_ANNOUNCE` 決策卡；交易所「📢 新股申購中」列；淨值面板申購預扣款；`ui.showIpoOffer` |
| `src/ui/uiViews.js` | `IPO_OPENED`／`IPO_SUBSCRIBED`／`IPO_DECLINED`／`IPO_SETTLED` 事件播報；T-68 掃描排除 `IPO_POOL` 牌堆 |
| `src/network/syncAdapter.js` | 多人通知列新增新股申購提示區塊 |
| `src/editor/cardEditor.html` | `IPO_POOL` 可編輯（`tier` 欄位、kind 下拉選單說明文字、空牌堆可開出來編輯） |
| `manual/rulebook.html` | 新增 §8.10 新股抽籤一節；狀況速查表加一列；手續費文案修正為固定金額 |
| `manual/quickstart.html` | 新增新股抽籤提示；手續費文案修正為固定金額 |
| `tests/s45test.js`（新建） | 18 項（S1 引擎段，含破產防呆⑤d）＋ 5 項（S2 UI 段） |
| `tests/editortest.js` | 新增 2 項（`IPO_POOL` 編輯、kind 說明文字） |
| `package.json` | 版本 2.53.0；`test:ui` 掛上 `s45test.js` |
| `index.html` / `dist/index.html` / `card_editor.html` | `npm run build` 產出（不手改） |

另有 QA 於驗收過程新增、未進 `test:ui` 主鏈的獨立回歸腳本：`tests/qa-ipo-showoffer-test.js`、`tests/qa-ipo-resolution-test.js`、`tests/qa-ipo-exploratory-test.js`（詳見 `docs/qa/T-001-qa-report.md`）。

CLAUDE.md 第 4 節「平衡模擬」指令已於本次 sprint 由 balance-designer 查證、經製作人回填為 `npm run test:balance`（＝`npm run build && npm run extract && node tests/simtest.js`），非本檔變更範圍，附帶記錄。
