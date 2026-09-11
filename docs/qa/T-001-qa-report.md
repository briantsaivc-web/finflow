# T-001 新股抽籤：QA 報告

- 角色：qa-tester（獨立驗證，未沿用工程師自報結果——全部指令本次重新實測）
- 對照：`docs/tickets/T-001-新股抽籤.md` §2 驗收條件 1–16
- 測試日期：2026-09-10
- 新增測試腳本（本次 QA 撰寫，供 CI／之後回歸使用）：
  - `tests/qa-ipo-showoffer-test.js`（多人連線下真的點擊通知列，驗證 S2/S5 介面契約）
  - `tests/qa-ipo-resolution-test.js`（六種解析度下 IPO 決策卡／交易所列不撐爆版面）
  - `tests/qa-ipo-exploratory-test.js`（8 項邊界探索測試＋1 項陷阱記錄）

## 結論

**有條件通過。** 引擎／UI／多人同步／平衡模擬的核心邏輯全部驗證通過，無 Blocker／Critical。但發現 2 項 Major：①`npm test` 實際上有 2 個內部斷言失敗（其中 1 個由本次新增的 `IPO_S20` 卡片內容直接造成，不是「假陰性」），只是 shell exit code 仍為 0，容易被誤判為全過；②驗收條件 5「申購期間淨值不因預扣而下降」字面上與 D4 手續費設計有落差（設計上淨值會微幅下降 0.07 千元＝70 元的處理費＋通知費，非 bug，但字面驗收條件沒過）。兩者都需要製作人／工程師决定如何處理後才能正式過關。

---

## 驗收條件逐條結果

| # | 條件摘要 | AI可自驗／本機 | 結果 | 證據 |
|---|---|---|---|---|
| 1 | 排程分布：1,000 種子，win1∈[8,20]必有，win2∈[25,45]機率60%，平均次數1.5–1.7 | AI | ✅ 通過 | `s45test.js` ①：win1∈[8,20]、win2 rate=0.606（隱含平均1.606∈[1.5,1.7]）；S6 平衡模擬 1500 局合併平均 1.605，逐種子 1.602–1.610，交叉印證 |
| 2 | 觸發：第一個踩 MARKET 的人觸發；逾期3輪保底 | AI | ✅ 通過 | `s45test.js` D5-1／⑩；程式碼 `applyAction.js:1802`（MARKET case）、`:4261-4268`（保底邏輯）逐行核對一致 |
| 3 | 兩檔內容由雜湊產生，同種子同序列重放逐位元一致 | AI | ✅ 通過 | `s45test.js` ②③；`mp-sync-test`／`qa-ipo-showoffer-test` 兩端各自算出同一組公告，逐位元 hash 相同 |
| 4 | 非回合可申購／婉拒，每檔限1張，現金不足 reject | AI | ✅ 通過 | `s45test.js` ⑤；本次 `qa-ipo-exploratory-test` 邊界①②④重新以正確手法驗證現金邊界（見下方「未預期發現」關於舊測試陷阱） |
| 5 | 申購時分錄 CASH−(P+0.07)／ASSET+P；`ipoEscrow`同步；**申購期間淨值不因預扣而下降** | AI | ⚠️ **有條件通過（字面未過）** | 見下方「AC5 專項調查」 |
| 6 | 結算＝公告者下次回合開始，且在S39集資之後；公告者破產/不在內圈時比照S39延後 | AI | ✅ 通過 | `s45test.js` ⑦；程式碼 `applyAction.js:4255-4260` 逐行核對，條件式與 ADR D5-4 完全一致 |
| 7 | 沒中CASH+(P+0.05)／ASSET−P，手續費0.02不退；中籤ASSET−P／CASH+上市價；破發時回收<P | AI | ✅ 通過 | `s45test.js` ④／④b（破發：listPrice 41.22 < P 81.61，分錄結構如常） |
| 8 | 電腦玩家：現金≥reserveMonths×月支出才申購；先小資後股王 | AI | ✅ 通過 | `s45test.js` ⑥／⑥b；程式碼 `applyAction.js:4660`（`["SMALL","BIG"].forEach`，逐檔用即時更新後的 cash 判斷）逐行核對 |
| 9 | 結算前破產先退款，結算不出現找不到玩家或NaN | AI | ✅ 通過 | `s45test.js` ⑧；本次 `qa-ipo-exploratory-test` 邊界⑥（雙檔同時申購後破產，兩筆都正確退款、subs清空、escrow歸零、無NaN） |
| 10 | 舊存檔（無`ipoLottery`）`ns.replay`不觸發，且與改版前逐位元一致 | AI | ✅ 通過 | `s45test.js` ⑨（用真正的 `ns.replay`，非模擬）；本次 `qa-ipo-exploratory-test` 邊界⑦另外用真的缺 key（`delete cfgOld.ipoLottery`）獨立驗證 15 輪不觸發 |
| 11 | `s45test.js`全過；`npm test`全過（含gate 1000局零NaN）；`mptest.js`／`mp2.js`無錯 | AI | ⚠️ **有條件通過** | 見下方「npm test 專項調查」——exit code 0，但內部有 2 項斷言失敗 |
| 12 | 平衡：simtest 3種子×500局前後對照寫入`docs/balance/T-001-balance.md` | AI | ✅ 通過（報告已交，是否接受由製作人決定） | `docs/balance/T-001-balance.md` 已存在，方法論合理（config覆寫法A/B對照），本次未重跑（不影響QA判定，數字真實性見下方抽查） |
| 13 | UI：兩檔並排、交易所列、抽籤結果全場公告 | AI | ✅ 通過 | `s45test.js` S2段落；本次 `qa-ipo-resolution-test`（六解析度）、`qa-ipo-showoffer-test`（真實點擊流程）獨立覆測 |
| 14 | 工坊可編輯`IPO_POOL`，kind下拉每選項附說明 | AI | ✅ 通過 | `editortest.js`（13/13，含新增2項）本次重新執行確認 |
| 15 | 製作人單機試玩 | 本機 | 待製作人驗 | 未執行（超出QA自驗範圍） |
| 16 | 製作人雙開多人連線 | 本機 | 待製作人驗 | 未執行；但本次已用自動化雙分頁（真實 BroadcastChannel/localStorage 網路路徑）覆蓋核心同步邏輯，降低本機驗的風險 |

### AC5 專項調查（申購期間淨值是否因預扣下降）

直接讀 `tests/s45test.js` 308–324 行（D2 測項，S1 自己寫的測試）：申購後 `p1.derived.netWorth` 確實下降了 `fee+notice = 0.07`（千元，即 70 元），不是 0。這是因為 ASSET 分錄記的是「申購價 P」，但實際扣的現金是「P + fee + notice」，兩者差額（手續費）沒有對應的資產墊高，所以淨值必然微幅下降。這是 ADR D4 的既定設計（處理費與通知費本來就是不退的成本），且已經過 architect 審查通過。

**判定**：驗收條件 5 字面「申購期間淨值不因預扣而下降」**沒有完全滿足**（下降了固定的 0.07，不是因為 P 本身被重複計算或漏記）。這不是實作 bug（本金部分確實沒有重複扣或漏算，`totalAssets` 只被加一次 P，`ipoEscrow` 也正確地沒有參與運算），而是驗收條件文字沒有預留「手續費本身就是設計上的沉沒成本，理應反映在淨值」這件事。**建議**：把驗收條件 5 的文字修正為「申購期間淨值不因預扣的本金部分而下降（僅手續費造成的固定小額下降屬預期行為）」，或者製作人明確裁示現狀可接受，不需要修改文字或程式。這件事需要製作人決定，不影響其餘功能正確性。

### npm test 專項調查（AC11）

自己重新執行 `npm test`（未借用任何工程師回報的輸出）：

```
$ npm test
...
test:engine → {"games":1000,"NaN":0,"Infinity":0,"invalidGames":0,"invalidReasons":{},"assetLedgerMismatch":0}
test:ui → node tests/runtests.js && ... && node tests/editortest.js
{"pass":95,"total":97}
  ❌ T-86 S14b 回合上限與延長（EXTEND_GAME） :: 續攤不得重算超過一位玩家的現金（發薪只該發給接回的那一位）
  ❌ T-68 沒有小孩就不該抽到小孩的帳單 :: 這些卡的標題明講是小孩的花費，卻沒有小孩也會遇到：IPO_S20「補習班連鎖（虛構）」
...（其餘 29 個測試檔全部 fail:0／pageErrors:0）
$ echo $?
0
```

**發現**：`tests/runtests.js` 內部有 2 項斷言失敗（97 項中的 95 項通過），但整個 `npm test` 的 shell exit code 仍是 **0**（已用 `npm test > /dev/null 2>&1; echo $?` 與 `node tests/runtests.js; echo $?` 分別驗證，兩者都回傳 0）。也就是說**這個測試框架的失敗不會讓 CI／`npm test` 失敗**，AC11「`npm test`全過」若以 exit code 判斷會誤判為通過，但字面上（97 項全過）並沒有通過。

逐一核實這 2 項失敗：

1. **T-68（直接由 T-001 造成，非既有問題）**：`src/ui/uiViews.js:6094` 的 `KID` 關鍵字清單包含「補習班」，用來掃描**全部** 11 個內容包、所有牌堆的卡片標題，凡是標題含這些關鍵字但沒有掛「需要小孩」閘門的卡，一律判定為 leak。S4 新增的 `IPO_S20「補習班連鎖（虛構）」`（`src/data/packs/v10.json:2105-2111`）是 `IPO_POOL` 牌堆的「公司名稱＋一句產業文案」卡，純粹用來在抽新股時挑一個顯示名稱，**引擎只讀它的 `id`／`title`／`tier`**（已用 `grep` 確認 `E.ipoIssueTier` 沒有讀取 `flavor`／`eduNote` 之外的欄位去觸發任何遊戲效果），不會真的對任何玩家收「補習班費用」。T-68 這個既有回歸測試是為了抓「標題明講是小孩的花費、卻沒有小孩閘門」的**真實支出卡**設計的，套用到「只是拿來當公司名稱」的 `IPO_POOL` 卡片上，是一次真正的**內容/測試分類衝突**——不是測試誤判草木皆兵，因為 `IPO_POOL` 這整個新牌堆的性質（純展示用途，無財務效果）在 T-68 寫成的當下並不存在，測試沒有機會排除它。
2. **T-86（既有問題，與 T-001 無關）**：`git diff HEAD -- src/engine/reducer/applyAction.js` 搜尋 `EXTEND_GAME`／`maxTurns`／`payday` 相關變更，本次 T-001 的 diff **完全沒有碰到**這段邏輯（唯一命中的一行只是 `OFF_TURN_RESPOND` 清單裡原本就有的 `EXTEND_GAME:1`，旁邊被加了 `IPO_SUBSCRIBE:1, IPO_DECLINE:1`）。判定為**既有、與本次改動無關**的技術債，工程師回報（S2、S5）也各自獨立觀察到同一則失敗並得到相同結論。

**建議處理方式**（需要製作人／architect 決定由誰做，這裡只回報現象，不代為修改 `src/`）：
- T-68：二選一——① 把 `IPO_S20` 的標題／flavor 改成不含「補習班」（例如「課後照護連鎖」也可能踩到別的關鍵字，需要重新過濾）；② 讓 `src/ui/uiViews.js:6096` 的 T-68 掃描邏輯排除 `IPO_POOL` 牌堆（因為這整個牌堆的卡片性質是「只挑名稱用」，不是「玩家會實際承擔的支出」）。傾向②，因為以後只要 `IPO_POOL` 再新增任何公司名稱，都有可能撞到同一組關鍵字清單，排除牌堆比逐張改名字更一勞永逸。
- T-86：與 T-001 無關，建議另開一張獨立的 bug 單追蹤，不要卡在這次 release。

---

## Bug 清單

| # | 嚴重度 | 描述 | 重現步驟 | 預期 | 實得 |
|---|---|---|---|---|---|
| 1 | **Major** | `IPO_S20「補習班連鎖（虛構）」`卡片標題撞上既有回歸測試 T-68 的關鍵字掃描，導致 `npm test` 內部有 1 項斷言失敗 | `node tests/runtests.js`，看 T-68 那一項 | T-68 應該 0 leak（97/97 全過） | leak 1 筆：`IPO_S20` |
| 2 | **Major**（既有，非本次引入） | `T-86 S14b 回合上限與延長（EXTEND_GAME）`斷言失敗，已用 diff 確認與本次 IPO 改動無關 | `node tests/runtests.js`，看 T-86 那一項 | 應該通過 | 斷言失敗（"續攤不得重算超過一位玩家的現金"） |
| 3 | **Minor／流程風險** | `tests/runtests.js`（以及推測 `npm test` 整條鏈）內部斷言失敗不會讓 shell exit code 變成非 0，容易被誤判「全過」 | `node tests/runtests.js; echo $?` → 0（儘管有 2 項 FAIL） | 有任何一項斷言失敗，exit code 應非 0 | exit code 仍為 0 |
| 4 | **Minor／驗收條件文字** | 驗收條件 5「申購期間淨值不因預扣而下降」與 D4 手續費設計（申購時淨值必然掉 fee+notice=0.07）有字面落差 | 讀 `tests/s45test.js:308-324`（D2 測項），或自行跑一次 IPO_SUBSCRIBE 比對申購前後 `p.derived.netWorth` | 淨值不下降 | 下降 0.07（設計內、非本金重複計算） |

無 Blocker／Critical。

---

## 探索測試（8 項邊界，任務單未列出）

全部用 `tests/qa-ipo-exploratory-test.js` 驗證，**9/9 全過**（含 1 項「陷阱記錄」）：

```
$ node tests/qa-ipo-exploratory-test.js
OK   陷阱記錄：直接指定 p.cash 後呼叫 ledger.recompute 會被蓋掉、不是有效的測試手法
OK   邊界①：現金恰好等於 cost，應允許申購（不是差一點點就被 IPO_CASH 擋下）  cost=110.86 申購成功、現金歸零
OK   邊界②：現金比成本少 0.01，應該 IPO_CASH 擋下（不能透支負現金）  少 0.01 正確擋下，現金不變＝143.15
OK   邊界③：各種垃圾 payload 全部乾淨 reject，不 throw、不產生 NaN  10 筆垃圾 payload 全部 reject、0 throw、無 NaN
OK   邊界④：連按兩下同一顆申購鈕，第二次應該 IPO_DUP、不能被扣兩次款  連點兩下：只扣一次錢，cash 125→51.82（第二下被擋）
OK   邊界⑤：CONFIG_PATCH 中途改 ipoLottery 不會讓進行中的 S.ipo 憑空消失或損毀
OK   邊界⑥：玩家同時申購兩檔後破產，兩筆申購款都要先退，不能只退一筆或漏退  破產前 ipoEscrow=1857，破產後歸零、subs 清空、cash=999998.96
OK   邊界⑦：config 裡完全沒有 ipoLottery 這個 key（真的舊存檔，不是設成 0）不觸發、不 throw  整局跑完 S.ipo 全程 undefined，無 throw
OK   邊界⑧：公告者自己還沒回應 IPO_ANNOUNCE 時，其他真人玩家的 IPO_SUBSCRIBE 不受影響
{"pass":9,"fail":0,"pageErrors":0}
```

涵蓋：①現金恰好等於成本（邊界相等）②現金差0.01（極小負值防呆）③垃圾/負數/超長字串/物件型別的 payload（防禦性）④連點兩下（重複送出防呆）⑤CONFIG_PATCH 竄改 feature flag 中途改變不影響進行中的局⑥破產+雙檔申購複合情境⑦真正缺 key 的舊存檔（非只是設成0）⑧公告者未決策時是否卡住全桌（驗證只鎖公告者本人）。**過程中發現「陷阱記錄」項**：`p.cash=X; ledger.recompute(p)` 這個寫法本身是無效的（`recompute` 會依 `p.ledger` 重新算回原值，蓋掉手動指定），連 S1 自己寫的 `tests/s45test.js:175/178` 都用了這個寫法卻沒有讓測試失敗——原因是那個測項剛好測的是 BIG 檔（申購價門檻遠高於測試玩家的實際起始現金），巧合掩蓋了寫法本身無效這件事。**不是功能 bug**（IPO_CASH 檢查本身邏輯正確，本次已用正確手法在邊界①②獨立重新驗證），但建議之後有人要測「現金剛好卡在某個精確金額」的情境時，改用 `ledger.post` 真的過一筆帳，不要直接指定 `p.cash` 後呼叫 `recompute`。

---

## 回歸檢查（本次改動觸及的既有功能，各挑一個驗證）

| 觸及範圍 | 挑選驗證的既有功能 | 結果 |
|---|---|---|
| `applyAction.js` case "MARKET" | 沒有新股待觸發時，MARKET 格照常抽市場卡 | `s45test.js` 整合測試（8種子全電腦局）與 `npm run test:engine` gate（1000局零NaN）間接覆蓋，未見異常 |
| `E.beginTurn` 結算順序 | S39 集資結算不受影響、順序仍在 IPO 之前 | `s45test.js` ⑦ 直接斷言；`s39test.js`（8/8）本次隨 `npm test` 重跑，無失敗 |
| `E.buildBookkeeping` DENY清單 | 既有 `dividend`／`event-end` 等排除項不受影響 | `npm test` 全部既有測試檔（s17–s44）本次重跑皆 fail:0，含記帳相關測項 |
| `E.declareBankrupt` | 既有破產流程（非IPO相關的清算）不受影響 | `s42test.js`（11/11）本次重跑無失敗 |
| `src/network/syncAdapter.js` mpPendingBar | S39 集資的通知列不受IPO新增區塊影響 | `mptest.js`（8/8）、`mp2.js`（8/8，含既有斷言）本次重跑無失敗；S2 報告也提到 `s39test.js` 「交易所列示」既有斷言仍過 |
| `src/editor/cardEditor.html` | 既有牌堆（非IPO_POOL）仍可正常編輯 | `editortest.js`（13/13）本次重跑，含 11 個內容包／750張卡結構驗證全過 |
| 六解析度版面（既有骨架） | 沒開IPO時的既有版面測試 | `s17test.js`（108/108）本次重跑無失敗 |
| 互動教學熱點 | 教學流程（含新增機制後）不卡住 | `s20test.js`（32/32）本次重跑無失敗；另確認 `src/ui/tutorial.js` 全檔沒有任何 `dispatch(` 呼叫——教學是完全靜態凍結的示範狀態（`tut.buildDemo` 直接組出畫面、不跑 `E.beginTurn`／不驅動NPC），IPO 機制只在真正的回合推進（`E.beginTurn`／踩MARKET格）時才會觸發，教學模式架構上不可能被IPO卡住 |

---

## 交叉核對三項已知未結事項（任務指派的重點）

1. **`ui.showIpoOffer` 介面契約（S2完成後是否真的接得上S5）**：**確認可用**。本次寫 `tests/qa-ipo-showoffer-test.js`，用真正的兩分頁多人連線（非公告者頁面），在畫面上找到 `#boardCenter` 裡「📢 新股申購：點這裡申購」通知列，**真的點擊**（不是用 `ui.dispatch` 繞過），確認：不拋錯、彈出視窗正確顯示兩檔完整資訊（申購價/參考價/價差/中籤率/破發提示）、按下申購鈕後 `IPO_SUBSCRIBE` 真的經網路送達房主端、兩端 `JSON.stringify(S)` 逐位元一致。12/12 全過。
2. **`E.markOffTurnLedger` 是否真的在 `IPO_SUBSCRIBE` 被呼叫**：**確認有**。直接讀 `src/engine/reducer/applyAction.js:1262`：`if(!isMyTurnAction) E.markOffTurnLedger(actor);`，位置正確（非回合時才呼叫，在 `ledger.post` 之後）。`s45test.js` ⑤ 也有斷言 `offTurn=true`，本次重跑通過。
3. **`p.ipoEscrow` 是否真的沒有被拿去做任何財務判斷**：**確認乾淨**。用 `grep -rn "ipoEscrow" src/` 全域搜尋，命中僅 4 處程式碼：①`engineCore.js:260` 初始化為0；②`applyAction.js:1261/4672/4707/4730` 四處都只是在申購/結算/退款時同步更新這個快取值；③`uiCore.js:1324-1329` 唯讀顯示（程式碼裡的中文註解明講「這裡不拿它做任何加總」）。**沒有任何一處**在破產判定、紓困額度、排名、LTV、或其他財務邏輯裡讀取 `p.ipoEscrow`。另外 `s45test.js` D2 測項刻意把 `p.ipoEscrow` 竄改成 999999 後呼叫 `ledger.recompute`，確認 `netWorth`／`totalAssets` 完全不受影響——本次重跑通過。

---

## 測試指令與輸出摘要

```
node tests/contentcheck.js                     → {"errors":0,"warnings":3}（3則WARN與本次改動無關）
npm test                                        → exit 0；test:engine gate 1000局零NaN；
                                                    test:ui 30個測試檔：僅 runtests.js 內部 2 項斷言失敗（見上）
node tests/mptest.js                            → 8/8 OK，no page errors
node tests/mp2.js                               → 8/8 OK（含既有斷言），no page errors
node scratch/ipo-mp-sync-test.js                → 14/14（重新以不同種子590011831/490774199跑兩次，結果穩定）
node tests/qa-ipo-showoffer-test.js（本次新增）  → 12/12，pageErrors:0
node tests/qa-ipo-resolution-test.js（本次新增） → 66/66，pageErrors:0（6解析度×11項）
node tests/qa-ipo-exploratory-test.js（本次新增）→ 9/9，pageErrors:0
```

## 需要製作人本機驗的項目清單

1. 驗收條件 15：單機試玩一局，看得到 1–2 次公告、可以申購、看得到抽籤結果、記帳題不會卡住 END_TURN。
2. 驗收條件 16：雙開多人連線，非公告者可以申購，兩端結果一致。**本次已用自動化雙分頁大幅降低風險**（`qa-ipo-showoffer-test.js`／`scratch/ipo-mp-sync-test.js`），但真正的 iPad Safari 實機、真實 Firebase 房間、真人手速連點等情境仍需製作人親自把關。
3. **iPad Safari 實機**：本次六解析度測試（`qa-ipo-resolution-test.js`）全部跑在 Chromium headless，驗證了「不會撐爆版面、無捲軸」，但這**不等於**真正的 iPad Safari WebKit 渲染引擎測試。S2 report 已誠實承認未實測，本次 QA 用自動化方式補強了證據力，但仍建議製作人至少用一台真 iPad 開一次 IPO 公告確認觸控/字級/`#rotate`橫向模式下的實際觀感。

## 未預期發現

1. `tests/s45test.js:175/178`（S1自己寫的既有測項）用 `p.cash=0; ledger.recompute(p)` 這種寫法設定現金是無效的（會被 `recompute` 蓋回真實值），該測項恰好因為測的是 BIG 檔（門檻遠高於玩家起始現金）而巧合通過，並非該寫法真的有效。建議之後修改時一併清理，但不影響現有測試結果的正確性（IPO_CASH 邏輯本身沒問題，已用本次 `qa-ipo-exploratory-test.js` 邊界①②獨立重新驗證）。
2. `npm test`／`node tests/runtests.js` 內部斷言失敗不會導致 shell exit code 非 0（見 Bug #3），這是既有測試框架設計，非本次引入，但建議 architect／engine-engineer 評估是否要讓 `runtests.js` 在有 FAIL 時回傳非 0 exit code，否則未來任何一版都可能在「`npm test` 全過」的錯覺下漏掉真正的回歸失敗。
3. `.claude/hooks/check-forbidden.sh` 對 `src/engine/core/engineCore.js` 第 3 行「鐵律一」說明文字本身的誤報，本次每次 `Write` 新測試檔都會觸發同一則誤報（因為它是全庫掃描，不是只掃改動檔案）——這是 S0～S5 五份報告都已經各自記錄過的同一個舊地雷，本次再次確認與 T-001 改動無關，純粹重申供 architect 之後評估是否修正 hook 規則（排除註解行）。
4. 未發現 `p.ipoEscrow`、`E.markOffTurnLedger`、`ui.showIpoOffer` 三項已知關注點有任何問題（見上方「交叉核對」），三者皆確認正確。

## 需要製作人／工程師決定的事

1. **T-68（`IPO_S20`卡片內容撞上既有回歸測試）如何處理**：改卡片標題／flavor，或讓 `src/ui/uiViews.js` 的 T-68 掃描邏輯排除 `IPO_POOL` 牌堆（QA建議後者，理由見上）。這件事不解決，AC11「`npm test`全過」字面上無法完全滿足。
2. **T-86（EXTEND_GAME既有失敗）**：與本次 T-001 無關，建議另開獨立 bug 單，不要卡在這次 release 的驗收範圍內，但也請製作人知悉目前 `main` 分支本來就帶著這個既有失敗。
3. **驗收條件5文字是否需要修正**：目前設計（申購時淨值必然掉0.07=fee+notice）是 ADR D4 已審過的既定行為，建議製作人裁示「文字修正為排除手續費」或「維持現狀、不修改文字」，兩者都可以，只是需要一個正式決定讓這條驗收條件可以明確打勾。
4. **`npm test`／`runtests.js` 的 exit code 是否要改成「有FAIL就非0」**：既有技術債，建議轉交 architect 評估，避免未來版本重蹈「表面全過、實際有斷言失敗」的風險。
5. iPad Safari 實機驗證（見上「需要製作人本機驗的項目清單」第3項）。
